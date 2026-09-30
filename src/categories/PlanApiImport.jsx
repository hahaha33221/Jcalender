import React, { useState } from 'react';
import { MAP_FIELDS, fetchRows, guessMap, planFeed } from '../planApi.js';

/* 기획 보드 › API로 가져오기 (팝업 없이 보드 위에 펼쳐지는 칸)
   1) 연결 고르기 또는 새 연결(이름 · 주소 · 인증 헤더) → 2) 불러오기 → 3) 필드 연결 확인 · 미리보기 → 4) 가져오기
   저장된 연결은 "다시 가져오기" 한 번으로 새 항목 추가 + 같은 항목 갱신 */
const uid = () => Math.random().toString(36).slice(2, 10);
const blankFeed = () => ({ id: uid(), name: '', url: '', header: 'Authorization', token: '', map: {} });

export default function PlanApiImport({ P, set, today, onClose }) {
  const feeds = P.feeds || [];
  const [cur, setCur] = useState(() => (feeds[0] ? { ...feeds[0] } : blankFeed()));
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showToken, setShowToken] = useState(false);
  const saved = feeds.some(f => f.id === cur.id);
  const fields = rows ? [...new Set(rows.slice(0, 50).flatMap(r => Object.keys(r)))] : [];
  const plan = rows && cur.map.title ? planFeed(rows, cur, P.plans) : null;

  const saveFeed = (f, extra = {}) => set(x => {
    const list = x.feeds || [];
    const next = { ...f, ...extra };
    return { ...x, feeds: list.some(y => y.id === f.id) ? list.map(y => (y.id === f.id ? next : y)) : [...list, next] };
  });
  const load = async (f = cur) => {
    if (!f.url.trim()) return;
    setBusy(true); setMsg(null); setRows(null);
    try {
      const r = await fetchRows(f);
      setRows(r);
      const keys = [...new Set(r.slice(0, 50).flatMap(x => Object.keys(x)))];
      if (!f.map?.title || !keys.includes(f.map.title)) setCur(c => ({ ...c, map: guessMap(keys) }));
      setMsg({ t: `${r.length}개 항목을 읽었습니다. 아래에서 필드 연결을 확인하고 가져오기를 누르세요.` });
    } catch (e) { setMsg({ err: true, t: e.message }); } finally { setBusy(false); }
  };
  /** 가져오기: 새 항목은 추가, 같은 항목(ext key)은 비어 있지 않은 값만 갱신 */
  const run = (f = cur, list = rows, p = plan) => {
    if (!p) return;
    const name = f.name.trim() || new URL(f.url, location.href).hostname;
    set(x => {
      const upd = new Map(p.update.map(u => [u.id, u.data]));
      const plans = x.plans.map(pl => {
        const d = upd.get(pl.id);
        if (!d) return pl;
        const sec = { ...(pl.sec || {}) };
        Object.entries(d.sec).forEach(([k, v]) => { if (v) sec[k] = v; });
        return { ...pl, title: d.title, due: d.due || pl.due, ...(f.map.status ? { status: d.status } : {}), sec, updated: today };
      });
      const added = p.add.map(a => ({ id: uid(), ...a.data, topicIds: [], created: today, updated: today, ext: { feed: f.id, key: a.key } }));
      const list2 = x.feeds || [];
      const nf = { ...f, name, lastSync: today, count: list.length };
      return { ...x, plans: [...plans, ...added], feeds: list2.some(y => y.id === f.id) ? list2.map(y => (y.id === f.id ? nf : y)) : [...list2, nf] };
    });
    setCur(c => ({ ...c, name, lastSync: today, count: list.length }));
    setMsg({ t: `가져오기 완료: 새로 ${p.add.length}건, 갱신 ${p.update.length}건${p.skipped ? `, 제목 없음 ${p.skipped}건 건너뜀` : ''}. 기획 보드에서 확인하세요.` });
    setRows(null);
  };
  /** 저장된 연결 바로 다시 가져오기 */
  const resync = async f => {
    setBusy(true); setMsg(null);
    try { const r = await fetchRows(f); setCur({ ...f }); run(f, r, planFeed(r, f, P.plans)); }
    catch (e) { setMsg({ err: true, t: `${f.name}: ${e.message}` }); } finally { setBusy(false); }
  };
  const [arm, setArm] = useState(null);
  const delFeed = id => { set(x => ({ ...x, feeds: (x.feeds || []).filter(f => f.id !== id) })); setArm(null); if (cur.id === id) { setCur(blankFeed()); setRows(null); } };

  return (
    <section className="panel pa" aria-label="API로 가져오기">
      <div className="csum-h"><h2>API로 가져오기</h2><span className="muted">JSON 또는 CSV 주소에서 기획을 불러옵니다</span>
        <span className="grow" /><button className="btn sm" onClick={onClose}>닫기</button></div>

      {feeds.length > 0 && <ul className="pa-feeds">{feeds.map(f => (
        <li key={f.id} className={f.id === cur.id ? 'on' : ''}>
          <button className="linkish" onClick={() => { setCur({ ...f }); setRows(null); setMsg(null); }}><b>{f.name}</b></button>
          <span className="muted">{f.lastSync ? `마지막 ${f.lastSync} · ${f.count}개` : '가져오기 전'}</span>
          <span className="grow" />
          <button className="btn sm primary" disabled={busy} onClick={() => resync(f)}>다시 가져오기</button>
          {arm === f.id ? <button className="btn sm danger" onClick={() => delFeed(f.id)}>정말 삭제?</button> : <button className="btn sm" onClick={() => setArm(f.id)}>삭제</button>}
        </li>))}
        <li><button className="linkish" onClick={() => { setCur(blankFeed()); setRows(null); setMsg(null); }}>+ 새 연결</button></li></ul>}

      <div className="pa-form">
        <label>이름<input value={cur.name} onChange={e => setCur({ ...cur, name: e.target.value })} placeholder="예: 팀 기획 시트, 노션 기획 DB" /></label>
        <label className="pa-url">주소 (URL)<input value={cur.url} onChange={e => setCur({ ...cur, url: e.target.value.trim() })} placeholder="https://... (JSON 또는 CSV)" onKeyDown={e => e.key === 'Enter' && load()} /></label>
        <label>인증 헤더 (선택)<input value={cur.header} onChange={e => setCur({ ...cur, header: e.target.value })} placeholder="Authorization" /></label>
        <label>인증 값 (선택)<span className="pa-tok"><input type={showToken ? 'text' : 'password'} value={cur.token} onChange={e => setCur({ ...cur, token: e.target.value })} placeholder="예: Bearer abc123" autoComplete="off" />
          <button type="button" className="btn sm" onClick={() => setShowToken(v => !v)}>{showToken ? '숨기기' : '보기'}</button></span></label>
        <div className="pa-btns">
          <button className="btn primary" onClick={() => load()} disabled={!cur.url || busy}>{busy ? '불러오는 중…' : '불러오기'}</button>
          {saved && <button className="btn" onClick={() => { saveFeed(cur); setMsg({ t: '연결 설정을 저장했습니다.' }); }}>설정 저장</button>}
        </div>
      </div>
      {msg && <p className={`sh-msg ${msg.err ? 'err' : ''}`} role="status">{msg.t}</p>}

      {rows && <>
        <h3 className="pr-h3">필드 연결 <span className="muted">불러온 항목의 어느 값을 기획서 어디에 넣을지</span></h3>
        <div className="pa-map">{MAP_FIELDS.map(([k, label]) => (
          <label key={k}>{label}<select value={cur.map[k] || ''} onChange={e => setCur({ ...cur, map: { ...cur.map, [k]: e.target.value } })}>
            <option value="">(사용 안 함)</option>{fields.map(f => <option key={f} value={f}>{f}</option>)}</select></label>))}</div>
        {plan && <>
          <p className="pa-sum">새로 추가 <b>{plan.add.length}</b>건 · 갱신 <b>{plan.update.length}</b>건{plan.skipped ? ` · 제목 없음 ${plan.skipped}건 건너뜀` : ''}</p>
          <div className="od-tablewrap"><table className="fv-table pa-prev">
            <thead><tr><th>No.</th><th>제목</th><th>상태</th><th>마감</th><th>개요</th><th>구분</th></tr></thead>
            <tbody>{[...plan.update.map(u => ({ ...u.data, kind: '갱신' })), ...plan.add.map(a => ({ ...a.data, kind: '새로' }))].slice(0, 15).map((d, i) => (
              <tr key={i}><td className="c">{i + 1}</td><td><b>{d.title}</b></td><td className="c">{d.status}</td><td className="c">{d.due || '-'}</td>
                <td className="pa-cut">{d.sec.s1 || '-'}</td><td className="c">{d.kind}</td></tr>))}</tbody></table></div>
          <div className="pa-btns"><span className="grow" /><button className="btn primary" onClick={() => run()} disabled={!plan.add.length && !plan.update.length}>가져오기 ({plan.add.length + plan.update.length}건)</button></div>
        </>}
        {!cur.map.title && <p className="muted">제목으로 쓸 필드를 골라 주세요.</p>}
      </>}

      <p className="note">브라우저에서 바로 읽으므로 주소가 CORS를 허용해야 합니다. 구글 시트는 파일 › 공유 › 웹에 게시 › CSV 주소를 쓰면 되고, 노션·지라처럼 막혀 있는 서비스는 중간 서버(프록시) 주소가 필요합니다. 상태 값은 아이디어·초안·검토·확정·보류로 자동으로 바꾸고(예: done → 확정, in progress → 초안), 다시 가져오기 때는 같은 고유 ID의 카드를 갱신합니다. 인증 값은 이 브라우저에만 저장됩니다.</p>
    </section>
  );
}
