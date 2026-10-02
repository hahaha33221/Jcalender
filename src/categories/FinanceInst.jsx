import React from 'react';
import { won } from './finance.js';
import { instOf, memoNoInst } from '../cardImport.js';

/* 개인 재무 › 지출관리 › 할부 관리 대시보드
   지출 내역 중 할부(inst: { months, round })인 줄을 "할부 한 건"으로 묶는다
   - 명세서로 가져온 할부(회차 있음): 같은 카드 · 가맹점 · 개월 수 · 시작 달(그 달 - (회차-1))이면 같은 할부
     월 납부액 = 가장 최근 회차 금액
   - 이용일 기준으로 가져온 할부(회차 없음): 이용 금액 ÷ 개월 수, 이용한 달이 1회차
   - 기준 달(지출 내역에서 고른 달)에 몇 회차인지 · 남은 회차 · 남은 금액 · 끝나는 달을 계산 */
const mi = ym => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const ymOf = i => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
const ymL = k => `${k.slice(0, 4)}년 ${Number(k.slice(5, 7))}월`;
const ymS = k => `${k.slice(2, 4)}.${k.slice(5, 7)}`;
const norm = t => String(t || '').toLowerCase().replace(/\s+/g, '');

/** 지출 내역 → 할부 목록 [{ key, name, card, months, start, end, monthly, total, recs: { 'YYYY-MM': 금액 } }] */
export function instPlans(expenses) {
  const map = new Map();
  (expenses || []).forEach(e => {
    const i = instOf(e);
    if (!i) return;
    const name = memoNoInst(e.memo) || '할부', at = mi(e.date.slice(0, 7));
    const start = i.round ? at - (i.round - 1) : at;
    const key = `${norm(e.card)}|${norm(name)}|${i.months}|${start}`;
    let p = map.get(key);
    if (!p) { p = { key, name, card: e.card || '', cat: e.cat, months: i.months, startI: start, recs: {}, last: null, use: !i.round }; map.set(key, p); }
    const ym = e.date.slice(0, 7);
    p.recs[ym] = (p.recs[ym] || 0) + e.amount;
    if (!i.round) p.use = true;
    if (!p.last || e.date > p.last.date) p.last = e;
  });
  return [...map.values()].map(p => {
    const monthly = p.use && Object.keys(p.recs).length === 1 ? Math.round(p.last.amount / p.months) : p.last.amount;
    const start = ymOf(p.startI), end = ymOf(p.startI + p.months - 1);
    return { key: p.key, name: p.name, card: p.card, cat: p.cat, months: p.months, start, end, startI: p.startI, use: p.use, monthly, total: p.use && Object.keys(p.recs).length === 1 ? p.last.amount : monthly * p.months, recs: p.recs };
  });
}
/** 기준 달의 상태: 회차 · 남은 회차 · 남은 금액 */
export function instAt(p, ym) {
  const round = mi(ym) - p.startI + 1;
  const st = round < 1 ? 'wait' : round > p.months ? 'done' : 'on';
  const r = Math.min(Math.max(round, 0), p.months);
  const left = p.months - r;
  return { round, st, r, left, leftAmt: left * p.monthly, paidAmt: p.total - left * p.monthly, due: st === 'on' ? (p.use ? p.monthly : p.recs[ym] ?? p.monthly) : 0, seen: !p.use && p.recs[ym] != null };
}
/** 지출관리 상단 요약용 */
export function instSummary(expenses, ym) {
  const on = instPlans(expenses).map(p => ({ p, a: instAt(p, ym) })).filter(x => x.a.st === 'on');
  return { n: on.length, due: on.reduce((s, x) => s + x.a.due, 0), left: on.reduce((s, x) => s + x.a.leftAmt, 0) };
}

const ST = { on: '진행 중', done: '완료', wait: '시작 전' };

