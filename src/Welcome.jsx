import React, { useEffect, useState } from 'react';
import { DEFAULT_SERVER, api, normalizeUrl } from './serverSync.js';

/* 처음 화면: 로그인 / 회원가입 (사용자마다 서버에 자기 데이터)
   - 회원가입 방식은 서버가 정한다 (GET /api/config): 초대 코드 · 누구나 · 막힘
   - "로그인 없이 둘러보기"는 이 기기에만 저장 (나중에 설정 › 서버 연결에서 로그인 가능) */
export default function Welcome({ sync }) {
  return (
    <div className="welcome">
      <div className="wl-box">
        <div className="wl-brand"><b>Jcalender</b><span>일정 · 체크리스트 · 기록을 한곳에서</span></div>
        <AuthForm sync={sync} />
        <button type="button" className="wl-guest" onClick={sync.enterGuest}>로그인 없이 둘러보기 (이 기기에만 저장)</button>
      </div>
    </div>
  );
}

/** 로그인 · 회원가입 폼 (처음 화면과 설정 › 서버 연결에서 함께 사용) */
export function AuthForm({ sync, compact = false }) {
  const [tab, setTab] = useState('login');
  const [url, setUrl] = useState(sync.conf.url || DEFAULT_SERVER);
  const [f, setF] = useState({ email: sync.conf.email || '', password: '', password2: '', name: '', code: '' });
  const [mode, setMode] = useState(null);            // 서버의 회원가입 방식
  const [err, setErr] = useState(null);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    let alive = true;
    setMode(null);
    try {
      const base = normalizeUrl(url);
      api(base, '/api/config').then(r => alive && setMode(r.signup)).catch(() => alive && setMode('unknown'));
    } catch { setMode('unknown'); }
    return () => { alive = false; };
  }, [url]);

  const submit = async e => {
    e.preventDefault(); setErr(null);
    if (tab === 'login') { if (await sync.login(url, f.email, f.password)) setF(p => ({ ...p, password: '' })); return; }
    if (f.password.length < 8) return setErr('비밀번호는 8자 이상이어야 합니다');
    if (f.password !== f.password2) return setErr('두 비밀번호가 다릅니다');
    await sync.signup(url, { email: f.email, password: f.password, name: f.name, code: f.code });
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
        {msg && <p className="sh-msg err" role="alert">{msg}</p>}
        <button className="btn primary" disabled={sync.busy || (tab === 'signup' && mode === 'closed')}>
          {sync.busy ? '연결 중…' : tab === 'login' ? '로그인' : '가입하고 시작하기'}
        </button>
        {tab === 'signup' && <p className="auth-note">가입하면 빈 화면에서 시작합니다. 내 데이터는 내 계정에만 저장되고 다른 사람과 섞이지 않습니다.</p>}
      </form>
      <details className="auth-server">
        <summary>서버 주소{mode === 'unknown' ? ' (연결 안 됨)' : ''}</summary>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder={DEFAULT_SERVER} aria-label="서버 주소" />
      </details>
    </div>
  );
}
