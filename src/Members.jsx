import React, { useEffect, useState } from 'react';
import { useCtx } from './shared.jsx';

/* 회원 관리 (관리자 계정만 — 서버 OWNER_EMAILS, 기본 koreamate2026@gmail.com)
   회원 목록 · 권한(일반 · 정지) · 모든 기기 로그아웃 · 회원가입 방식 · 초대 코드
   서버 API: GET/POST /api/admin/users, GET/POST /api/admin/signup (server/index.mjs)
   - 관리자는 관리자 계정 하나뿐이고, 다른 회원을 관리자로 만들 수 없다
   - 정지하면 그 회원의 모든 기기가 로그아웃되고 다시 로그인할 수 없다 (데이터는 그대로) */
export const ROLE = { admin: '관리자', member: '일반', suspended: '정지' };
const ROLE_DESC = { admin: '회원 관리 · 진행 현황까지', member: '내 데이터만', suspended: '로그인 불가 (데이터는 보관)' };
const CHOICES = ['member', 'suspended'];                     // 회원에게 줄 수 있는 권한
const SIGNUP = { code: '초대 코드가 있어야 가입', open: '누구나 가입', closed: '가입 막기' };
const dt = d => (d ? new Date(d).toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const kb = n => (n == null ? '-' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

export default function Members() {
  const { sync } = useCtx();
  const [users, setUsers] = useState(null);
  const [signup, setSignup] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [arm, setArm] = useState(null);                     // 정지 · 관리자 지정 확인
  const [showCode, setShowCode] = useState(false);
  const say = (text, err = false) => setMsg({ text, err });

  const load = async () => {
    setBusy(true);
    try {
      const [u, s] = await Promise.all([sync.request('/api/admin/users'), sync.request('/api/admin/signup')]);
      setUsers(u.users); setSignup(s);
    } catch (e) {
      say(e.status === 404 ? '서버가 아직 회원 관리를 지원하지 않습니다. VPS 서버를 업데이트하세요 (bash server/deploy/update.sh)' : e.message, true);
    } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  const setRole = async (u, role) => {
    if (role === 'suspended' && arm !== `${u.email}|${role}`) { setArm(`${u.email}|${role}`); setTimeout(() => setArm(a => (a === `${u.email}|${role}` ? null : a)), 4000); return; }
    setArm(null); setBusy(true);
    try { await sync.request('/api/admin/users', { method: 'POST', body: { email: u.email, role } }); say(`${u.name || u.email}님의 권한을 "${ROLE[role]}"(으)로 바꿨습니다${role === 'suspended' ? ' · 모든 기기에서 로그아웃됨' : ''}`); await load(); }
    catch (e) { say(e.message, true); setBusy(false); }
  };
  const logoutAll = async u => {
    setBusy(true);
    try { const r = await sync.request('/api/admin/users', { method: 'POST', body: { email: u.email, logout: true } }); say(`${u.name || u.email}님의 기기 ${r.loggedOut}대를 로그아웃했습니다`); await load(); }
    catch (e) { say(e.message, true); setBusy(false); }
  };
  const setMode = async (body, text) => {
    setBusy(true);
    try { setSignup(await sync.request('/api/admin/signup', { method: 'POST', body })); say(text); }
    catch (e) { say(e.message, true); }
    finally { setBusy(false); }
  };
  const copy = t => navigator.clipboard?.writeText(t).then(() => say('초대 코드를 복사했습니다'), () => say('복사하지 못했습니다. 직접 선택해 복사하세요', true));

  const me = String(sync.conf.email || '').toLowerCase();
  const list = (users || []).filter(u => !q || `${u.email} ${u.name}`.toLowerCase().includes(q.toLowerCase()));
  const count = r => (users || []).filter(u => u.role === r).length;

  return (
    <>
      <header className="page-h"><h1>회원 관리</h1><p>회원을 정지하거나 다시 쓰게 하고, 회원가입 방식과 초대 코드를 관리합니다. 관리자 계정({sync.conf.email})에서만 보입니다.</p></header>
      {msg && <p className={`banner ${msg.err ? '' : 'ok'} mb-msg`} role="status">{msg.text}</p>}

      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">전체 회원</span><b>{users ? `${users.length}명` : '-'}</b><span className="hv-sub">최근 30일 로그인 {users ? users.filter(u => u.lastLoginAt && Date.now() - new Date(u.lastLoginAt) < 30 * 864e5).length : '-'}명</span></div>
        <div className="hv-stat ex"><span className="muted">일반</span><b>{users ? `${count('member')}명` : '-'}</b><span className="hv-sub">{ROLE_DESC.member}</span></div>
        <div className="hv-stat ex"><span className="muted">정지</span><b>{users ? `${count('suspended')}명` : '-'}</b><span className="hv-sub">{ROLE_DESC.suspended}</span></div>
      </div>

      <section className="panel">
        <div className="csum-h"><h2>회원가입 방식</h2>{signup && <span className="muted">지금: {SIGNUP[signup.mode]}</span>}</div>
        {signup ? <>
          <div className="chips" role="group" aria-label="회원가입 방식">
            {Object.entries(SIGNUP).map(([k, n]) => <button key={k} aria-pressed={signup.mode === k} disabled={busy} onClick={() => signup.mode !== k && setMode({ mode: k }, `회원가입 방식: ${n}`)}>{n}</button>)}
          </div>
          {signup.mode === 'code' && <div className="mb-code">
            <span className="muted">초대 코드</span>
            <code>{showCode ? signup.code : '••••-••••'}</code>
            <button className="btn sm" onClick={() => setShowCode(v => !v)}>{showCode ? '가리기' : '보기'}</button>
            <button className="btn sm" onClick={() => copy(signup.code)}>복사</button>
            <button className="btn sm" disabled={busy} onClick={() => setMode({ newCode: true }, '새 초대 코드를 만들었습니다. 예전 코드로는 가입할 수 없습니다')}>새 코드 만들기</button>
          </div>}
          <p className="note">새 코드를 만들어도 이미 가입한 회원은 그대로 로그인합니다. "누구나 가입"은 주소를 아는 누구나 가입할 수 있으니 잠깐만 쓰세요.</p>
        </> : <p className="muted">{busy ? '불러오는 중…' : '-'}</p>}
      </section>

      <section className="panel">
        <div className="csum-h"><h2>회원 목록</h2><span className="muted">{users ? `${list.length}명` : ''}</span>
          <input type="search" className="mb-q" value={q} onChange={e => setQ(e.target.value)} placeholder="이름 · 이메일 검색" aria-label="회원 검색" />
          <button className="btn sm grow-r" onClick={load} disabled={busy}>{busy ? '불러오는 중…' : '새로고침'}</button></div>
        {users && <div className="tablewrap"><table className="prog fv-table mb-table">
          <thead><tr><th>회원</th><th>권한</th><th>가입</th><th>마지막 로그인</th><th>로그인 기기</th><th>데이터</th><th /></tr></thead>
          <tbody>{list.map(u => {
            const self = u.email.toLowerCase() === me, locked = u.owner || self;
            return (
              <tr key={u.email} className={u.role === 'suspended' ? 'off' : ''}>
                <td><b>{u.name || '(이름 없음)'}</b>{u.owner && <span className="tag mb-owner">관리자 계정</span>}<br /><small className="muted">{u.email}</small></td>
                <td>{locked
                  ? <span className={`mb-role ${u.role}`} title="관리자 계정의 권한은 바꿀 수 없습니다">{ROLE[u.role]}</span>
                  : <div className="mb-roles" role="group" aria-label={`${u.email} 권한`}>{CHOICES.map(k => [k, ROLE[k]]).map(([k, n]) => (
                    <button key={k} className={`${u.role === k ? `on ${k}` : ''} ${arm === `${u.email}|${k}` ? 'arm' : ''}`} aria-pressed={u.role === k} disabled={busy}
                      onClick={() => u.role !== k && setRole(u, k)} title={ROLE_DESC[k]}>{arm === `${u.email}|${k}` ? `정말 ${n}?` : n}</button>))}</div>}</td>
                <td className="nw">{dt(u.createdAt).split(' ').slice(0, 3).join(' ')}</td>
                <td className="nw">{dt(u.lastLoginAt)}</td>
                <td className="c">{u.sessions}대</td>
                <td className="nw"><small>{u.syncedAt ? `${kb(u.size)} · ${dt(u.syncedAt)}` : '아직 없음'}</small></td>
                <td>{!self && u.sessions > 0 && <button className="btn sm" disabled={busy} onClick={() => logoutAll(u)}>모든 기기 로그아웃</button>}</td>
              </tr>);
          })}</tbody></table></div>}
        <p className="note">관리자: 이 계정 하나뿐 (회원 관리 · 진행 현황) · 일반: 자기 데이터만 · 정지: 로그인할 수 없음(데이터는 지우지 않음). 회원 삭제 · 비밀번호 초기화는 VPS 에서 jcal-admin 으로 합니다.</p>
      </section>
    </>
  );
}
