import React, { useRef, useState } from 'react';
import { AREAS } from './data.js';
import { useCtx } from './shared.jsx';
import { download } from './xlsx.js';
import { TRASH_TYPES, exportJson, importJson, mergeSecrets, restoreTrash, splitSecrets } from './schema.js';
import { TAG_COLORS } from './common.jsx';
import { AuthForm } from './Welcome.jsx';

/* 설정 › 데이터 관리 (schema.js v2 의 새 테이블 화면)
   백업(내보내기·가져오기) · 카테고리(표시·목표 보드·순서) · 프로젝트 · 태그 · 휴지통 · 알림 */
const uid = () => Math.random().toString(36).slice(2, 10);

export default function DataSettings({ hideBackup = false }) {   // hideBackup: 일반 회원 (관리자 계정 · 로그인 안 함에서만 백업)
  return (
    <>
      {!hideBackup && <Backup />}
      <Notify />
      <Categories />
      <Projects />
      <Tags />
      <Trash />
    </>
  );
}

/* ── 계정 · 서버 연결 (serverSync.js, Welcome.jsx) ── */
export function AccountPanel() {
  const { sync } = useCtx();
  const c = sync.conf;
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ cur: '', next: '', next2: '' });
  const [pwErr, setPwErr] = useState(null);
  const [stuck, setStuck] = useState(false);               // 저장 못 한 변경 때문에 로그아웃이 멈춤
  const changePw = async e => {
    e.preventDefault(); setPwErr(null);
    if (pw.next.length < 8) return setPwErr('새 비밀번호는 8자 이상이어야 합니다');
    if (pw.next !== pw.next2) return setPwErr('새 비밀번호 두 개가 다릅니다');
    if (await sync.changePassword(pw.cur, pw.next)) { setPw({ cur: '', next: '', next2: '' }); setPwOpen(false); }
  };
  const out = async () => { if (!(await sync.logout())) setStuck(true); };
  const cf = sync.conflict;
  const cnt = d => [['일정', d?.events?.length], ['인맥', d?.people?.length], ['기념일', d?.anniv?.length], ['지출', d?.finance?.expenses?.length]]
    .filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ');
  return (
    <section className="panel ds">
      <div className="csum-h"><h2>계정 · 서버 연결</h2><span className={`muted ${sync.connected ? 'srv-on' : ''}`}>{sync.status}</span></div>
      {!sync.connected ? (
        <>
          <p className="note">로그인하면 내 데이터가 서버의 내 계정에 저장되어 다른 기기에서도 같은 데이터를 씁니다.</p>
          <AuthForm sync={sync} compact />
        </>
      ) : (
        <>
          <div className="ds-row">
            <span><b>{c.name || c.email}</b> · {c.email} · 서버 버전 {c.version || 0}</span>
            <button className="btn" onClick={sync.syncNow} disabled={sync.busy}>지금 동기화</button>
            <button className="btn" onClick={() => setPwOpen(o => !o)}>비밀번호 바꾸기</button>
            <button className="btn" onClick={out}>로그아웃</button>
          </div>
          {pwOpen && <form className="srv-form" onSubmit={changePw}>
            <label>지금 비밀번호<input type="password" value={pw.cur} onChange={e => setPw(p => ({ ...p, cur: e.target.value }))} autoComplete="current-password" required /></label>
            <label>새 비밀번호<input type="password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} autoComplete="new-password" required /></label>
            <label>새 비밀번호 확인<input type="password" value={pw.next2} onChange={e => setPw(p => ({ ...p, next2: e.target.value }))} autoComplete="new-password" required /></label>
            <button className="btn primary">바꾸기</button>
            {pwErr && <p className="sh-msg err" role="alert">{pwErr}</p>}
          </form>}
          {stuck && <div className="ds-confirm" role="alert">
            <span>서버에 아직 저장하지 못한 변경이 있어 로그아웃을 멈췄습니다. 인터넷이 연결되면 다시 눌러 주세요.</span>
            <span className="ds-row"><button className="btn danger" onClick={() => sync.logout(true)}>변경을 버리고 로그아웃</button><button className="btn" onClick={() => setStuck(false)}>취소</button></span>
          </div>}
        </>
      )}
      {cf && <div className="ds-confirm" role="alert">
        {cf.first
          ? <span>서버의 내 계정에 이미 데이터가 있습니다 ({cnt(cf.data) || '내용 있음'} · {cf.device || '다른 기기'} {sync.fmt(cf.updatedAt)}). 어느 쪽을 쓸지 고르세요.</span>
          : <span>다른 기기({cf.device || '알 수 없음'}, {sync.fmt(cf.updatedAt)})에서 서버 데이터가 바뀌었는데, 이 기기에도 아직 안 올린 변경이 있습니다.</span>}
        <span className="ds-row">
          <button className="btn primary" onClick={sync.takeServer}>서버 데이터 받기 (이 기기 데이터 대체)</button>
          <button className="btn danger" onClick={sync.keepMine}>이 기기 데이터로 서버 덮어쓰기</button>
        </span>
        <span className="muted">어느 쪽이든 고르기 전에 아래 "백업 파일 내려받기"로 이 기기 데이터를 받아 두면 안전합니다.</span>
      </div>}
      {sync.msg && !sync.err && <p className="sh-msg" role="status">{sync.msg}</p>}
      {sync.msg && sync.err && sync.connected && <p className="sh-msg err" role="alert">{sync.msg}</p>}
      <p className="note">{sync.connected
        ? '바뀐 내용은 3초 뒤 서버의 내 계정에 저장되고, 다른 기기는 열 때와 5분마다 받아옵니다. 로그아웃하면 이 브라우저에서는 데이터가 지워지고(서버에는 남음), 다시 로그인하면 받아옵니다. API 키 · 토큰은 서버로 보내지 않습니다.'
        : '로그인하지 않으면 데이터는 이 브라우저에만 저장됩니다.'}</p>
    </section>
  );
}

