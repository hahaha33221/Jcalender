/* VPS 서버 동기화 · 로그인 (server/index.mjs)
   - 처음 열면 로그인 / 회원가입 화면(Welcome.jsx). 사용자마다 서버에 자기 데이터가 따로 저장된다
   - 이 브라우저의 데이터(비밀 정보 제외)를 로그인한 사용자의 서버 데이터와 주고받는다
   - 바뀌면 3초 뒤 올리고, 앱을 열 때 · 창으로 돌아올 때 · 5분마다 서버에 새 버전이 있는지 확인한다
   - 서버 버전이 이 기기가 알던 버전보다 새로운데 이 기기에도 안 올린 변경이 있으면 "충돌" → 사용자가 고른다
   - 로그아웃하면 이 브라우저의 데이터를 지운다 (서버에 있으므로 다시 로그인하면 받음) → 다른 사람이 같은 기기를 써도 안전
   - 서버 주소는 화면에 두지 않는다: 같은 주소의 /api/... 로 부르면 Vercel(vercel.json rewrites)이 VPS 로 넘겨 준다 (내 컴퓨터 시험은 vite.config.js 의 proxy)
   - 연결 정보는 jcalender.server 키에 { token, email, name, version, dirty, lastSync, owner }
     owner: 지금 이 브라우저에 있는 데이터의 주인 이메일 ('' = 모름 · 로그인 전부터 쓰던 데이터, '-' = 비어 있음) */
import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeSecrets, migrate, splitSecrets } from './schema.js';

export const SERVER_KEY = 'jcalender.server';
/** API 주소: 같은 사이트의 /api (VPS 주소는 화면 · 코드에 넣지 않음) */
export const API_BASE = '';
const PUSH_DELAY = 3000, CHECK_EVERY = 5 * 60 * 1000;

const readConf = () => {
  try {
    const c = JSON.parse(localStorage.getItem(SERVER_KEY) || 'null') || {};
    // 처음 쓰는 브라우저(저장된 앱 데이터 없음): 지금 데이터는 예시뿐 → 로그인하면 서버 데이터를 바로 받는다
    if (c.owner === undefined && !localStorage.getItem('lifeboard.react.v1')) c.owner = '-';
    delete c.url; delete c.guest;                           // 예전에 저장한 서버 주소 · "로그인 없이 둘러보기"는 더 쓰지 않음
    if (c.remember === false) c.token = sessionStorage.getItem(SERVER_KEY) || '';   // 자동 로그인을 끈 로그인: 브라우저 · 앱을 닫으면 풀림
    return c;
  } catch { return {}; }
};
const writeConf = c => {
  try {
    if (c.remember === false) { sessionStorage.setItem(SERVER_KEY, c.token || ''); localStorage.setItem(SERVER_KEY, JSON.stringify({ ...c, token: '' })); }
    else { localStorage.setItem(SERVER_KEY, JSON.stringify(c)); sessionStorage.removeItem(SERVER_KEY); }
  } catch { /* 저장 불가 */ }
};
/** 자동 로그인을 쓸지 (이 기기 · 로그인 화면의 체크) */
export const AUTO_KEY = 'jcalender.autoLogin';
export const autoPref = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };

export function deviceName() {
  const ua = navigator.userAgent || '';
  const os = /iPhone/.test(ua) ? '아이폰' : /iPad/.test(ua) ? '아이패드' : /Android/.test(ua) ? '안드로이드' : /Mac/.test(ua) ? '맥' : /Windows/.test(ua) ? '윈도우' : '기기';
  const br = /Edg\//.test(ua) ? '엣지' : /Chrome\//.test(ua) ? '크롬' : /Safari\//.test(ua) ? '사파리' : /Firefox\//.test(ua) ? '파이어폭스' : '브라우저';
  return `${os} ${br}`;
}

export async function api(base, path, { method = 'GET', body, token, conflictOk = false } = {}) {
  let r;
  try {
    r = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('서버에 연결할 수 없습니다 (인터넷 연결을 확인해 주세요)'), { offline: true });
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 409 && conflictOk) return { conflict: true, ...j };
  if (!r.ok) throw Object.assign(new Error(j.error || `서버 오류 (${r.status})`), { status: r.status, server: typeof j.error === 'string' });   // server: Jcalender 서버가 직접 답함 (중간 프록시 오류와 구분)
  return j;
}

