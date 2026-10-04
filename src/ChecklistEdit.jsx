import React, { useState } from 'react';
import { AREAS, BASE_ROWS, CATS, CYCLES, PRIO, ROWS, defaultPrio } from './data.js';
import { areaVar, useCtx } from './shared.jsx';

/* 체크리스트 › 편집: 계정마다 체크리스트를 직접 만든다 (store.checklist, data.js applyCategories 참고)
   - 직접 만든 항목: 추가 · 고치기 · 삭제
   - 기본 항목(앱에 들어 있는 항목): 고치기(원래대로 되돌리기 가능) · 빼기(다시 넣기 가능) · 모두 쓰지 않기
   - 새 계정은 기본 항목 없이 빈 체크리스트로 시작하고, 원하면 "기본 항목 불러오기" */
const uid = () => `u${Math.random().toString(36).slice(2, 10)}`;

export default function ChecklistEdit({ onDone }) {
  const { store, setStore } = useCtx();
  const C = store.checklist || {};
  const set = fn => setStore(s => ({ ...s, checklist: fn(s.checklist || {}) }));
  const useBase = C.base !== 'none';
  const hidden = new Set(C.hide || []);
  const edits = C.edits || {};
  const base = BASE_ROWS();
  const hiddenRows = useBase ? base.filter(r => hidden.has(r.id)) : [];

  const blank = { a: 'P', cat: '', item: '', action: '', c: 'D', detail: '', prio: 2 };
  const [form, setForm] = useState(blank);
  const [area, setArea] = useState('ALL');
  const [arm, setArm] = useState(null);
  const catsOf = a => [...new Set([...CATS.filter(c => c.a === a).map(c => c.cat), ...(C.custom || []).filter(r => r.a === a).map(r => r.cat)])];

  const add = e => {
    e.preventDefault();
    if (!form.action.trim()) return;
    const id = uid(), cat = form.cat.trim() || '기타';
    set(c => ({ ...c, custom: [...(c.custom || []), { id, a: form.a, c: form.c, cat, item: form.item.trim() || cat, action: form.action.trim(), detail: form.detail.trim() }] }));
    if (Number(form.prio) !== 2) setStore(s => ({ ...s, prio: { ...(s.prio || {}), [id]: Number(form.prio) } }));
    setForm({ ...blank, a: form.a, cat: form.cat, item: form.item, c: form.c });
  };
  const patch = (row, p) => set(c => (row.custom
    ? { ...c, custom: (c.custom || []).map(r => (r.id === row.id ? { ...r, ...p } : r)) }
    : { ...c, edits: { ...(c.edits || {}), [row.id]: { ...((c.edits || {})[row.id] || {}), ...p } } }));
  const revert = row => set(c => { const ed = { ...(c.edits || {}) }; delete ed[row.id]; return { ...c, edits: ed }; });
  const remove = row => {
    if (arm !== row.id) { setArm(row.id); setTimeout(() => setArm(a => (a === row.id ? null : a)), 3000); return; }
    setArm(null);
    set(c => (row.custom ? { ...c, custom: (c.custom || []).filter(r => r.id !== row.id) } : { ...c, hide: [...new Set([...(c.hide || []), row.id])] }));
  };
  const unhide = id => set(c => ({ ...c, hide: (c.hide || []).filter(x => x !== id) }));
  const setBase = on => set(c => { const n = { ...c }; if (on) delete n.base; else n.base = 'none'; return n; });

  // 지금 체크리스트(ROWS)를 영역 · 카테고리별로
  const rows = ROWS.filter(r => area === 'ALL' || r.a === area);
  const groups = [];
  rows.forEach(r => { const k = `${r.a}|${r.cat}`; let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, a: r.a, cat: r.cat, rows: [] }); g.rows.push(r); });
  const nCustom = (C.custom || []).length, nBase = useBase ? base.length - hiddenRows.length : 0;

  return (
    <section className="cle" aria-label="체크리스트 편집">
      <div className="panel cle-top">
        <div className="cle-sum">
          <div><b>내 체크리스트</b> <span className="muted">· 직접 만든 항목 {nCustom}개 · 기본 항목 {nBase}개 · 이 계정에만 저장됩니다</span></div>
          <button className="btn primary sm" onClick={onDone}>편집 끝내기</button>
        </div>
        <label className="cle-base"><input type="checkbox" checked={useBase} onChange={e => setBase(e.target.checked)} />
          <span><b>기본 항목 쓰기</b> <span className="muted">— 앱에 들어 있는 {base.length}개 항목(루틴 · 재무 · 사업 운영 등). 끄면 직접 만든 항목만 보입니다</span></span></label>
        {!useBase && !nCustom && <p className="note">체크리스트가 비어 있습니다. 아래에서 할 일을 추가하거나, "기본 항목 쓰기"를 켜서 기본 항목을 불러온 뒤 필요 없는 것을 빼세요.</p>}
      </div>

      <form className="panel cle-form" onSubmit={add}>
        <h2>항목 추가</h2>
        <div className="cle-grid">
          <label>영역<select value={form.a} onChange={e => setForm({ ...form, a: e.target.value, cat: '' })}>{Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v.n}</option>)}</select></label>
          <label>카테고리<input list="cle-cats" value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })} placeholder="고르거나 새 이름 (예: 운동)" />
            <datalist id="cle-cats">{catsOf(form.a).map(c => <option key={c} value={c} />)}</datalist></label>
          <label>묶음 (선택)<input value={form.item} onChange={e => setForm({ ...form, item: e.target.value })} placeholder="예: 아침 루틴" /></label>
          <label>주기<select value={form.c} onChange={e => setForm({ ...form, c: e.target.value })}>{Object.entries(CYCLES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
          <label>우선순위<select value={form.prio} onChange={e => setForm({ ...form, prio: e.target.value })}>{[1, 2, 3].map(p => <option key={p} value={p}>{PRIO[p]}</option>)}</select></label>
          <label className="wide">할 일<input value={form.action} onChange={e => setForm({ ...form, action: e.target.value })} placeholder="예: 물 2L 마시기" required /></label>
          <label className="wide">설명 (선택)<input value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} placeholder="체크할 때 참고할 내용" /></label>
        </div>
        <button className="btn primary" disabled={!form.action.trim()}>추가</button>
      </form>

      <div className="panel">
        <div className="csum-h"><h2>항목 고치기</h2><span className="muted">{rows.length}개 · 칸을 바로 고치면 저장됩니다</span>
          <div className="chips grow-r" role="group" aria-label="영역">{[['ALL', '전체'], ...Object.entries(AREAS).map(([k, v]) => [k, v.n])].map(([k, n]) => <button key={k} aria-pressed={area === k} onClick={() => setArea(k)}>{n}</button>)}</div></div>
        {!groups.length && <p className="muted">항목이 없습니다.</p>}
        {groups.map(g => (
          <div key={g.k} className="cle-group" style={{ '--ac': areaVar(g.a) }}>
            <h3><i className="dot" />{AREAS[g.a].n} · {g.cat} <span className="muted">{g.rows.length}</span></h3>
            {g.rows.map(r => (
              <div key={r.id} className={`cle-row ${r.custom ? 'mine' : ''}`}>
                <input className="cle-act" value={r.action} onChange={e => patch(r, { action: e.target.value })} aria-label="할 일" />
                <input className="cle-item" value={r.item} onChange={e => patch(r, { item: e.target.value })} aria-label="묶음" title="묶음" />
                <select className="cle-cyc" value={r.c} onChange={e => patch(r, { c: e.target.value })} aria-label="주기">{Object.entries(CYCLES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                <input className="cle-det" value={r.detail} onChange={e => patch(r, { detail: e.target.value })} aria-label="설명" placeholder="설명" />
                <span className="cle-tag">{r.custom ? <span className="tag mine">내 항목</span> : edits[r.id] ? <button type="button" className="linkish" onClick={() => revert(r)} title="기본 내용으로 되돌리기">원래대로</button> : <span className="tag">기본</span>}</span>
                <button type="button" className={`tl-del cle-del ${arm === r.id ? 'arm' : ''}`} onClick={() => remove(r)}>{arm === r.id ? (r.custom ? '정말 삭제?' : '정말 빼기?') : r.custom ? '삭제' : '빼기'}</button>
              </div>))}
          </div>))}
      </div>

      {hiddenRows.length > 0 && (
        <div className="panel">
          <div className="csum-h"><h2>뺀 기본 항목</h2><span className="muted">{hiddenRows.length}개</span>
            <button className="btn sm grow-r" onClick={() => set(c => ({ ...c, hide: [] }))}>모두 다시 넣기</button></div>
          <ul className="cle-hidden">{hiddenRows.map(r => (
            <li key={r.id}><span className="grow">{AREAS[r.a].n} · {r.cat} › <b>{r.action}</b> <small className="muted">{CYCLES[r.c]} · 우선순위 {PRIO[defaultPrio(r)]}</small></span>
              <button className="btn sm" onClick={() => unhide(r.id)}>다시 넣기</button></li>))}</ul>
        </div>)}
    </section>
  );
}
