import React, { useState } from 'react';
import { MoneyInput } from '../shared.jsx';
import { won } from './finance.js';
import BarChart from './BarChart.jsx';

/* 개인 재무 › 수입관리 탭
   finance.incomes      = [{ id, date, amount, cat, source(입금처), memo, fixedId?(정기 수입에서 넣은 것) }]
   finance.incomeFixed  = [{ id, cat, source, amount, day(매월 n일) }]   정기 수입(급여 등) — 달마다 한 번에 넣기
   구성: 요약(수입 · 지출 · 수지 · 저축률) → 수입 입력 | 정기 수입 → 분류별 수입 → 수입 내역(정렬 · 번호) → 월별 수입·지출 */
export const INCOME_CATS = ['급여', '상여', '부수입', '이자·배당', '용돈·지원', '환급', '기타'];
const uid = () => Math.random().toString(36).slice(2, 10);
const ymL = k => `${k.slice(0, 4)}년 ${Number(k.slice(5, 7))}월`;
const lastDay = ym => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();

export default function FinanceIncome({ f, update, today, month, setMonth, months }) {
  const incomes = f.incomes || [], fixed = f.incomeFixed || [];
  const inMonth = incomes.filter(e => e.date.startsWith(month));
  const inTotal = inMonth.reduce((a, e) => a + e.amount, 0);
  const exTotal = f.expenses.filter(e => e.date.startsWith(month)).reduce((a, e) => a + e.amount, 0);
  const net = inTotal - exTotal, rate = inTotal ? Math.round(net / inTotal * 100) : null;
  const setInc = fn => update(x => ({ ...x, incomes: fn(x.incomes || []) }));

  // 수입 입력
  const blank = { date: today.startsWith(month) ? today : `${month}-01`, cat: '급여', source: '', amount: '', memo: '', fixed: false };
  const [form, setForm] = useState(blank);
  const add = e => {
    e.preventDefault();
    const amount = Number(form.amount) || 0;
    if (!amount) return;
    const fid = form.fixed ? uid() : null;
    update(x => ({
      ...x,
      incomes: [...(x.incomes || []), { id: uid(), date: form.date, amount, cat: form.cat, source: form.source.trim(), memo: form.memo.trim(), ...(fid ? { fixedId: fid } : {}) }],
      incomeFixed: fid ? [...(x.incomeFixed || []), { id: fid, cat: form.cat, source: form.source.trim(), amount, day: Number(form.date.slice(8, 10)) }] : (x.incomeFixed || []),
    }));
    setForm({ ...blank, date: form.date, cat: form.cat });
  };
  // 정기 수입: 이번 달에 아직 없는 것만 넣기
  const missing = fixed.filter(t => !incomes.some(e => e.fixedId === t.id && e.date.startsWith(month)));
  const addFixed = () => setInc(l => [...l, ...missing.map(t => ({ id: uid(), date: `${month}-${String(Math.min(t.day, lastDay(month))).padStart(2, '0')}`, amount: t.amount, cat: t.cat, source: t.source, memo: '정기 수입', fixedId: t.id }))]);

  // 분류별 · 정렬
  const byCat = INCOME_CATS.concat(inMonth.map(e => e.cat)).filter((c, i, a) => a.indexOf(c) === i)
    .map(c => ({ c, v: inMonth.filter(e => e.cat === c).reduce((a, e) => a + e.amount, 0) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const maxCat = Math.max(1, ...byCat.map(x => x.v));
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const val = { date: e => e.date, cat: e => e.cat, source: e => e.source || '', memo: e => e.memo || '', amount: e => e.amount };
  const list = [...inMonth].sort((a, b) => {
    const x = val[sort.key](a), y = val[sort.key](b);
    const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
    return (sort.dir === 'asc' ? r : -r) || b.date.localeCompare(a.date);
  });
  const sortBy = k => setSort(s => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'date' || k === 'amount' ? 'desc' : 'asc' }));
  const COLS = [['date', '날짜'], ['cat', '분류'], ['source', '입금처'], ['memo', '메모'], ['amount', '금액']];

  // 월별 수입 · 지출 · 수지
  const allMonths = [...new Set([...incomes.map(e => e.date.slice(0, 7)), ...f.expenses.map(e => e.date.slice(0, 7)), month])].sort();
  const sumBy = (l, m) => l.filter(e => e.date.startsWith(m)).reduce((a, e) => a + e.amount, 0);
  let acc = 0;
  const rows = allMonths.map(m => { const i = sumBy(incomes, m), x = sumBy(f.expenses, m); acc += i - x; return { m, i, x, n: i - x, acc }; });
  const chart = allMonths.slice(-12).map(m => ({ key: m, label: `${Number(m.slice(5))}월`, title: ymL(m), value: sumBy(incomes, m), tip: [`지출 ${won(sumBy(f.expenses, m))}`, `수지 ${won(sumBy(incomes, m) - sumBy(f.expenses, m))}`] }));

  return (
    <>
      <div className="hv-stats">
        <div className="hv-stat ex"><span className="muted">{ymL(month)} 수입</span><b>{won(inTotal)}</b><span className="hv-sub">{inMonth.length}건</span></div>
        <div className="hv-stat sl"><span className="muted">{ymL(month)} 지출</span><b>{won(exTotal)}</b><span className="hv-sub">지출관리 기준</span></div>
        <div className={`hv-stat ${net < 0 ? 'over' : 'ex'}`}><span className="muted">수지 (수입 − 지출)</span><b>{net < 0 ? '-' : ''}{won(Math.abs(net))}</b><span className="hv-sub">{net < 0 ? '적자' : '흑자'}</span></div>
        <div className="hv-stat ex"><span className="muted">저축률</span><b>{rate == null ? '-' : `${rate}%`}</b><span className="hv-sub">수지 ÷ 수입</span></div>
      </div>

      <div className="fv-grid fv-grid2">
        <section className="panel">
          <h2>수입 입력</h2>
          <form className="fv-form" onSubmit={add}>
            <label>날짜<input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
            <label>분류<select value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })}>{INCOME_CATS.map(c => <option key={c}>{c}</option>)}</select></label>
            <label>금액(원)<MoneyInput value={form.amount} onChange={v => setForm({ ...form, amount: v })} aria-label="수입 금액" /></label>
            <label>입금처<input value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="예: 회사, 은행" /></label>
            <label className="wide">메모<input value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} placeholder="예: 9월 급여" /></label>
            <label className="chk fi-chk"><input type="checkbox" checked={form.fixed} onChange={e => setForm({ ...form, fixed: e.target.checked })} />매월 정기 수입으로 등록</label>
            <button className="btn primary" disabled={!Number(form.amount)}>기록</button>
          </form>
        </section>
        <section className="panel">
          <div className="hv-ch"><h2>정기 수입</h2><span className="muted">급여처럼 매달 들어오는 수입</span>
            {fixed.length > 0 && <button className="btn sm primary grow-r" disabled={!missing.length} onClick={addFixed}>{missing.length ? `${ymL(month)}에 ${missing.length}건 넣기` : `${ymL(month)} 반영됨`}</button>}</div>
          {fixed.length ? <ul className="fi-fixed">{fixed.map(t => (
            <li key={t.id}><span className="tag">{t.cat}</span><span className="grow">{t.source || '-'} · 매월 {t.day}일</span><b>{won(t.amount)}</b>
              <button className="tl-del" onClick={() => update(x => ({ ...x, incomeFixed: (x.incomeFixed || []).filter(k => k.id !== t.id) }))}>삭제</button></li>))}</ul>
            : <p className="muted">수입 입력에서 "매월 정기 수입으로 등록"을 체크하면 여기에 쌓이고, 달마다 한 번에 넣을 수 있습니다.</p>}
        </section>
      </div>

      <section className="panel">
        <div className="hv-ch"><h2>분류별 수입</h2><span className="muted">{ymL(month)}</span></div>
        {byCat.length ? <ul className="fv-bars fv-cbars">{byCat.map(x => (
          <li key={x.c}><span className="fv-bl">{x.c}</span><span className="fv-track"><i style={{ width: `${x.v / maxCat * 100}%`, background: 'var(--viz-ex)' }} /></span>
            <span className="fv-bv">{won(x.v)} <small>{Math.round(x.v / inTotal * 100)}%</small></span></li>))}</ul> : <p className="muted">이 달의 수입이 없습니다.</p>}
      </section>

      <section className="panel">
        <div className="csum-h"><h2>수입 내역</h2>
          <select value={month} onChange={e => setMonth(e.target.value)} aria-label="월 선택" className="fv-month">
            {[...new Set([...months, ...incomes.map(e => e.date.slice(0, 7))])].sort().reverse().map(m => <option key={m} value={m}>{m.replace('-', '년 ')}월</option>)}</select>
          <span className="muted">{inMonth.length}건 · 합계 {won(inTotal)}</span></div>
        {list.length ? (
          <div className="tablewrap"><table className="prog fv-table fi-table">
            <thead><tr><th className="fv-no">No.</th>{COLS.map(([k, n]) => (
              <th key={k} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="fv-sort">
                <button onClick={() => sortBy(k)}>{n}<i aria-hidden="true">{sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</i></button></th>))}<th /></tr></thead>
            <tbody>{list.map((e, i) => (
              <tr key={e.id}><td className="fv-no">{i + 1}</td><td>{e.date.slice(5).replace('-', '/')}</td>
                <td><select className="fv-cat" value={e.cat} onChange={ev => setInc(l => l.map(k => (k.id === e.id ? { ...k, cat: ev.target.value } : k)))} aria-label="수입 분류">
                  {[...new Set([...INCOME_CATS, e.cat])].map(c => <option key={c}>{c}</option>)}</select></td>
                <td>{e.source || '-'}</td><td>{e.memo || '-'}{e.fixedId && <span className="tag">정기</span>}</td>
                <td className="num">{won(e.amount)}</td>
                <td><button className="tl-del" onClick={() => setInc(l => l.filter(k => k.id !== e.id))}>삭제</button></td></tr>))}</tbody>
          </table></div>
        ) : <p className="muted">이 달의 수입 내역이 없습니다.</p>}
      </section>

      <section className="panel">
        <div className="csum-h"><h2>월별 수입 · 지출</h2><span className="muted">줄을 누르면 그 달을 봅니다</span></div>
        {incomes.length > 0 && <BarChart data={chart} color="var(--viz-ex)" fmt={v => won(v)} tickFmt={v => (v >= 10000 ? `${Math.round(v / 10000)}만` : `${v}`)} label="월별 수입" height={180} />}
        <div className="tablewrap"><table className="prog fm-table">
          <thead><tr><th>월</th><th>수입</th><th>지출</th><th>수지</th><th>저축률</th><th>누적 수지</th></tr></thead>
          <tbody>{[...rows].reverse().map(r => (
            <tr key={r.m} className={r.m === month ? 'on' : ''} onClick={() => setMonth(r.m)}>
              <td className="fm-m">{ymL(r.m)}</td><td className="num">{r.i ? won(r.i) : '-'}</td><td className="num">{r.x ? won(r.x) : '-'}</td>
              <td className={`num ${r.n < 0 ? 'fm-up' : r.n > 0 ? 'fm-down' : ''}`}>{r.n < 0 ? '-' : r.n > 0 ? '+' : ''}{won(Math.abs(r.n))}</td>
              <td className="num">{r.i ? `${Math.round(r.n / r.i * 100)}%` : '-'}</td>
              <td className="num">{r.acc < 0 ? '-' : ''}{won(Math.abs(r.acc))}</td></tr>))}</tbody>
        </table></div>
      </section>
    </>
  );
}
