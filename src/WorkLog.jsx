import React, { useState } from 'react';
import { WORK_LOG } from './worklog.js';
import { WEEK } from './shared.jsx';

/* 진행 현황 › 작업 기록 (실행 로그 아래): 요청한 작업을 git pull 순서대로
   - 묶음별 / 날짜별 보기, 날짜 고르기, 검색, 최신 순 · 오래된 순 */
const dayLabel = d => { const t = new Date(`${d}T00:00:00`); return `${t.getFullYear()}. ${t.getMonth() + 1}. ${t.getDate()}. (${WEEK[t.getDay()]})`; };

export default function WorkLog() {
  const [q, setQ] = useState('');
  const [day, setDay] = useState('');                      // '' = 모든 날짜
  const [by, setBy] = useState('group');                   // group 묶음별 | date 날짜별
  const [closed, setClosed] = useState(() => new Set());
  const [desc, setDesc] = useState(false);                 // 최신 작업이 위로
  let n = 0;
  const groups = WORK_LOG.map(g => ({ ...g, items: g.items.map(([range, date, text]) => ({ no: ++n, range, date, text })) }));
  const total = n;
  const all = groups.flatMap(g => g.items);
  const dates = [...new Set(all.map(x => x.date))].sort().reverse();
  const count = d => all.filter(x => x.date === d).length;
  const ql = q.trim().toLowerCase();
  const keep = x => (!day || x.date === day) && (!ql || `${x.text} ${x.range}`.toLowerCase().includes(ql));
  const sections = by === 'date'
    ? dates.map(d => ({ title: d, label: dayLabel(d), items: all.filter(x => x.date === d && keep(x)) })).reverse()
    : groups.map(g => ({ title: g.title, label: g.title, items: g.items.filter(keep) }));
  const shown = sections.filter(g => g.items.length);
  const ordered = desc ? [...shown].reverse().map(g => ({ ...g, items: [...g.items].reverse() })) : shown;
  const toggle = t => setClosed(s => { const c = new Set(s); c.has(t) ? c.delete(t) : c.add(t); return c; });
  const found = ordered.reduce((a, g) => a + g.items.length, 0);
  return (
    <section className="panel wl" aria-label="작업 기록">
      <div className="csum-h"><h2>작업 기록</h2><span className="muted">요청한 작업 {total}건{found !== total ? ` 중 ${found}건` : ''} · 범위는 터미널의 "업데이트 중" 번호</span>
        <span className="grow" />
        <span className="chips" role="group" aria-label="보기">
          <button aria-pressed={by === 'group'} onClick={() => setBy('group')}>묶음별</button>
          <button aria-pressed={by === 'date'} onClick={() => setBy('date')}>날짜별</button></span>
        <select value={day} onChange={e => setDay(e.target.value)} aria-label="날짜 고르기" className="wl-day">
          <option value="">모든 날짜</option>
          {dates.map(d => <option key={d} value={d}>{dayLabel(d)} · {count(d)}건</option>)}
        </select>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="작업 검색" aria-label="작업 검색" className="wl-q" />
        <button className="btn sm" onClick={() => setDesc(v => !v)}>{desc ? '오래된 순' : '최신 순'}</button></div>
      {ordered.map(g => (
        <div key={g.title} className="wl-g">
          <button className="wl-h" onClick={() => toggle(g.title)} aria-expanded={!closed.has(g.title)}>
            <i aria-hidden="true">{closed.has(g.title) ? '▸' : '▾'}</i><b>{g.label}</b><span className="muted">{g.items.length}건</span></button>
          {!closed.has(g.title) && <ol className="wl-list">{g.items.map(x => (
            <li key={x.no}><span className="wl-no">{x.no}</span>
              <span className="wl-meta">{by === 'group' && <time className="wl-d" dateTime={x.date}>{x.date.slice(5).replace('-', '/')}</time>}<code className="wl-r">{x.range}</code></span>
              <span className="wl-t">{x.text}</span></li>))}</ol>}
        </div>))}
      {!ordered.length && <p className="muted">해당하는 작업이 없습니다.</p>}
    </section>
  );
}