/* ── 백업 ── */
function Backup() {
  const { store, setStore } = useCtx();
  const ref = useRef(null);
  const [pending, setPending] = useState(null);             // 가져올 데이터 (확인 전)
  const [msg, setMsg] = useState(null);
  const meta = store.meta || {};
  const exportNow = () => {
    const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    download(exportJson(store), `jcalender_backup_${stamp}.json`, 'application/json');
    setStore(s => ({ ...s, meta: { ...(s.meta || {}), lastBackupAt: d.toISOString().slice(0, 16).replace('T', ' ') } }));
    setMsg({ t: '백업 파일을 내려받았습니다. API 키·토큰은 들어 있지 않습니다.' });
  };
  const pick = async file => {
    if (!file) return;
    try { setPending({ name: file.name, data: importJson(await file.text()) }); setMsg(null); }
    catch (e) { setMsg({ err: true, t: `파일을 읽지 못했습니다: ${e.message}` }); }
    finally { if (ref.current) ref.current.value = ''; }
  };
  const apply = () => {
    setStore(s => mergeSecrets(pending.data, splitSecrets(s).secrets));   // 백업에 없는 API 키·토큰은 지금 것을 유지
    setMsg({ t: `${pending.name} 로 모든 데이터를 바꿨습니다.` }); setPending(null);
  };
  const cnt = d => [['일정', d.events?.length], ['인맥', d.people?.length], ['기념일', d.anniv?.length], ['지출', d.finance?.expenses?.length], ['기획', d.plan?.plans?.length]]
    .filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ');
  return (
    <section className="panel ds">
      <div className="csum-h"><h2>백업</h2><span className="muted">마지막 백업 {meta.lastBackupAt || '없음'} · 저장 구조 v{meta.schemaVersion || '-'}</span></div>
      <div className="ds-row">
        <button className="btn primary" onClick={exportNow}>백업 파일 내려받기 (.json)</button>
        <label className="btn">백업 파일로 되돌리기<input ref={ref} type="file" accept=".json,application/json" hidden onChange={e => pick(e.target.files[0])} /></label>
      </div>
      {pending && <div className="ds-confirm" role="alert">
        <b>{pending.name}</b> ({cnt(pending.data) || '내용 확인'}) 로 지금 데이터를 모두 바꿉니다. 되돌릴 수 없으니 먼저 지금 데이터를 백업해 두세요.
        <span className="ds-row"><button className="btn danger" onClick={apply}>바꾸기</button><button className="btn" onClick={() => setPending(null)}>취소</button></span></div>}
      {msg && <p className={`sh-msg ${msg.err ? 'err' : ''}`} role="status">{msg.t}</p>}
      <p className="note">다른 컴퓨터·휴대폰으로 옮길 때도 이 파일을 쓰면 됩니다. API 키·토큰은 보안을 위해 파일에서 빠지고 이 브라우저에만 남습니다.</p>
    </section>
  );
}

