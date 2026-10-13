import React, { useEffect, useState } from 'react';
import { API_BASE, LOGOUT_KEY, api } from './serverSync.js';

/* 처음 화면: 로그인 / 회원가입 (사용자마다 서버에 자기 데이터)
   - 회원가입 방식은 서버가 정한다 (GET /api/config): 초대 코드 · 누구나 · 막힘
   - 로그인해야만 쓸 수 있다 (로그인 없이 둘러보기 없음), 서버 주소는 화면에 보이지 않는다 */
export default function Welcome({ sync }) {
  return (
    <div className="welcome">
      <div className="wl-box">
        <div className="wl-brand"><b>Jcalender</b><span>일정 · 체크리스트 · 기록을 한곳에서</span></div>
        <AuthForm sync={sync} />
        <LastLogout />
      </div>
    </div>
  );
}

/** 지난번에 로그인이 풀린 이유 (원인 찾기용, 다시 로그인하면 지워짐) */
function LastLogout() {
  let x = null;
  try { x = JSON.parse(localStorage.getItem(LOGOUT_KEY) || 'null'); } catch { /* 무시 */ }
  if (!x?.at) return null;
  const d = new Date(x.at), when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return <p className="auth-note wl-last">지난 로그아웃: {when} · {x.reason === 'manual' ? '직접 로그아웃' : `서버가 로그인 만료로 응답${x.detail ? ` (${x.detail})` : ''}`}</p>;
}

/** 아이디 저장: 로그아웃해도 이 브라우저에 이메일만 남겨 다음 로그인에 채움 (비밀번호는 저장 안 함) */
const ID_KEY = 'jcalender.savedId';
const readId = () => { try { return localStorage.getItem(ID_KEY) || ''; } catch { return ''; } };
const writeId = v => { try { if (v) localStorage.setItem(ID_KEY, v); else localStorage.removeItem(ID_KEY); } catch { /* 저장 불가 */ } };

/** 로그인 · 회원가입 폼 (처음 화면과 설정 › 서버 연결에서 함께 사용) */
export function AuthForm({ sync, compact = false }) {
  const [tab, setTab] = useState('login');
  const [f, setF] = useState(() => ({ email: sync.conf.email || readId(), password: '', password2: '', name: '', code: '' }));
  const [saveId, setSaveId] = useState(() => !!readId());
  const [mode, setMode] = useState(null);            // 서버의 회원가입 방식
  const [err, setErr] = useState(null);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    let alive = true;
    setMode(null);
    api(API_BASE, '/api/config').then(r => alive && setMode(r.signup)).catch(() => alive && setMode('unknown'));
    return () => { alive = false; };
  }, []);

  const submit = async e => {
    e.preventDefault(); setErr(null);
    if (tab === 'login') { if (await sync.login(f.email, f.password)) { writeId(saveId ? f.email.trim() : ''); setF(p => ({ ...p, password: '' })); } return; }
    if (f.password.length < 8) return setErr('비밀번호는 8자 이상이어야 합니다');
    if (f.password !== f.password2) return setErr('두 비밀번호가 다릅니다');
    if (await sync.signup({ email: f.email, password: f.password, name: f.name, code: f.code })) writeId(saveId ? f.email.trim() : '');
  };
  const msg = err || (sync.err && sync.msg);
  return (
    <div className={`auth ${compact ? 'compact' : ''}`}>
      <div className="auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'login'} className={tab === 'login' ? 'on' : ''} onClick={() => { setTab('login'); setErr(null); }}>로그인</button>
        <button type="button" role="tab" aria-selected={tab === 'signup'} className={tab === 'signup' ? 'on' : ''} onClick={() => { setTab('signup'); setErr(null); }}>회원가입</button>
      </div>
      <form className="auth-form" onSubmit={submit}>
        {tab === 'signup' && <label>이름<input value={f.name} onChange={set('name')} autoComplete="name" required maxLength={100} /></label>}
        <label>이메일<input type="email" value={f.email} onChange={set('email')} autoComplete={tab === 'login' ? 'username' : 'email'} required /></label>
        <label>비밀번호<input type="password" value={f.password} onChange={set('password')} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} required minLength={tab === 'signup' ? 8 : undefined} placeholder={tab === 'signup' ? '8자 이상' : ''} /></label>
        {tab === 'signup' && <label>비밀번호 확인<input type="password" value={f.password2} onChange={set('password2')} autoComplete="new-password" required /></label>}
        {tab === 'signup' && mode === 'code' && <label>초대 코드<input value={f.code} onChange={set('code')} placeholder="관리자에게 받은 코드 (예: AB12-CD34)" required autoCapitalize="characters" /></label>}
        {tab === 'signup' && mode === 'closed' && <p className="auth-note">지금은 회원가입을 받지 않습니다. 관리자에게 계정을 요청하세요.</p>}
        <label className="auth-save"><input type="checkbox" checked={saveId} onChange={e => { setSaveId(e.target.checked); if (!e.target.checked) writeId(''); }} />아이디 저장</label>
        {msg && <p className="sh-msg err" role="alert">{msg}</p>}
        <button className="btn primary" disabled={sync.busy || (tab === 'signup' && mode === 'closed')}>
          {sync.busy ? '연결 중…' : tab === 'login' ? '로그인' : '가입하고 시작하기'}
        </button>
        {tab === 'signup' && <p className="auth-note">가입하면 빈 화면에서 시작합니다. 내 데이터는 내 계정에만 저장되고 다른 사람과 섞이지 않습니다.</p>}
      </form>
      {mode === 'unknown' && <p className="auth-note">서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>}
    </div>
  );
}
