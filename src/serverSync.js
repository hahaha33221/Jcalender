/* VPS 서버 동기화 (server/index.mjs)
   - 설정 › 서버 연결에서 로그인하면 이 브라우저의 데이터(비밀 정보 제외)를 서버와 주고받는다
   - 바뀌면 3초 뒤 올리고, 앱을 열 때 · 창으로 돌아올 때 · 5분마다 서버에 새 버전이 있는지 확인한다
   - 서버 버전이 이 기기가 알던 버전보다 새로운데 이 기기에도 안 올린 변경이 있으면 "충돌" → 사용자가 고른다
   - 연결 정보는 jcalender.server 키에 (토큰은 서버에서 해시로만 보관) */
import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeSecrets, migrate, splitSecrets } from './schema.js';

export const SERVER_KEY = 'jcalender.server';
export const DEFAULT_SERVER = 'https://jcal-31-97-71-87.sslip.io';
const PUSH_DELAY = 3000, CHECK_EVERY = 5 * 60 * 1000;

const readConf = () => { try { return JSON.parse(localStorage.getItem(SERVER_KEY) || 'null') || {}; } catch { return {}; } };
const writeConf = c => { try { localStorage.setItem(SERVER_KEY, JSON.stringify(c)); } catch { /* 저장 불가 */ } };

export function deviceName() {
  const ua = navigator.userAgent || '';
  const os = /iPhone/.test(ua) ? '아이폰' : /iPad/.test(ua) ? '아이패드' : /Android/.test(ua) ? '안드로이드' : /Mac/.test(ua) ? '맥' : /Windows/.test(ua) ? '윈도우' : '기기';
  const br = /Edg\//.test(ua) ? '엣지' : /Chrome\//.test(ua) ? '크롬' : /Safari\//.test(ua) ? '사파리' : /Firefox\//.test(ua) ? '파이어폭스' : '브라우저';
  return `${os} ${br}`;
}

/** 서버 주소 확인: https (내 컴퓨터 시험용 http://localhost 만 예외) */
export function normalizeUrl(u) {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//i.test(s)) s = `https://${s}`;
  const url = new URL(s);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('서버 주소는 https:// 로 시작해야 합니다');
  return url.origin;
}

async function api(base, path, { method = 'GET', body, token } = {}) {
  let r;
  try {
    r = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('서버에 연결할 수 없습니다 (인터넷 · 서버 주소 확인)'), { offline: true });
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 409) return { conflict: true, ...j };
  if (!r.ok) throw Object.assign(new Error(j.error || `서버 오류 (${r.status})`), { status: r.status });
  return j;
}

