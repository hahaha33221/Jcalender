import React, { createContext, useContext } from 'react';
import { AREAS, CYCLES, PRIO } from './data.js';

/* 여러 화면(App, 카테고리 전용 화면)이 함께 쓰는 공통 요소 */
export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const SENS = /검진|결과지|급여|명세|계약|명함|공제/;
export const areaVar = a => (AREAS[a] ? `var(${AREAS[a].v})` : 'var(--ink3)');

/** 앱 상태와 동작 (store, now, isDone, toggle, run, go 등) */
export const Ctx = createContext(null);
export const useCtx = () => useContext(Ctx);

/* 액션 한 줄 */
export function ActionRow({ row, showCycle }) {
  const { isDone, prioOf, cyclePrio, toggle, run, view, busy } = useCtx();
  const done = isDone(row), p = prioOf(row), sens = SENS.test(`${row.item} ${row.action} ${row.detail}`);
  const name = row.action.replace(' (제안)', '');
  return (
    <div className={`row ${done ? 'done' : ''}`} style={{ '--ac': areaVar(row.a) }}>
      <input type="checkbox" checked={done} disabled={busy} onChange={() => toggle(row)} aria-label={`${name} 완료`} />
      <div className="act"><b>{name}</b>{row.action.includes('(제안)') && <span className="tag">제안</span>}{sens && <span className="tag sens">민감정보</span>}
        <div className="sub">{row.item}{showCycle && ` · ${CYCLES[row.c]}`}</div></div>
      <span className={`badge ${row.code}`}>{row.ty}</span>
      <button className={`prio p${p}`} onClick={() => cyclePrio(row)} title="눌러서 우선순위 변경">{PRIO[p]}</button>
      <div className="det">{row.detail}</div>
      <div className="btns">{done
        ? <button className="btn sm" onClick={() => view(row)}>결과</button>
        : <button className="btn sm primary" disabled={busy} onClick={() => run(row)}>{row.ty === '없음' ? '메모' : '실행'}</button>}</div>
    </div>
  );
}
