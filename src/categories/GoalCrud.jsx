import React, { useState } from 'react';
import { CATS, iso } from '../data.js';
import { useCtx } from '../shared.jsx';
import { EMPTY, boardForYear, boardKey, childrenOf, hasGoals, progressOf, seedGoals } from './goals.js';
import { leafFor } from './GoalView.jsx';

/* 목표 관리 화면의 목표 편집 (CRUD): 영역의 모든 카테고리 목표를 한곳에서
   - 추가: 카테고리 · 이름 · 기간 → 그 카테고리 목표 보드에 최상위 목표
   - 수정: 이름 · 시작 · 끝 · 카테고리 옮기기(하위 작업 · 연결 마일스톤 · 연결된 내 체크 항목도 함께)
   - 삭제: 하위 작업과 연결 마일스톤까지 (확인 후)
   - 펼치면 그 목표의 To do(작업) 추가 · 이름 · 날짜 · 완료 체크 · 삭제 */
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

  /** 보드들을 고치는 공통 함수 (fn: boards → boards) */
  const upd = fn => setStore(s => { const cur = s.goals?.v === 2 ? s.goals : seedGoals(now); return { ...s, goals: { ...cur, boards: fn({ ...cur.boards }) } }; });
  const B = (bs, c) => bs[boardKey(area, c)] || { ...EMPTY };
  const subtree = (items, id) => { const ids = new Set([id]); let grew = true; while (grew) { grew = false; items.forEach(i => { if (i.parent && ids.has(i.parent) && !ids.has(i.id)) { ids.add(i.id); grew = true; } }); } return ids; };
  const patchItem = (c, id, p) => upd(bs => { const b = B(bs, c); bs[boardKey(area, c)] = { ...b, items: b.items.map(i => (i.id === id ? { ...i, ...p } : i)) }; return bs; });

  const list = cats.flatMap(c => {
    const b = goals.boards[boardKey(area, c)];
    if (!b) return [];
    const leaf = leafFor(area, c, store.done);
    return boardForYear(b, year).items.filter(i => !i.parent).map(it => {
      const kids = b.items.filter(i => subtree(b.items, it.id).has(i.id) && i.id !== it.id);
      return { c, it, kids, p: progressOf(b.items, it.id, leaf), miles: b.miles.filter(m => m.link === it.id).length };
    });
  });

  const add = e => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const end = form.end >= form.start ? form.end : form.start;
    upd(bs => { const b = B(bs, form.cat); bs[boardKey(area, form.cat)] = { ...b, items: [...b.items, { id: uid(), parent: null, name, start: form.start, end, progress: 0 }] }; return bs; });
    setForm(f => ({ ...f, name: '' })); setMsg(`"${name}" 목표를 ${catLabel(form.cat)}에 추가했습니다`);
  };
  const remove = g => {
    if (!window.confirm(`"${g.it.name}" 목표를 지울까요?\n하위 작업(To do) ${g.kids.length}개와 연결된 마일스톤 ${g.miles}개도 함께 지워집니다. (체크리스트 항목은 그대로)`)) return;
    upd(bs => { const b = B(bs, g.c), ids = subtree(b.items, g.it.id); bs[boardKey(area, g.c)] = { items: b.items.filter(i => !ids.has(i.id)), miles: b.miles.filter(m => !ids.has(m.link)) }; return bs; });
    setMsg(`"${g.it.name}" 목표를 지웠습니다`);
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
  const delTodo = (g, t) => upd(bs => { const b = B(bs, g.c), ids = subtree(b.items, t.id); bs[boardKey(area, g.c)] = { items: b.items.filter(i => !ids.has(i.id)), miles: b.miles.filter(m => !ids.has(m.link)) }; return bs; });

  return (
    <section className="panel gc">
      <div className="csum-h"><h2>목표 편집</h2><span className="muted">{year}년 · {list.length}개 · 추가 · 수정 · 카테고리 옮기기 · 삭제, 펼치면 To do 관리</span></div>
      {msg && <p className="banner ok" role="status">{msg}<button className="linkish" onClick={() => setMsg('')}>닫기</button></p>}
      <form className="gc-add" onSubmit={add}>
        <select value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })} aria-label="카테고리">{cats.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="새 목표 이름" aria-label="새 목표 이름" />
        <input type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value || today })} aria-label="시작" />
        <input type="date" value={form.end} min={form.start} onChange={e => setForm({ ...form, end: e.target.value || form.end })} aria-label="끝" />
        <button className="btn primary" disabled={!form.name.trim()}>+ 목표 추가</button>
      </form>
      {list.length ? <ul className="gc-list">{list.map(g => {
        const todos = g.kids.filter(k => !childrenOf(g.kids, k.id).length);
        const isOpen = !!open[g.it.id];
        return (
          <li key={g.it.id} className={/\(예시\)\s*$/.test(g.it.name) ? 'ex' : ''}>
            <div className="gc-row">
              <button className="fold" onClick={() => setOpen(v => ({ ...v, [g.it.id]: !isOpen }))} aria-label={isOpen ? '접기' : '펼치기'}>{isOpen ? '▾' : '▸'}</button>
              <select value={g.c} onChange={e => move(g, e.target.value)} aria-label="카테고리 옮기기" className="gc-cat">{cats.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select>
              <input className="gc-name" value={g.it.name} onChange={e => patchItem(g.c, g.it.id, { name: e.target.value })} aria-label="목표 이름" />
              <span className="gc-dates"><input type="date" value={g.it.start} onChange={e => e.target.value && patchItem(g.c, g.it.id, { start: e.target.value })} aria-label="시작" />~<input type="date" value={g.it.end} min={g.it.start} onChange={e => e.target.value && patchItem(g.c, g.it.id, { end: e.target.value })} aria-label="끝" /></span>
              <span className="gc-p"><span className="gv-mini"><i style={{ width: `${g.p}%` }} /></span><b>{g.p}%</b></span>
              <small className="muted gc-n">To do {todos.length}</small>
              <span className="gc-act"><button className="linkish" onClick={() => openCat(area, g.c)}>열기</button><button className="tl-del" onClick={() => remove(g)}>삭제</button></span>
            </div>
            {isOpen && <div className="gc-todos">
              {todos.length ? todos.map(t => (
                <div key={t.id} className={`gc-todo ${t.done ? 'done' : ''}`}>
                  {t.todo ? <input type="checkbox" checked={!!t.done} onChange={e => patchItem(g.c, t.id, { done: e.target.checked })} aria-label="완료" /> : <small className="muted" title="체크리스트로 진행률 계산">자동</small>}
                  <input value={t.name} onChange={e => patchItem(g.c, t.id, { name: e.target.value })} aria-label="To do 이름" />
                  <span className="gc-dates"><input type="date" value={t.start} onChange={e => e.target.value && patchItem(g.c, t.id, { start: e.target.value })} aria-label="시작" />~<input type="date" value={t.end} min={t.start} onChange={e => e.target.value && patchItem(g.c, t.id, { end: e.target.value })} aria-label="끝" /></span>
                  <button className="tl-del" onClick={() => delTodo(g, t)} aria-label="삭제">×</button>
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
