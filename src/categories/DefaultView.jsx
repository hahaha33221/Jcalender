import React, { useState } from 'react';
import { AREAS, CYCLES, isDue, periodKey } from '../data.js';
import { ActionRow, areaVar, useCtx } from '../shared.jsx';

/* 카테고리 기본 상세 화면: 요약 → 주기별 현황 → 세부 항목별 액션.
   전용 화면을 만들 때 이 파일을 복사해서 시작하면 된다. */
export default function DefaultView({ area, cat, group }) {
  const { now, isDone, go } = useCtx();
  const cycles = Object.keys(CYCLES).filter(c => group.cyc[c]);
  const [cyc, setCyc] = useState('ALL');
  const rows = group.rows.filter(r => cyc === 'ALL' || r.c === cyc);
  const items = group.items.map(it => ({ it, rows: rows.filter(r => r.item === it) })).filter(x => x.rows.length);

  return (
    <div className="catv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 세부 항목 {group.items.length}개 · 액션 {group.rows.length}개</p>
      </header>

      <div className="catv-stats">
        {cycles.map(c => {
          const rs = group.rows.filter(r => r.c === c), d = rs.filter(isDone).length, due = c !== 'S' && isDue(c, now);
          return (
            <button key={c} className={`catv-stat ${cyc === c ? 'on' : ''} ${due ? 'due' : ''}`} onClick={() => setCyc(cyc === c ? 'ALL' : c)} aria-pressed={cyc === c}>
              <span className="muted">{CYCLES[c]}</span>
              <b>{d}<small>/{rs.length}</small></b>
              <span className="catv-when">{due ? '오늘 도래' : c === 'S' ? '필요할 때' : `기간 ${periodKey(c, now)}`}</span>
            </button>
          );
        })}
        <button className="catv-stat link" onClick={() => go('check', { area, cyc: cycles.includes('D') ? 'D' : cycles[0] })}>
          <span className="muted">체크리스트에서</span><b>열기</b><span className="catv-when">{AREAS[area].n} 필터</span>
        </button>
      </div>

      <div className="catv-items">
        {items.map(({ it, rows: rs }) => (
          <section key={it} className="catv-item">
            <div className="catv-item-h"><h3>{it}</h3><span className="muted">{rs.filter(isDone).length}/{rs.length}</span></div>
            {rs.map(r => <ActionRow key={r.id} row={r} showCycle />)}
          </section>
        ))}
      </div>
    </div>
  );
}