/** 로그인이 풀린 이유 기록 (다음 로그인 화면에 보여 줌 — 원인 찾기용) */
export const LOGOUT_KEY = 'jcalender.lastLogout';
export const noteLogout = (reason, detail = '') => { try { localStorage.setItem(LOGOUT_KEY, JSON.stringify({ at: new Date().toISOString(), reason, detail: String(detail).slice(0, 200) })); } catch { /* 무시 */ } };
/** 이 사이트 저장 데이터를 브라우저가 저절로 지우지 않게 요청 (안드로이드 크롬 · 설치 앱) */
export const keepStorage = () => { try { navigator.storage?.persist?.(); } catch { /* 지원 안 함 */ } };

const fmt = d => (d ? new Date(d).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const APP_KEYS = ['lifeboard.react.v1', 'jcalender.secrets', 'jcalender.migrateError'];

/** @param blank 새 사용자용 빈 데이터를 만드는 함수 (App.jsx) */
export function useServerSync(store, setStore, blank) {
  const [conf, setConfState] = useState(readConf);
  const [st, setSt] = useState({ busy: false, msg: null, err: false, conflict: null });
  const confRef = useRef(conf), storeRef = useRef(store), conflictRef = useRef(null);
  storeRef.current = store; conflictRef.current = st.conflict;
  const rev = useRef(0);                 // 이 기기에서 바뀐 횟수 (올리는 중에 또 바뀌었는지 확인)
  const applying = useRef(false);        // 서버 데이터 · 빈 데이터를 넣는 중 (이 변경은 "바뀜"으로 세지 않음)
  const timer = useRef(null), first = useRef(true), running = useRef(false);

  const setConf = useCallback(p => { const c = { ...confRef.current, ...p }; confRef.current = c; writeConf(c); setConfState(c); return c; }, []);
  const say = (msg, err = false) => setSt(s => ({ ...s, msg, err }));
  /** 401: 서버가 직접 "로그인 만료"라고 답했을 때만, 한 번 더 확인한 뒤 로그아웃 (중간 오류 · 잠깐의 문제로 로그인이 풀리지 않게) */
  const checking = useRef(false);
  const authFail = e => {
    if (e.status !== 401) return false;
    if (!e.server || checking.current) return true;
    const tok = confRef.current.token;
    if (!tok) return true;
    checking.current = true;
    api(API_BASE, '/api/me', { token: tok })
      .then(() => {})                                                 // 아직 유효 → 그대로 둠
      .catch(async x => {
        if (!(x.status === 401 && x.server && confRef.current.token === tok)) return;
        if (confRef.current.remember !== false && await autoLogin(true)) return;   // 자동 로그인 열쇠로 다시 로그인
        noteLogout('expired', x.message); setConf({ token: '' }); say('로그인이 만료되었습니다. 다시 로그인하세요', true);
      })
      .finally(() => { checking.current = false; });
    return true;
  };

  /** 데이터를 통째로 바꾸기 (API 키 · 토큰은 이 기기 것을 유지) */
  const replaceStore = useCallback(data => {
    applying.current = true;
    const next = mergeSecrets(migrate(data), splitSecrets(storeRef.current).secrets);
    storeRef.current = next;
    setStore(next);
    return next;
  }, [setStore]);

  const applyServer = useCallback((data, version) => {
    replaceStore(data);
    setConf({ version, dirty: false, lastSync: new Date().toISOString(), owner: confRef.current.email });
    setSt(s => ({ ...s, conflict: null, msg: `서버 데이터(버전 ${version})를 받았습니다`, err: false }));
  }, [replaceStore, setConf]);

  const push = useCallback(async (force = false) => {
    const c = confRef.current;
    if (!c.token || running.current) return false;
    running.current = true; setSt(s => ({ ...s, busy: true }));
    const sent = rev.current;
    try {
      const r = await api(API_BASE, '/api/sync', { method: 'PUT', token: c.token, conflictOk: true, body: { baseVersion: c.version || 0, data: splitSecrets(storeRef.current).data, device: deviceName(), force } });
      if (r.conflict) { setSt(s => ({ ...s, conflict: { version: r.version, device: r.device, updatedAt: r.updatedAt, data: r.data }, msg: null })); return false; }
      setConf({ version: r.version, dirty: rev.current !== sent, lastSync: new Date().toISOString(), owner: c.email });
      setSt(s => ({ ...s, conflict: null, msg: `서버에 저장했습니다 (버전 ${r.version})`, err: false }));
      return true;
    } catch (e) { if (!authFail(e)) say(e.message, true); return false; }
    finally { running.current = false; setSt(s => ({ ...s, busy: false })); }
  }, [setConf]);

  /** 서버에 새 버전이 있는지 확인 → 받기 / 올리기 / 충돌 */
  const check = useCallback(async () => {
    const c = confRef.current;
    if (!c.token || running.current) return;
    running.current = true;
    let next = null;
    try {
      const me = await api(API_BASE, '/api/me', { token: c.token });
      if (me.user?.name && me.user.name !== c.name) setConf({ name: me.user.name });
      if ((me.user?.role || '') !== (c.role || '')) setConf({ role: me.user?.role || '' });   // 회원 권한 (관리자가 바꾸면 반영)
      if ((me.user?.areas || '') !== (c.areas || '')) setConf({ areas: me.user?.areas || '' }); // 볼 수 있는 영역 (관리자가 회원 관리에서 체크)
      if (!!me.user?.shorts !== !!c.shorts) setConf({ shorts: !!me.user?.shorts });                // 숏폼 제작 권한 (회원 관리에서 체크)
      if (JSON.stringify(me.user?.screen ?? null) !== JSON.stringify(c.screen ?? null)) setConf({ screen: me.user?.screen ?? null });   // 회원 화면 (검수 완료 카테고리만)
      const sv = me.snapshot?.version || 0, mine = c.version || 0;
      const mineOwner = c.owner === c.email, otherOwner = c.owner && c.owner !== c.email;   // '-'(비어 있음) 도 "다른 사람"으로 본다
      if (!sv) {
        if (otherOwner) { replaceStore(blank()); setConf({ owner: c.email }); }       // 다른 사람 데이터는 올리지 않고 빈 데이터로 시작
        next = 'push';
      } else if (sv !== mine) {
        const r = await api(API_BASE, '/api/sync', { token: c.token });
        if (otherOwner || (mineOwner && !c.dirty)) applyServer(r.data, r.version);
        else setSt(s => ({ ...s, conflict: { version: r.version, device: r.device, updatedAt: r.updatedAt, data: r.data, first: !mine } }));
      } else if (c.dirty) next = 'push';
    } catch (e) { if (!authFail(e) && !e.offline) say(e.message, true); }
    finally { running.current = false; }
    if (next === 'push') push();
  }, [applyServer, push, replaceStore, blank, setConf]);

  // 데이터가 바뀌면 3초 뒤 올리기
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (applying.current) { applying.current = false; return; }
    if (!confRef.current.token) return;
    rev.current++;
    if (!confRef.current.dirty) setConf({ dirty: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!conflictRef.current) push(); }, PUSH_DELAY);   // 충돌을 고르기 전에는 올리지 않음
  }, [store]);

  useEffect(() => { if (conf.token) keepStorage(); }, []);   // 로그인한 기기: 저장 데이터를 지우지 않게 요청
  // 앱을 열 때 · 창으로 돌아올 때 · 5분마다 확인
  useEffect(() => {
    check();
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(check, CHECK_EVERY);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
  }, [conf.token]);

  /** 로그인 · 회원가입 공통: 토큰을 받으면 연결 정보를 저장하고, check() 가 받기 / 올리기를 정한다 */
  /** 로그인 결과를 이 기기에 넣기 (로그인 · 가입 · 자동 로그인 공통) */
  const accept = (r, remember) => {
    const c = confRef.current;
    const same = c.email === r.user.email;
    if (r.created) { replaceStore(blank()); }                  // 새 사용자는 빈 데이터로 시작 (이 기기에 있던 데이터는 올리지 않음)
    setConf({ token: r.token, email: r.user.email, name: r.user.name, role: r.user.role || '', areas: r.user.areas || '', shorts: !!r.user.shorts, screen: r.user.screen ?? null, remember,
      ...(same ? {} : { version: 0, dirty: false, lastSync: null }), ...(r.created ? { owner: r.user.email } : {}) });
    keepStorage(); try { localStorage.removeItem(LOGOUT_KEY); localStorage.setItem(AUTO_KEY, remember ? '1' : '0'); } catch { /* 무시 */ }
  };
  const enter = async (kind, body) => {
    setSt(s => ({ ...s, busy: true, msg: null }));
    try {
      const remember = body.remember !== false;
      const r = await api(API_BASE, kind === 'signup' ? '/api/signup' : '/api/login', { method: 'POST', body: { ...body, remember, device: deviceName() } });
      accept(r, remember);
      say(r.created ? `${r.user.name}님, 가입을 환영합니다` : `${r.user.name || r.user.email}님으로 로그인했습니다`);
      return true;
    } catch (e) { say(e.message, true); return false; }
    finally { setSt(s => ({ ...s, busy: false })); }
  };
  const login = (email, password, remember = true) => enter('login', { email, password, remember });
  const signup = f => enter('signup', f);
  /** 자동 로그인: 이 기기의 열쇠 쿠키로 새 로그인 (조용히 — 실패해도 안내 없음) */
  const autoBusy = useRef(false);
  const autoLogin = async (quiet = false) => {
    if (autoBusy.current) return false;
    autoBusy.current = true;
    if (!quiet) setSt(s => ({ ...s, auto: true }));
    try {
      const r = await api(API_BASE, '/api/auto-login', { method: 'POST', body: { device: deviceName() } });
      accept(r, true);
      return true;
    } catch { return false; }
    finally { autoBusy.current = false; setSt(s => ({ ...s, auto: false })); }
  };
  // 앱을 열었는데 로그인 정보가 없으면 자동 로그인부터 (켜 둔 기기만)
  useEffect(() => { if (!confRef.current.token && autoPref()) autoLogin(); }, []);

  /** 로그아웃: 안 올린 변경이 있으면 먼저 올리고, 이 브라우저의 데이터를 지운다. force 면 못 올려도 지움 */
  const logout = async (force = false) => {
    const c = confRef.current;
    if (c.dirty && !force) {
      const ok = await push();
      if (!ok) { say('서버에 아직 저장하지 못한 변경이 있습니다. 인터넷 연결을 확인하거나, 변경을 버리고 로그아웃하세요', true); return false; }
    }
    if (c.token) {
      let ep = null; try { ep = localStorage.getItem('jcalender.push'); localStorage.removeItem('jcalender.push'); } catch { /* 무시 */ }
      if (ep) await api(API_BASE, '/api/push/unsubscribe', { method: 'POST', token: c.token, body: { endpoint: ep } }).catch(() => {});   // 로그아웃한 기기로는 푸시를 보내지 않음
      await api(API_BASE, '/api/logout', { method: 'POST', token: c.token }).catch(() => {});
    }
    clearTimeout(timer.current);
    noteLogout('manual');
    try { APP_KEYS.forEach(k => localStorage.removeItem(k)); } catch { /* 무시 */ }
    writeConf({ owner: '-' });
    window.location.hash = '#/';
    window.location.reload();
    return true;
  };
  /** 로그인 없이 이 기기에서만 쓰기 (둘러보기) */

  const changePassword = async (current, next) => {
    const c = confRef.current;
    try { await api(API_BASE, '/api/password', { method: 'POST', token: c.token, body: { current, next } }); say('비밀번호를 바꿨습니다. 다른 기기는 다시 로그인해야 합니다'); return true; }
    catch (e) { if (!authFail(e)) say(e.message, true); return false; }
  };

  const takeServer = () => st.conflict && applyServer(st.conflict.data, st.conflict.version);
  const keepMine = () => { setSt(s => ({ ...s, conflict: null })); push(true); };

  return {
    connected: !!conf.token, conf, ...st, login, signup, logout, changePassword, autoLogin,
    /** 로그인한 계정으로 서버 API 부르기 (회원 관리 등) */
    request: (path, opts = {}) => api(API_BASE, path, { ...opts, token: confRef.current.token }).catch(e => { authFail(e); throw e; }),
    syncNow: () => (conf.dirty ? push() : check()), takeServer, keepMine,
    status: !conf.token ? '연결 안 됨' : st.conflict ? '선택 필요' : st.busy ? '동기화 중…' : conf.dirty ? '저장 대기 중' : `동기화됨${conf.lastSync ? ` · ${fmt(conf.lastSync)}` : ''}`,
    fmt,
  };
}
