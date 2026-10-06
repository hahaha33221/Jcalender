import React, { createContext, useContext, useEffect, useRef } from 'react';
import { AREAS, CYCLES, DAYS, PRIO, cycleName } from './data.js';

/* 여러 화면(App, 카테고리 전용 화면)이 함께 쓰는 공통 요소 */
export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
/** 팝업 창: 바깥을 누르거나 Esc 로 닫힘. wide 면 넓게 */
export function Popup({ title, sub, onClose, wide, children, actions }) {
  const ref = useRef(null);
  useEffect(() => {
    const esc = e => { const all = document.querySelectorAll('.modal-bg'); if (e.key === 'Escape' && all[all.length - 1] === ref.current) onClose(); };   // 맨 위 창만 닫기
    window.addEventListener('keydown', esc);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';   // 뒤 화면은 스크롤되지 않게
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="modal-bg" ref={ref} onClick={onClose}>
      <div className={`modal pop ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="pop-h"><div><h2>{title}</h2>{sub && <p className="muted">{sub}</p>}</div>{actions}<button className="btn sm" onClick={onClose}>닫기</button></div>
        <div className="pop-b">{children}</div>
      </div>
    </div>
  );
}
export const SENS = /검진|결과지|급여|명세|계약|명함|공제/;
/** 숫자를 세 자리마다 쉼표로 (1000000 → 1,000,000) */
export const num = n => Number(n || 0).toLocaleString('ko-KR');

/** 금액 입력칸: 입력하는 동안에도 쉼표를 보여주고, onChange 로는 숫자(또는 '')를 넘긴다 */
export function MoneyInput({ value, onChange, ...rest }) {
  const shown = value === '' || value == null ? '' : num(value);
  return (
    <input type="text" inputMode="numeric" value={shown} {...rest}
      onChange={e => { const d = e.target.value.replace(/[^0-9]/g, '').slice(0, 13); onChange(d === '' ? '' : Number(d)); }} />
  );
}

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
        <div className="sub">{row.item}{showCycle && ` · ${cycleName(row)}`}{!showCycle && DAYS[row.days] && ` · ${DAYS[row.days]}만`}</div></div>
      <span className={`badge ${row.code}`}>{row.ty}</span>
      <button className={`prio p${p}`} onClick={() => cyclePrio(row)} title="눌러서 우선순위 변경">{PRIO[p]}</button>
      <div className="det">{row.detail}</div>
      <div className="btns">{done
        ? <button className="btn sm" onClick={() => view(row)}>결과</button>
        : <button className="btn sm primary" disabled={busy} onClick={() => run(row)}>{row.ty === '없음' ? '메모' : '실행'}</button>}</div>
    </div>
  );
}
