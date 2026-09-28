import React, { useState } from 'react';
import { AREAS, iso } from '../data.js';
import { ActionRow, MoneyInput, WEEK, areaVar, useCtx } from '../shared.jsx';
import ShoppingList, { useFinance } from './Shopping.jsx';
import { EXP_CATS, addExpense, delExpense, won } from './finance.js';

/* 개인 › 개인 재무 전용 화면: 지출 관리 + 구매해야 할 물품 (대시보드와 같은 데이터) */
export default function FinanceView({ area, cat, group }) {
  const { isDone } = useCtx();
  const [f, update, now] = useFinance();
  const today = iso(now), ym = today.slice(0, 7);
  const [month, setMonth] = useState(ym);
  const monthExp = f.expenses.filter(e => e.date.slice(0, 7) === month).sort((a, b) => b.date.localeCompare(a.date));
  const total = monthExp.reduce((a, e) => a + e.amount, 0);
  const todayTotal = f.expenses.filter(e => e.date === today).reduce((a, e) => a + e.amount, 0);
  const todo = f.shopping.filter(s => !s.bought);
  const expect = todo.reduce((a, s) => a + s.price * s.qty, 0);
  const byCat = EXP_CATS.map(c => ({ c, v: monthExp.filter(e => e.cat === c).reduce((a, e) => a + e.amount, 0) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const maxCat = Math.max(1, ...byCat.map(x => x.v));
  const ratio = f.budget ? total / f.budget : 0;
  // 지출이 있는 달 + 이번 달
  const months = [...new Set([ym, ...f.expenses.map(e => e.date.slice(0, 7))])].sort().reverse();

  const [form, setForm] = useState({ date: today, amount: '', cat: '식비', memo: '' });
  const add = e => {
    e.preventDefault();
    const amount = Math.max(0, Number(form.amount) || 0);
    if (!amount) return;
    update(x => addExpense(x, { date: form.date, amount, cat: form.cat, memo: form.memo.trim() }), form.date === today ? `${form.cat} ${won(amount)}` : null);
    setForm({ ...form, amount: '', memo: '' });
  };
  const setBudget = v => update(x => ({ ...x, budget: Math.max(0, Number(v) || 0) }));
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv fv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 지출 관리와 구매해야 할 물품. 물품을 구매 완료하면 지출 내역에 자동으로 기록됩니다.</p>
      </header>

      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">{month === ym ? '이번 달' : month.replace('-', '년 ') + '월'} 지출</span><b>{won(total)}</b><span className="hv-sub">{monthExp.length}건</span></div>
        <div className={`hv-stat ${ratio > 1 ? 'over' : 'sl'}`}>
          <span className="muted">예산 대비</span><b>{f.budget ? `${Math.round(ratio * 100)}%` : '-'}</b>
          <span className="hv-sub fv-budget">예산 <MoneyInput value={f.budget} onChange={setBudget} aria-label="월 예산" />원</span>
          <span className="pbar"><i style={{ width: `${Math.min(100, ratio * 100)}%`, background: ratio > 1 ? 'var(--over)' : 'var(--viz-sl)' }} /></span>
        </div>
        <div className="hv-stat ex"><span className="muted">구매 예정</span><b>{won(expect)}</b><span className="hv-sub">{todo.length}건</span></div>
        <div className="hv-stat ex"><span className="muted">오늘 지출</span><b>{won(todayTotal)}</b><span className="hv-sub">{WEEK[now.getDay()]}요일</span></div>
      </div>

      <div className="fv-grid">
        <ShoppingList />
        <div>
          <section className="panel">
            <h2>지출 입력</h2>
            <form className="fv-form" onSubmit={add}>
              <label>날짜<input type="date" value={form.date} max={today} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
              <label>분류<select value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })}>{EXP_CATS.map(c => <option key={c}>{c}</option>)}</select></label>
              <label>금액(원)<MoneyInput value={form.amount} onChange={v => setForm({ ...form, amount: v })} /></label>
              <label className="wide">메모<input value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} placeholder="예: 점심" /></label>
              <button className="btn primary" disabled={!Number(form.amount)}>기록</button>
            </form>
            <p className="note">오늘 지출을 기록하면 일일체크의 "지출 입력"이 완료됩니다.</p>
          </section>
          <section className="panel">
            <div className="hv-ch"><h2>분류별 지출</h2><span className="muted">{month.replace('-', '년 ')}월</span></div>
            {byCat.length ? (
              <ul className="fv-bars">{byCat.map(x => (
                <li key={x.c}><span className="fv-bl">{x.c}</span>
                  <span className="fv-track"><i style={{ width: `${x.v / maxCat * 100}%` }} /></span>
                  <span className="fv-bv">{won(x.v)}</span></li>))}</ul>
            ) : <p className="muted">지출 내역이 없습니다.</p>}
          </section>
        </div>
      </div>

      <section className="panel">
        <div className="csum-h"><h2>지출 내역</h2>
          <select value={month} onChange={e => setMonth(e.target.value)} aria-label="월 선택" className="fv-month">
            {months.map(m => <option key={m} value={m}>{m.replace('-', '년 ')}월</option>)}</select>
          <span className="muted">합계 {won(total)}</span></div>
        {monthExp.length ? (
          <div className="tablewrap"><table className="prog fv-table">
            <thead><tr><th>날짜</th><th>분류</th><th>내용</th><th>금액</th><th /></tr></thead>
            <tbody>{monthExp.map(e => (
              <tr key={e.id}><td>{e.date.slice(5).replace('-', '/')}</td><td>{e.cat}</td>
                <td>{e.memo || '-'}{e.shopId && <span className="tag">구매 목록</span>}</td>
                <td className="num">{won(e.amount)}</td>
                <td><button className="tl-del" onClick={() => update(x => delExpense(x, e.id))}>{e.shopId ? '구매 취소' : '삭제'}</button></td></tr>))}</tbody>
          </table></div>
        ) : <p className="muted">이 달의 지출 내역이 없습니다.</p>}
      </section>

      <h2 className="hv-sec">개인 재무 체크 항목</h2>
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
