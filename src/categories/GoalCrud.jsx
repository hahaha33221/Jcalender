import React, { useState } from 'react';
import { CATS, iso } from '../data.js';
import { useCtx } from '../shared.jsx';
import { EMPTY, boardForYear, boardKey, childrenOf, deadlineOf, hasGoals, seedGoals } from './goals.js';
import { DDay } from './GoalView.jsx';

/* 목표 관리 화면의 목표 편집 (CRUD): 영역의 모든 카테고리 목표를 한곳에서
   - 추가: 카테고리 · 이름 · 기간 → 그 카테고리 목표 보드에 최상위 목표
   - 수정: 이름 · 시작 · 마감(최종 데드라인, D-day 표시) · 완료 · 카테고리 옮기기(하위 작업 · 연결 마일스톤 · 연결된 내 체크 항목도 함께)
   - 삭제: 목록 왼쪽 체크로 고르고 위의 "선택 삭제" 버튼으로 한꺼번에 (하위 작업 · 연결 마일스톤까지, 확인 후)
   - 펼치면 그 목표의 To do(작업) 추가 · 이름 · 날짜 · 완료 표시, 왼쪽 체크로 골라 "선택 삭제"로 한꺼번에 삭제 */
const uid = () => Math.random().toString(36).slice(2, 10);
const catLabel = c => (c === '목표 관리' ? '영역 공통' : c);
const md = s => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '');