export default function FinanceInst({ f, month, open, setOpen, showDone, setShowDone }) {
  const plans = instPlans(f.expenses);
  const rows = plans.map(p => ({ p, a: instAt(p, month) }))
    .sort((x, y) => (x.a.st === 'on' ? 0 : x.a.st === 'wait' ? 1 : 2) - (y.a.st === 'on' ? 0 : y.a.st === 'wait' ? 1 : 2) || x.p.end.localeCompare(y.p.end) || y.p.monthly - x.p.monthly);
  const on = rows.filter(x => x.a.st === 'on');
  const due = on.reduce((s, x) => s + x.a.due, 0);
  const left = on.reduce((s, x) => s + x.a.leftAmt, 0);
  const lastEnd = on.map(x => x.p.end).sort().pop();
  const ending = on.filter(x => x.a.left === 0);
  // 앞으로 12달 할부 청구 예상 (기준 달부터)
  const base = mi(month);
  const fc = Array.from({ length: 12 }, (_, k) => {
    const ym = ymOf(base + k);
    return { ym, v: plans.reduce((s, p) => s + instAt(p, ym).due, 0) };
  });
  const maxFc = Math.max(1, ...fc.map(x => x.v));
  const shown = showDone ? rows : rows.filter(x => x.a.st !== 'done');

  return (
    <section className="panel fi" id="fv-inst">
      <div className="csum-h">
        <h2>할부 관리</h2>
        <span className="muted">{ymL(month)} 기준 · 카드 내역의 할부를 한 건씩 묶어 남은 회차 · 금액을 계산합니다</span>
        <button className="btn sm grow-r" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '접기' : '펼치기'}</button>
      </div>
      {!plans.length ? <p className="muted">할부 내역이 없습니다. 카드 내역 파일에 할부 칸(개월 · 회차)이 있으면 자동으로 모입니다.</p> : <>
        <div className="hv-stats fi-stats">
          <div className="hv-stat ex"><span className="muted">{ymL(month)} 할부 청구</span><b>{won(due)}</b><span className="hv-sub">{on.length}건 진행 중</span></div>
          <div className="hv-stat sl"><span className="muted">남은 할부 금액</span><b>{won(left)}</b><span className="hv-sub">{ymL(month)} 청구 뒤 남은 돈</span></div>
          <div className="hv-stat sl"><span className="muted">이번 달로 끝나는 할부</span><b>{ending.length}건</b><span className="hv-sub">{ending.length ? `다음 달부터 월 ${won(ending.reduce((s, x) => s + x.p.monthly, 0))} 줄어듦` : '없음'}</span></div>
          <div className="hv-stat ex"><span className="muted">모든 할부가 끝나는 달</span><b>{lastEnd ? ymL(lastEnd) : '-'}</b><span className="hv-sub">{lastEnd ? `${mi(lastEnd) - base}달 남음` : '진행 중인 할부 없음'}</span></div>
        </div>
        {open && <>
          <div className="fi-fc" role="img" aria-label="앞으로 12달 할부 청구 예상">
            <div className="hv-ch"><h3>앞으로 12달 할부 청구 예상</h3><span className="muted">새 할부가 없을 때 · 막대에 마우스를 올리면 금액</span></div>
            <div className="fi-cols">{fc.map(x => (
              <div key={x.ym} className={`fi-col ${x.ym === month ? 'now' : ''}`} title={`${ymL(x.ym)} ${won(x.v)}`}>
                <span className="fi-v">{x.v ? `${Math.round(x.v / 1000).toLocaleString()}천` : ''}</span>
                <span className="fi-bar"><i style={{ height: `${x.v / maxFc * 100}%` }} /></span>
                <span className="fi-m">{ymS(x.ym)}</span></div>))}</div>
          </div>
          <div className="csum-h fi-th"><h3>할부 목록</h3><span className="muted">{shown.length}건{rows.length !== shown.length ? ` · 끝난 할부 ${rows.length - shown.length}건 숨김` : ''}</span>
            <label className="fv-timeopt grow-r"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> 끝난 할부도 보기</label></div>
          <div className="tablewrap"><table className="prog fv-table fi-table">
            <thead><tr><th>가맹점</th><th>카드</th><th>기간</th><th>진행</th><th className="r">월 납부</th><th className="r">총액</th><th className="r">남은 금액</th><th>상태</th></tr></thead>
            <tbody>{shown.map(({ p, a }) => (
              <tr key={p.key} className={a.st}>
                <td><b>{p.name}</b>{p.cat && <small className="muted"> · {p.cat}</small>}</td>
                <td className="nw">{p.card || '-'}</td>
                <td className="nw">{ymS(p.start)} ~ {ymS(p.end)} <small className="muted">({p.months}개월)</small></td>
                <td className="fi-prog"><span className="pbar"><i style={{ width: `${a.r / p.months * 100}%` }} /></span>
                  <small>{a.st === 'wait' ? '시작 전' : `${a.r}/${p.months}회`}{a.st === 'on' && !p.use && !a.seen ? ' (예상)' : ''}</small></td>
                <td className="num">{won(p.monthly)}</td>
                <td className="num">{won(p.total)}</td>
                <td className="num">{a.leftAmt ? won(a.leftAmt) : '-'}<br /><small className="muted">{a.left ? `${a.left}회 남음` : ''}</small></td>
                <td><span className={`fs-st ${a.st === 'on' ? (a.left === 0 ? 'paid' : '') : a.st === 'done' ? 'paid' : ''}`}>{a.st === 'on' && a.left === 0 ? '이번 달 마지막' : ST[a.st]}</span></td>
              </tr>))}
              <tr className="fs-sum"><td>진행 중 합계</td><td /><td /><td /><td className="num"><b>{won(on.reduce((s, x) => s + x.p.monthly, 0))}</b></td><td /><td className="num"><b>{won(left)}</b></td><td /></tr>
            </tbody></table></div>
          <p className="note">회차는 명세서의 회차(예: 2/6회차)로 시작 달을 계산합니다. 기준 달에 명세서 내역이 없으면 같은 금액으로 이어진다고 보고 "(예상)"으로 표시합니다. 이용일 기준으로 가져온 할부는 이용 금액 ÷ 개월 수로 나눕니다.</p>
        </>}
      </>}
    </section>
  );
}
