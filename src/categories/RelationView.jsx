import React, { useState } from 'react';
import { AREAS, ROWS, iso } from '../data.js';
import { ActionRow, areaVar, useCtx } from '../shared.jsx';

/* 개인 › 인맥/관계 관리 전용 화면
   people: [{ id, name, group, phone, cycle(연락 주기, 일), last(마지막 연락일), memo, notes: [{ id, date, text }] }] */
export const GROUPS = ['가족', '친구', '동료', '지인'];
const CYCLES = [[7, '매주'], [14, '2주'], [30, '매달'], [60, '2달'], [90, '분기'], [180, '반년']];
const uid = () => Math.random().toString(36).slice(2, 10);
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const ACT_CARD = ROWS.find(r => r.a === 'P' && r.action === '명함 등록');
const ACT_NOTE = ROWS.find(r => r.a === 'P' && r.action.startsWith('만남 메모 기록'));

export function seedPeople(today = new Date()) {
  const d = n => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
  return [
    { id: 'p1', name: '어머니 (예시)', group: '가족', phone: '010-0000-0001', cycle: 7, last: d(9), memo: '주말 통화', notes: [{ id: 'n1', date: d(9), text: '생신 선물로 스카프 이야기하심' }] },
    { id: 'p2', name: '김민수 (예시)', group: '친구', phone: '010-0000-0002', cycle: 30, last: d(12), memo: '대학 동기', notes: [] },
    { id: 'p3', name: '이지은 (예시)', group: '친구', phone: '010-0000-0003', cycle: 30, last: d(45), memo: '독서 모임', notes: [{ id: 'n2', date: d(45), text: '이직 준비 중, 다음 달 모임 약속' }] },
    { id: 'p4', name: '박팀장 (예시)', group: '동료', phone: '010-0000-0004', cycle: 60, last: d(20), memo: '전 직장 상사', notes: [] },
    { id: 'p5', name: '최선배 (예시)', group: '지인', phone: '010-0000-0005', cycle: 90, last: d(110), memo: '업계 선배', notes: [] },
    { id: 'p6', name: '할머니 (예시)', group: '가족', phone: '010-0000-0006', cycle: 14, last: d(3), memo: '', notes: [] },
  ];
}

