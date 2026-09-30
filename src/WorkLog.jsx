import React, { useState } from 'react';
import { WORK_LOG } from './worklog.js';

/* 진행 현황 › 작업 기록 (실행 로그 아래): 요청한 작업을 git pull 순서대로. 묶음별 접기 · 검색 */
export default function WorkLog() {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState(() => new Set());
  const [desc, setDesc] = useState(false);                 // 최신 작업이 위로
  let n = 0;
  const groups = WORK_LOG.map(g => ({ ...g, items: g.items.map(([range, text]) => ({ no: ++n, range, text })) }));
  const total = n;
  const ql = q.trim().toLowerCase();
  const shown = groups.map(g => ({ ...g, items: g.items.filter(x => !ql || `${x.text} ${x.range}`.toLowerCase().includes(ql)) })).filter(g => g.items.length);
  const ordered = desc ? [...shown].reverse().map(g => ({ ...g, items: [...g.items].reverse() })) : shown;
  const toggle = t => setClosed(s => { const c = new Set(s); c.has(t) ? c.delete(t) : c.add(t); return c; });
  return (
    <section className="panel wl" aria-label="작업 기록">
      <div className="csum-h"><h2>작업 기록</h2><span className="muted">요청한 작업 {total}건 · git pull 순서 · 범위는 터미널의 "업데이트 중" 번호</span>
        <span className="grow" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="작업 검색" aria-label="작업 검색" className="wl-q" />
        <button className="btn sm" onClick={() => setDesc(v => !v)}>{desc ? '오래된 순' : '최신 순'}</button></div>
      {ordered.map(g => (
        <div key={g.title} className="wl-g">
          <button className="wl-h" onClick={() => toggle(g.title)} aria-expanded={!closed.has(g.title)}>
            <i aria-hidden="true">{closed.has(g.title) ? '▸' : '▾'}</i><b>{g.title}</b><span className="muted">{g.items.length}건</span></button>
          {!closed.has(g.title) && <ol className="wl-list">{g.items.map(x => (
            <li key={x.no}><span className="wl-no">{x.no}</span><code className="wl-r">{x.range}</code><span className="wl-t">{x.text}</span></li>))}</ol>}
        </div>))}
      {!ordered.length && <p className="muted">해당하는 작업이 없습니다.</p>}
    </section>
  );
}