const fmt = d => (d ? new Date(d).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function useServerSync(store, setStore) {
  const [conf, setConfState] = useState(readConf);   // { url, token, email, name, version, dirty, lastSync }
  const [st, setSt] = useState({ busy: false, msg: null, err: false, conflict: null });
  const confRef = useRef(conf), storeRef = useRef(store), conflictRef = useRef(null);
  storeRef.current = store; conflictRef.current = st.conflict;
  const rev = useRef(0);                 // 이 기기에서 바뀐 횟수 (올리는 중에 또 바뀌었는지 확인)
  const applying = useRef(false);        // 서버 데이터를 넣는 중 (이 변경은 다시 올리지 않음)
  const timer = useRef(null), first = useRef(true), running = useRef(false);

  const setConf = useCallback(p => { const c = { ...confRef.current, ...p }; confRef.current = c; writeConf(c); setConfState(c); return c; }, []);
  const say = (msg, err = false) => setSt(s => ({ ...s, msg, err }));
  const authFail = e => { if (e.status === 401) { setConf({ token: '' }); say('로그인이 만료되었습니다. 다시 로그인하세요', true); return true; } return false; };

  /** 서버 데이터를 이 기기에 넣기 (API 키 · 토큰은 이 기기 것을 유지) */
  const applyServer = useCallback((data, version) => {
    applying.current = true;
    setStore(s => mergeSecrets(migrate(data), splitSecrets(s).secrets));
    setConf({ version, dirty: false, lastSync: new Date().toISOString() });
    setSt(s => ({ ...s, conflict: null, msg: `서버 데이터(버전 ${version})를 받았습니다`, err: false }));
  }, [setConf, setStore]);

  const push = useCallback(async (force = false) => {
    const c = confRef.current;
    if (!c.token || running.current) return;
    running.current = true; setSt(s => ({ ...s, busy: true }));
    const sent = rev.current;
    try {
      const r = await api(c.url, '/api/sync', { method: 'PUT', token: c.token, body: { baseVersion: c.version || 0, data: splitSecrets(storeRef.current).data, device: deviceName(), force } });
      if (r.conflict) setSt(s => ({ ...s, conflict: { version: r.version, device: r.device, updatedAt: r.updatedAt, data: r.data }, msg: null }));
      else {
        setConf({ version: r.version, dirty: rev.current !== sent, lastSync: new Date().toISOString() });
        setSt(s => ({ ...s, conflict: null, msg: `서버에 올렸습니다 (버전 ${r.version})`, err: false }));
      }
    } catch (e) { if (!authFail(e)) say(e.message, true); }
    finally { running.current = false; setSt(s => ({ ...s, busy: false })); }
  }, [setConf]);

  /** 서버에 새 버전이 있는지 확인 → 받기 / 올리기 / 충돌 */
  const check = useCallback(async () => {
    const c = confRef.current;
    if (!c.token || running.current) return;
    running.current = true;
    let next = null;
    try {
      const me = await api(c.url, '/api/me', { token: c.token });
      const sv = me.snapshot?.version || 0, mine = c.version || 0;
      if (!sv) next = 'push';                                            // 서버가 비어 있으면 이 기기 데이터를 올림
      else if (sv !== mine) {
        const r = await api(c.url, '/api/sync', { token: c.token });
        if (c.dirty || !mine) setSt(s => ({ ...s, conflict: { version: r.version, device: r.device, updatedAt: r.updatedAt, data: r.data, first: !mine } }));
        else applyServer(r.data, r.version);
      } else if (c.dirty) next = 'push';
    } catch (e) { if (!authFail(e) && !e.offline) say(e.message, true); }
    finally { running.current = false; }
    if (next === 'push') push();
  }, [applyServer, push]);

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

  // 앱을 열 때 · 창으로 돌아올 때 · 5분마다 확인
  useEffect(() => {
    check();
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(check, CHECK_EVERY);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
  }, [conf.token]);

  const login = async (url, email, password) => {
    setSt(s => ({ ...s, busy: true, msg: null }));
    try {
      const base = normalizeUrl(url);
      const r = await api(base, '/api/login', { method: 'POST', body: { email, password, device: deviceName() } });
      const same = confRef.current.url === base && confRef.current.email === r.user.email;
      setConf({ url: base, token: r.token, email: r.user.email, name: r.user.name, ...(same ? {} : { version: 0, dirty: false, lastSync: null }) });
      say(`${r.user.email} 로 로그인했습니다`);
      return true;
    } catch (e) { say(e.message, true); return false; }
    finally { setSt(s => ({ ...s, busy: false })); }
  };
  const logout = async () => {
    const c = confRef.current;
    if (c.token) api(c.url, '/api/logout', { method: 'POST', token: c.token }).catch(() => {});
    setConf({ token: '' });
    setSt({ busy: false, msg: '로그아웃했습니다. 이 기기 데이터는 그대로 남습니다', err: false, conflict: null });
  };
  const takeServer = () => st.conflict && applyServer(st.conflict.data, st.conflict.version);
  const keepMine = () => { setSt(s => ({ ...s, conflict: null })); push(true); };

  return {
    connected: !!conf.token, conf, ...st, login, logout, syncNow: () => (conf.dirty ? push() : check()), takeServer, keepMine,
    status: !conf.token ? '연결 안 됨' : st.conflict ? '선택 필요' : st.busy ? '동기화 중…' : conf.dirty ? '올릴 변경 있음' : `동기화됨${conf.lastSync ? ` · ${fmt(conf.lastSync)}` : ''}`,
    fmt,
  };
}