export default function RelationView({ area, cat, group }) {
  const { store, setStore, now, isDone, finish } = useCtx();
  const today = iso(now);
  const people = store.people || seedPeople(now);
  const setPeople = fn => setStore(s => ({ ...s, people: fn(s.people || seedPeople(now)) }));
  const [grp, setGrp] = useState('ALL');
  const [open, setOpen] = useState(null);          // 메모를 펼친 사람 id
  const [form, setForm] = useState({ name: '', group: '친구', phone: '', cycle: 30 });
  const [note, setNote] = useState('');
  const done = row => row && !isDone(row);

  const withDue = people.map(p => { const since = dayDiff(p.last, today); return { ...p, since, over: since - p.cycle }; });
  const due = withDue.filter(p => p.over >= 0).sort((a, b) => b.over - a.over);
  const shown = withDue.filter(p => grp === 'ALL' || p.group === grp).sort((a, b) => b.over - a.over);
  const monthCnt = people.filter(p => p.last.slice(0, 7) === today.slice(0, 7)).length;

  const contacted = id => setPeople(ps => ps.map(p => (p.id === id ? { ...p, last: today } : p)));
  const add = e => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setPeople(ps => [...ps, { id: uid(), name: form.name.trim(), group: form.group, phone: form.phone.trim(), cycle: Number(form.cycle), last: today, memo: '', notes: [] }]);
    if (done(ACT_CARD)) finish(ACT_CARD, { t: '없음', memo: form.name.trim() });
    setForm({ ...form, name: '', phone: '' });
  };
  const addNote = p => {
    if (!note.trim()) return;
    setPeople(ps => ps.map(x => (x.id === p.id ? { ...x, last: today, notes: [{ id: uid(), date: today, text: note.trim() }, ...x.notes] } : x)));
    if (done(ACT_NOTE)) finish(ACT_NOTE, { t: '없음', memo: `${p.name}: ${note.trim()}` });
    setNote('');
  };
  const upd = (id, patch) => setPeople(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const del = id => setPeople(ps => ps.filter(p => p.id !== id));
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv rv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 사람마다 연락 주기를 정하고, 연락할 때가 된 사람을 먼저 보여줍니다. 만남 메모도 사람별로 남깁니다.</p>
      </header>

      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">등록한 사람</span><b>{people.length}명</b><span className="hv-sub">{GROUPS.map(g => `${g} ${people.filter(p => p.group === g).length}`).join(' · ')}</span></div>
        <div className={`hv-stat ${due.length ? 'over' : 'sl'}`}><span className="muted">연락할 때가 된 사람</span><b>{due.length}명</b><span className="hv-sub">{due.slice(0, 2).map(p => p.name).join(', ') || '없음'}</span></div>
        <div className="hv-stat ex"><span className="muted">이번 달 연락</span><b>{monthCnt}명</b><span className="hv-sub">마지막 연락일 기준</span></div>
      </div>

      {due.length > 0 && (
        <section className="panel rv-due">
          <div className="csum-h"><h2>연락할 때가 된 사람</h2><span className="muted">연락 주기를 넘긴 순서</span></div>
          <ul className="rv-due-list">{due.map(p => (
            <li key={p.id}>
              <span className="rv-av" aria-hidden="true">{p.name.slice(0, 1)}</span>
              <span className="rv-dn"><b>{p.name}</b><small>{p.group} · {p.since}일 전 연락 · 주기 {p.cycle}일{p.over > 0 ? ` (${p.over}일 지남)` : ''}</small></span>
              {p.phone && <a className="btn sm" href={`tel:${p.phone}`}>전화</a>}
              <button className="btn sm primary" onClick={() => contacted(p.id)}>오늘 연락함</button>
            </li>))}</ul>
        </section>
      )}

      <section className="panel">
        <div className="csum-h"><h2>사람 목록</h2>
          <div className="chips" role="group" aria-label="관계">
            {[['ALL', '전체'], ...GROUPS.map(g => [g, g])].map(([k, n]) => <button key={k} aria-pressed={grp === k} onClick={() => setGrp(k)}>{n}</button>)}
          </div></div>
        <div className="rv-grid">{shown.map(p => {
          const pctOf = Math.min(100, Math.round(p.since / p.cycle * 100));
          return (
            <article key={p.id} className={`rv-card ${p.over >= 0 ? 'due' : ''}`}>
              <div className="rv-top">
                <span className="rv-av" aria-hidden="true">{p.name.slice(0, 1)}</span>
                <span className="rv-dn"><b>{p.name}</b><small>{p.group}{p.memo ? ` · ${p.memo}` : ''}</small></span>
                <button className="tl-del" onClick={() => del(p.id)} aria-label={`${p.name} 삭제`}>삭제</button>
              </div>
              <div className="rv-meter" title={`연락 주기 ${p.cycle}일 중 ${p.since}일 지남`}><i style={{ width: `${pctOf}%` }} /></div>
              <div className="rv-meta">
                <span>{p.since === 0 ? '오늘 연락' : `${p.since}일 전 연락`}</span>
                <select value={p.cycle} onChange={e => upd(p.id, { cycle: Number(e.target.value) })} aria-label={`${p.name} 연락 주기`}>
                  {CYCLES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
              </div>
              <div className="rv-btns">
                <button className="btn sm" onClick={() => contacted(p.id)}>오늘 연락함</button>
                <button className="btn sm" onClick={() => { setOpen(open === p.id ? null : p.id); setNote(''); }}>메모 {p.notes.length}</button>
              </div>
              {open === p.id && (
                <div className="rv-notes">
                  <div className="row2">
                    <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNote(p)} placeholder="만남·통화 메모" aria-label={`${p.name} 메모`} />
                    <button className="btn sm primary" onClick={() => addNote(p)} disabled={!note.trim()}>기록</button>
                  </div>
                  <ul>{p.notes.map(n => <li key={n.id}><time>{n.date.slice(5).replace('-', '/')}</time>{n.text}</li>)}</ul>
                  {!p.notes.length && <p className="muted">메모가 없습니다.</p>}
                </div>
              )}
            </article>
          );
        })}</div>
        <form className="anniv-add" onSubmit={add}>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="이름" aria-label="새 사람 이름" />
          <select value={form.group} onChange={e => setForm({ ...form, group: e.target.value })} aria-label="관계">{GROUPS.map(g => <option key={g}>{g}</option>)}</select>
          <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="전화번호 (선택)" aria-label="전화번호" />
          <select value={form.cycle} onChange={e => setForm({ ...form, cycle: e.target.value })} aria-label="연락 주기">{CYCLES.map(([v, n]) => <option key={v} value={v}>연락 {n}</option>)}</select>
          <button className="btn primary" disabled={!form.name.trim()}>추가</button>
        </form>
        <p className="note">사람을 추가하면 "명함 등록", 메모를 남기면 "만남 메모 기록"이 오늘 체크됩니다. 메모를 남기면 마지막 연락일도 오늘로 바뀝니다.</p>
      </section>

      <h2 className="hv-sec">인맥/관계 관리 체크 항목</h2>
      <div className="catv-items">
        {items.map(({ it, rows }) => (
          <section key={it} className="catv-item">
            <div className="catv-item-h"><h3>{it}</h3><span className="muted">{rows.filter(isDone).length}/{rows.length}</span></div>
            {rows.map(r => <ActionRow key={r.id} row={r} showCycle />)}
          </section>
        ))}
      </div>
    </div>
  );
}