export default function GoalCrud({ area, year }) {
  const { store, setStore, now, openCat } = useCtx();
  const today = iso(now);
  const goals = store.goals?.v === 2 ? store.goals : seedGoals(now);
  const cats = ['목표 관리', ...new Set(CATS.filter(r => r.a === area && r.cat !== '목표 관리').map(r => r.cat))].filter(c => hasGoals(area, c));
  const [open, setOpen] = useState({});
  const [form, setForm] = useState({ cat: cats[0], name: '', start: today, end: `${year}-12-31` });
  const [newTodo, setNewTodo] = useState({});
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState({});                          // 고른 목표 (키: 카테고리|id)
  const [tsel, setTsel] = useState({});                        // 고른 To do (키: To do id)

  /** 보드들을 고치는 공통 함수 (fn: boards → boards) */
  const upd = fn => setStore(s => { const cur = s.goals?.v === 2 ? s.goals : seedGoals(now); return { ...s, goals: { ...cur, boards: fn({ ...cur.boards }) } }; });
  const B = (bs, c) => bs[boardKey(area, c)] || { ...EMPTY };
  const subtree = (items, id) => { const ids = new Set([id]); let grew = true; while (grew) { grew = false; items.forEach(i => { if (i.parent && ids.has(i.parent) && !ids.has(i.id)) { ids.add(i.id); grew = true; } }); } return ids; };
  const patchItem = (c, id, p) => upd(bs => { const b = B(bs, c); bs[boardKey(area, c)] = { ...b, items: b.items.map(i => (i.id === id ? { ...i, ...p } : i)) }; return bs; });

  const list = cats.flatMap(c => {
    const b = goals.boards[boardKey(area, c)];
    if (!b) return [];
    return boardForYear(b, year).items.filter(i => !i.parent).map(it => {
      const kids = b.items.filter(i => subtree(b.items, it.id).has(i.id) && i.id !== it.id);
      return { c, it, kids, st: deadlineOf(it, today), miles: b.miles.filter(m => m.link === it.id).length };
    });
  }).sort((a, b) => (a.st.k === 'done') - (b.st.k === 'done') || a.it.end.localeCompare(b.it.end));   // 마감 가까운 순, 완료는 뒤로

  const add = e => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const end = form.end >= form.start ? form.end : form.start;
    upd(bs => { const b = B(bs, form.cat); bs[boardKey(area, form.cat)] = { ...b, items: [...b.items, { id: uid(), parent: null, name, start: form.start, end, progress: 0 }] }; return bs; });
    setForm(f => ({ ...f, name: '' })); setMsg(`"${name}" 목표를 ${catLabel(form.cat)}에 추가했습니다`);
  };
  const keyOf = g => `${g.c}|${g.it.id}`;
  const picked = list.filter(g => sel[keyOf(g)]);
  const allOn = list.length > 0 && picked.length === list.length;
  /** 고른 목표를 한꺼번에 삭제 (하위 작업 · 연결 마일스톤까지) */
  const removeSel = () => {
    if (!picked.length) return;
    const kids = picked.reduce((n, g) => n + g.kids.length, 0), miles = picked.reduce((n, g) => n + g.miles, 0);
    if (!window.confirm(`고른 목표 ${picked.length}개를 지울까요?\n${picked.slice(0, 5).map(g => `· ${g.it.name}`).join('\n')}${picked.length > 5 ? `\n· 외 ${picked.length - 5}개` : ''}\n\n하위 작업(To do) ${kids}개와 연결된 마일스톤 ${miles}개도 함께 지워집니다. (체크리스트 항목은 그대로)`)) return;
    upd(bs => {
      picked.forEach(g => { const b = B(bs, g.c), ids = subtree(b.items, g.it.id); bs[boardKey(area, g.c)] = { items: b.items.filter(i => !ids.has(i.id)), miles: b.miles.filter(m => !ids.has(m.link)) }; });
      return bs;
    });
    setSel({}); setMsg(`목표 ${picked.length}개를 지웠습니다`);
  };
  /** 카테고리 옮기기: 목표 · 하위 작업 · 연결 마일스톤을 새 보드로, 연결된 내 체크 항목(루틴)도 그 카테고리로 */
  const move = (g, to) => {
    if (to === g.c) return;
    setStore(s => {
      const cur = s.goals?.v === 2 ? s.goals : seedGoals(now), bs = { ...cur.boards };
      const from = B(bs, g.c), ids = subtree(from.items, g.it.id), dest = B(bs, to);
      const items = from.items.filter(i => ids.has(i.id)), miles = from.miles.filter(m => ids.has(m.link));
      bs[boardKey(area, g.c)] = { items: from.items.filter(i => !ids.has(i.id)), miles: from.miles.filter(m => !ids.has(m.link)) };
      bs[boardKey(area, to)] = { items: [...dest.items, ...items], miles: [...dest.miles, ...miles] };
      const links = new Set(items.map(i => i.link).filter(Boolean)), cl = s.checklist || {};
      const custom = to === '목표 관리' ? cl.custom : (cl.custom || []).map(r => (links.has(r.id) ? { ...r, cat: to, item: to } : r));   // 진행률이 계속 잡히게
      return { ...s, goals: { ...cur, boards: bs }, checklist: { ...cl, custom } };
    });
    setMsg(`"${g.it.name}" 목표를 ${catLabel(to)}(으)로 옮겼습니다`);
  };
  const addTodo = g => {
    const name = (newTodo[g.it.id] || '').trim();
    if (!name) return;
    upd(bs => { const b = B(bs, g.c); bs[boardKey(area, g.c)] = { ...b, items: [...b.items, { id: uid(), parent: g.it.id, name, start: today >= g.it.start && today <= g.it.end ? today : g.it.start, end: g.it.end, progress: 0, todo: true, done: false }] }; return bs; });
    setNewTodo(v => ({ ...v, [g.it.id]: '' }));
  };
  /** 그 목표에서 고른 To do 를 한꺼번에 삭제 */
  const delTodos = (g, ts) => {
    if (!ts.length || !window.confirm(`"${g.it.name}" 의 To do ${ts.length}개를 지울까요?\n${ts.slice(0, 5).map(t => `· ${t.name}`).join('\n')}${ts.length > 5 ? `\n· 외 ${ts.length - 5}개` : ''}`)) return;
    upd(bs => {
      const b = B(bs, g.c), ids = new Set(ts.flatMap(t => [...subtree(b.items, t.id)])), under = subtree(b.items, g.it.id);
      const emptied = i => i.id !== g.it.id && under.has(i.id) && !ids.has(i.id) && b.items.some(k => k.parent === i.id) && b.items.every(k => k.parent !== i.id || ids.has(k.id));
      let grew = true;                                         // 하위 To do 가 모두 지워져 빈 중간 묶음도 함께 (목표 자체는 남김)
      while (grew) { grew = false; b.items.forEach(i => { if (emptied(i)) { ids.add(i.id); grew = true; } }); }
      bs[boardKey(area, g.c)] = { items: b.items.filter(i => !ids.has(i.id)), miles: b.miles.filter(m => !ids.has(m.link)) };
      return bs;
    });
    setTsel(v => { const n = { ...v }; ts.forEach(t => delete n[t.id]); return n; });
    setMsg(`"${g.it.name}" 의 To do ${ts.length}개를 지웠습니다`);
  };

  return (
    <section className="panel gc">
      <div className="csum-h"><h2>목표 편집</h2><span className="muted">{year}년 · {list.length}개 · 마감 가까운 순 · 추가 · 수정 · 카테고리 옮기기 · 삭제, 펼치면 To do 관리</span></div>
      {msg && <p className="banner ok" role="status">{msg}<button className="linkish" onClick={() => setMsg('')}>닫기</button></p>}
      <form className="gc-add" onSubmit={add}>
        <select value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })} aria-label="카테고리">{cats.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="새 목표 이름" aria-label="새 목표 이름" />
        <input type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value || today })} aria-label="시작" />
        <input type="date" value={form.end} min={form.start} onChange={e => setForm({ ...form, end: e.target.value || form.end })} aria-label="끝" />
        <button className="btn primary" disabled={!form.name.trim()}>+ 목표 추가</button>
      </form>
      {list.length > 0 && <div className="gc-bulk">
        <label className="gc-all"><input type="checkbox" checked={allOn} onChange={e => setSel(e.target.checked ? Object.fromEntries(list.map(g => [keyOf(g), true])) : {})} aria-label="전체 선택" />전체 선택</label>
        <small className="muted">{picked.length ? `${picked.length}개 고름` : '지울 목표를 왼쪽 체크로 고르세요'}</small>
        <button className="btn sm danger" disabled={!picked.length} onClick={removeSel}>선택 삭제{picked.length ? ` (${picked.length})` : ''}</button>
      </div>}
      {list.length ? <ul className="gc-list">{list.map(g => {
        const todos = g.kids.filter(k => !childrenOf(g.kids, k.id).length);
        const isOpen = !!open[g.it.id];
        const tp = todos.filter(t => tsel[t.id]), tAll = todos.length > 0 && tp.length === todos.length;
        return (
          <li key={g.it.id} className={`${/\(예시\)\s*$/.test(g.it.name) ? 'ex' : ''} ${sel[keyOf(g)] ? 'sel' : ''}`}>
            <div className="gc-row">
              <input type="checkbox" className="gc-chk" checked={!!sel[keyOf(g)]} onChange={e => setSel(v => ({ ...v, [keyOf(g)]: e.target.checked }))} aria-label={`${g.it.name} 고르기`} />
              <button className="fold" onClick={() => setOpen(v => ({ ...v, [g.it.id]: !isOpen }))} aria-label={isOpen ? '접기' : '펼치기'}>{isOpen ? '▾' : '▸'}</button>
              <select value={g.c} onChange={e => move(g, e.target.value)} aria-label="카테고리 옮기기" className="gc-cat">{cats.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select>
              <input className="gc-name" value={g.it.name} onChange={e => patchItem(g.c, g.it.id, { name: e.target.value })} aria-label="목표 이름" />
              <span className="gc-dates"><input type="date" value={g.it.start} onChange={e => e.target.value && patchItem(g.c, g.it.id, { start: e.target.value })} aria-label="시작" />~<input type="date" value={g.it.end} min={g.it.start} onChange={e => e.target.value && patchItem(g.c, g.it.id, { end: e.target.value })} aria-label="마감" title="최종 데드라인" /></span>
              <span className="gc-p"><DDay it={g.it} today={today} />
                <button type="button" className={`gc-done ${g.it.done ? 'on' : ''}`} aria-pressed={!!g.it.done} onClick={() => patchItem(g.c, g.it.id, { done: !g.it.done })}>{g.it.done ? '✓ 완료' : '완료'}</button></span>
              <small className="muted gc-n">To do {todos.length}</small>
              <span className="gc-act"><button className="linkish" onClick={() => openCat(area, g.c)}>열기</button></span>
            </div>
            {isOpen && <div className="gc-todos">
              {(g.it.info || g.it.detail) && <div className="go-info gc-info">
                {g.it.detail && <p><b>목표 정보</b> {g.it.detail}</p>}
                {g.it.info?.guide && <><b>AI 목표 안내</b><p>{g.it.info.guide}</p></>}
                {g.it.info?.tips?.length > 0 && <ul>{g.it.info.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>}</div>}
              {todos.length > 0 && <div className="gc-bulk gc-tbulk">
                <label className="gc-all"><input type="checkbox" checked={tAll} onChange={e => setTsel(v => ({ ...v, ...Object.fromEntries(todos.map(t => [t.id, e.target.checked])) }))} aria-label="To do 전체 선택" />To do 전체 선택</label>
                <small className="muted">{tp.length ? `${tp.length}개 고름` : '지울 To do 를 왼쪽 체크로 고르세요'}</small>
                <button className="btn sm danger" disabled={!tp.length} onClick={() => delTodos(g, tp)}>선택 삭제{tp.length ? ` (${tp.length})` : ''}</button>
              </div>}
              {todos.length ? todos.map(t => (
                <div key={t.id} className={`gc-todo ${t.done ? 'done' : ''} ${tsel[t.id] ? 'sel' : ''}`}>
                  <input type="checkbox" className="gc-chk" checked={!!tsel[t.id]} onChange={e => setTsel(v => ({ ...v, [t.id]: e.target.checked }))} aria-label={`${t.name} 고르기`} />
                  <span className="gc-tname"><input value={t.name} onChange={e => patchItem(g.c, t.id, { name: e.target.value })} aria-label="To do 이름" />{t.note && <small className="muted">{t.note}</small>}</span>
                  <span className="gc-dates"><input type="date" value={t.start} onChange={e => e.target.value && patchItem(g.c, t.id, { start: e.target.value })} aria-label="시작" />~<input type="date" value={t.end} min={t.start} onChange={e => e.target.value && patchItem(g.c, t.id, { end: e.target.value })} aria-label="끝" /></span>
                  <span className="gc-tr"><DDay it={t} today={today} /><button type="button" className={`gc-done ${t.done ? 'on' : ''}`} aria-pressed={!!t.done} onClick={() => patchItem(g.c, t.id, { done: !t.done })}>{t.done ? '✓ 완료' : '완료'}</button></span>
                </div>)) : <p className="muted">To do 가 없습니다.</p>}
              <form className="gc-todo gc-tadd" onSubmit={e => { e.preventDefault(); addTodo(g); }}>
                <span />
                <input value={newTodo[g.it.id] || ''} onChange={e => setNewTodo(v => ({ ...v, [g.it.id]: e.target.value }))} placeholder="새 To do (끝나는 날은 목표 끝)" aria-label="새 To do" />
                <button className="btn sm" disabled={!(newTodo[g.it.id] || '').trim()}>+ To do</button>
              </form>
              <small className="muted">기간 {md(g.it.start)}~{md(g.it.end)} · 마일스톤 {g.miles}개 · 표 전체는 "열기"에서</small>
            </div>}
          </li>);
      })}</ul> : <p className="muted">{year}년 목표가 없습니다. 위에서 추가하거나 "목표 · 루틴 온보딩"을 써 보세요.</p>}
    </section>
  );
}