/* ── 알림 ── */
function Notify() {
  const { store, setStore } = useCtx();
  const N = { enabled: false, eventMinutes: 10, planDays: 1, ...(store.notify || {}) };
  const set = p => setStore(s => ({ ...s, notify: { ...N, ...(s.notify || {}), ...p } }));
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const turnOn = async on => {
    if (on && perm === 'default') { try { await Notification.requestPermission(); } catch { /* 무시 */ } }
    set({ enabled: on });
  };
  const sent = (store.notifications || []).slice(0, 5);
  return (
    <section className="panel ds">
      <div className="csum-h"><h2>알림</h2><span className="muted">앱이 열려 있을 때 일정·기획 마감을 알려 줍니다</span></div>
      <div className="ds-row">
        <label className="ds-chk"><input type="checkbox" checked={N.enabled} onChange={e => turnOn(e.target.checked)} />알림 켜기</label>
        <label>일정<select value={N.eventMinutes} onChange={e => set({ eventMinutes: Number(e.target.value) })} disabled={!N.enabled}>
          {[[0, '정각'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전'], [1440, '하루 전']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>기획 마감<select value={N.planDays} onChange={e => set({ planDays: Number(e.target.value) })} disabled={!N.enabled}>
          {[[-1, '알리지 않음'], [0, '당일 오전 9시'], [1, '하루 전 오전 9시'], [3, '3일 전 오전 9시']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <span className="muted">{perm === 'granted' ? '브라우저 알림 허용됨' : perm === 'denied' ? '브라우저 알림이 막혀 있어 화면 안 알림만 뜹니다' : perm === 'unsupported' ? '이 브라우저는 알림을 지원하지 않아 화면 안 알림만 뜹니다' : '켜면 브라우저 알림 허용을 묻습니다'}</span>
      </div>
      {sent.length > 0 && <ul className="ds-list">{sent.map(n => <li key={n.id}><span className="muted">{n.at}</span> <b>{n.title}</b> {n.body}</li>)}</ul>}
      <p className="note">일정마다 알림 시간을 따로 정하려면 캘린더에서 일정을 눌러 "알림"을 고르세요.</p>
    </section>
  );
}

/* ── 카테고리 ── */
function Categories() {
  const { store, setStore } = useCtx();
  const cats = store.categories || [];
  const [area, setArea] = useState('P');
  const list = cats.filter(c => c.area === area).sort((a, b) => a.order - b.order);
  const upd = (key, patch) => setStore(s => ({ ...s, categories: s.categories.map(c => (c.key === key ? { ...c, ...patch } : c)) }));
  const move = (i, d) => {
    const a = list[i], b = list[i + d];
    if (!a || !b) return;
    setStore(s => ({ ...s, categories: s.categories.map(c => (c.key === a.key ? { ...c, order: b.order } : c.key === b.key ? { ...c, order: a.order } : c)) }));
  };
  return (
    <section className="panel ds">
      <div className="csum-h"><h2>카테고리</h2><span className="muted">상세 내용에 보일 카테고리 · 순서 · 목표 보드</span>
        <span className="grow" /><span className="chips">{Object.entries(AREAS).map(([k, v]) => <button key={k} aria-pressed={area === k} onClick={() => setArea(k)}>{v.n} {cats.filter(c => c.area === k && !c.hidden).length}</button>)}</span></div>
      <div className="tablewrap"><table className="fv-table ds-table">
        <thead><tr><th>순서</th><th>카테고리</th><th>표시</th><th>목표 보드</th></tr></thead>
        <tbody>{list.map((c, i) => (
          <tr key={c.key} className={c.hidden ? 'ds-off' : ''}>
            <td className="c nw"><button className="btn xs" onClick={() => move(i, -1)} disabled={!i} aria-label={`${c.name} 위로`}>▲</button> <button className="btn xs" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`${c.name} 아래로`}>▼</button></td>
            <td className="ds-name">{c.name}</td>
            <td className="c"><input type="checkbox" checked={!c.hidden} onChange={e => upd(c.key, { hidden: !e.target.checked })} aria-label={`${c.name} 표시`} /></td>
            <td className="c"><input type="checkbox" checked={c.hasGoal !== false} onChange={e => upd(c.key, { hasGoal: e.target.checked })} aria-label={`${c.name} 목표 보드`} /></td>
          </tr>))}</tbody></table></div>
      <p className="note">표시를 끄면 상세 내용·체크리스트에서 빠지고, 체크 기록은 그대로 남아 다시 켜면 돌아옵니다.</p>
    </section>
  );
}

/* ── 프로젝트 ── */
function Projects() {
  const { store, setStore } = useCtx();
  const list = store.projects || [];
  const [n, setN] = useState('');
  const [arm, setArm] = useState(null);
  const upd = (id, patch) => setStore(s => ({ ...s, projects: s.projects.map(p => (p.id === id ? { ...p, ...patch, updated: new Date().toISOString().slice(0, 10) } : p)) }));
  const add = () => { if (!n.trim()) return; setStore(s => ({ ...s, projects: [...(s.projects || []), { id: uid(), name: n.trim(), note: '', status: '진행', start: '', end: '', areas: ['P'], updated: new Date().toISOString().slice(0, 10) }] })); setN(''); };
  const del = id => {
    // 휴지통으로 옮기고, 연결된 지출·기획·일정의 연결은 풀어 둔다
    setStore(s => {
      const p = s.projects.find(x => x.id === id);
      return {
        ...s,
        projects: s.projects.filter(x => x.id !== id),
        finance: s.finance ? { ...s.finance, expenses: (s.finance.expenses || []).map(e => (e.projectId === id ? { ...e, projectId: null } : e)) } : s.finance,
        plan: s.plan ? { ...s.plan, plans: (s.plan.plans || []).map(x => (x.projectId === id ? { ...x, projectId: null } : x)) } : s.plan,
        events: (s.events || []).map(e => (e.projectId === id ? { ...e, projectId: null } : e)),
        trash: [{ id: uid(), type: 'project', label: p?.name || '', data: p, deletedAt: new Date().toISOString().slice(0, 10) }, ...(s.trash || [])],
      };
    });
    setArm(null);
  };
  const linked = id => [
    ['지출', (store.finance?.expenses || []).filter(e => e.projectId === id).length],
    ['기획', (store.plan?.plans || []).filter(x => x.projectId === id).length],
    ['일정', (store.events || []).filter(e => e.projectId === id).length],
  ].filter(([, c]) => c).map(([k, c]) => `${k} ${c}`).join(' · ') || '연결 없음';
  return (
    <section className="panel ds">
      <div className="csum-h"><h2>프로젝트</h2><span className="muted">개인 재무 연계 프로젝트 · 기획 · 일정이 함께 쓰는 목록</span></div>
      {list.length > 0 && <div className="tablewrap"><table className="fv-table ds-table">
        <thead><tr><th>이름</th><th>상태</th><th>시작</th><th>종료</th><th>영역</th><th>연결</th><th /></tr></thead>
        <tbody>{list.map(p => (
          <tr key={p.id}>
            <td><input value={p.name} onChange={e => upd(p.id, { name: e.target.value })} aria-label="프로젝트 이름" /></td>
            <td><select value={p.status || '진행'} onChange={e => upd(p.id, { status: e.target.value })} aria-label="상태">{['진행', '보류', '완료'].map(x => <option key={x}>{x}</option>)}</select></td>
            <td><input type="date" value={p.start || ''} onChange={e => upd(p.id, { start: e.target.value })} aria-label="시작" /></td>
            <td><input type="date" value={p.end || ''} onChange={e => upd(p.id, { end: e.target.value })} aria-label="종료" /></td>
            <td className="nw">{Object.entries(AREAS).map(([k, v]) => <label key={k} className="ds-chk sm"><input type="checkbox" checked={(p.areas || []).includes(k)} onChange={e => upd(p.id, { areas: Object.keys(AREAS).filter(x => (x === k ? e.target.checked : (p.areas || []).includes(x))) })} />{v.n}</label>)}</td>
            <td className="muted nw">{linked(p.id)}</td>
            <td>{arm === p.id ? <button className="btn sm danger" onClick={() => del(p.id)}>정말 삭제?</button> : <button className="btn sm" onClick={() => setArm(p.id)}>삭제</button>}</td>
          </tr>))}</tbody></table></div>}
      <div className="ds-row"><input value={n} onChange={e => setN(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="새 프로젝트 이름" aria-label="새 프로젝트 이름" /><button className="btn primary" onClick={add} disabled={!n.trim()}>추가</button></div>
    </section>
  );
}

/* ── 태그 ── */
function Tags() {
  const { store, setStore } = useCtx();
  const tags = store.tags || [];
  const used = id => (store.events || []).filter(e => (e.tagIds || []).includes(id)).length + (store.plan?.plans || []).filter(p => (p.tagIds || []).includes(id)).length;
  const upd = (id, patch) => setStore(s => ({ ...s, tags: s.tags.map(t => (t.id === id ? { ...t, ...patch } : t)) }));
  const del = id => setStore(s => ({
    ...s, tags: s.tags.filter(t => t.id !== id),
    events: (s.events || []).map(e => (e.tagIds?.includes(id) ? { ...e, tagIds: e.tagIds.filter(x => x !== id) } : e)),
    plan: s.plan ? { ...s.plan, plans: (s.plan.plans || []).map(p => (p.tagIds?.includes(id) ? { ...p, tagIds: p.tagIds.filter(x => x !== id) } : p)) } : s.plan,
  }));
  return (
    <section className="panel ds">
      <div className="csum-h"><h2>태그</h2><span className="muted">일정 · 기획에 붙이는 공통 태그 (일정·기획 화면에서 새로 만들 수 있음)</span></div>
      {tags.length ? <ul className="ds-tags">{tags.map(t => (
        <li key={t.id}><span className="cm-tag on" style={{ '--tc': t.color }}>{t.name}</span>
          <input value={t.name} onChange={e => upd(t.id, { name: e.target.value })} aria-label="태그 이름" />
          <span className="ds-colors">{TAG_COLORS.map(c => <button key={c} className={t.color === c ? 'on' : ''} style={{ background: c }} onClick={() => upd(t.id, { color: c })} aria-label={`색 ${c}`} />)}</span>
          <span className="muted">{used(t.id)}곳</span>
          <button className="btn sm" onClick={() => del(t.id)}>삭제</button></li>))}</ul>
        : <p className="muted">아직 태그가 없습니다. 캘린더 일정이나 기획서에서 "+ 새 태그"로 만드세요.</p>}
    </section>
  );
}

/* ── 휴지통 ── */
function Trash() {
  const { store, setStore } = useCtx();
  const list = store.trash || [];
  const [arm, setArm] = useState(false);
  return (
    <section className="panel ds">
      <div className="csum-h"><h2>휴지통</h2><span className="muted">{list.length}개 · 30일 지나면 자동으로 비워짐</span>
        <span className="grow" />{list.length > 0 && (arm ? <button className="btn sm danger" onClick={() => { setStore(s => ({ ...s, trash: [] })); setArm(false); }}>정말 모두 비울까요?</button>
          : <button className="btn sm" onClick={() => setArm(true)}>비우기</button>)}</div>
      {list.length ? <ul className="ds-list">{list.map(t => (
        <li key={t.id}><span className="tag">{TRASH_TYPES[t.type]?.label || t.type}</span><b>{t.label || '(이름 없음)'}</b><span className="muted">{t.deletedAt} 삭제</span>
          <span className="grow" /><button className="btn sm" onClick={() => setStore(s => restoreTrash(s, t.id))}>되살리기</button>
          <button className="btn sm" onClick={() => setStore(s => ({ ...s, trash: s.trash.filter(x => x.id !== t.id) }))}>영구 삭제</button></li>))}</ul>
        : <p className="muted">지운 일정·인맥·기념일·D-day·기획·조사 주제·프로젝트가 여기에 모입니다.</p>}
    </section>
  );
}
