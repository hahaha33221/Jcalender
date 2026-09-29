import React, { useRef, useState } from 'react';
import { iso } from '../data.js';
import { MoneyInput, WEEK, areaVar, useCtx } from '../shared.jsx';
import ShoppingList, { useFinance } from './Shopping.jsx';
import { EXP_CATS, addExpense, delExpense, won } from './finance.js';
import { CARD_COMPANIES, mergeCard, parseCardRows, readTable } from '../cardImport.js';

/* 개인 › 개인 재무 전용 화면: 지출 관리 + 구매해야 할 물품 (대시보드와 같은 데이터) */
export default function FinanceView({ area, cat }) {
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

  return (
    <div className="catv fv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
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

      <CardImport update={update} f={f} now={now} onMonth={setMonth} />

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
                <td>{e.memo || '-'}{e.shopId && <span className="tag">구매 목록</span>}{e.card && <span className="tag">{e.card}</span>}</td>
                <td className="num">{won(e.amount)}</td>
                <td><button className="tl-del" onClick={() => update(x => delExpense(x, e.id))}>{e.shopId ? '구매 취소' : '삭제'}</button></td></tr>))}</tbody>
          </table></div>
        ) : <p className="muted">이 달의 지출 내역이 없습니다.</p>}
      </section>

    </div>
  );
}

/* 카드 이용내역 가져오기 (롯데카드 · KB국민카드) — 공식 개인용 API 가 없어 카드사 엑셀 파일을 올린다 */
const uid = () => Math.random().toString(36).slice(2, 10);
const GUIDE = {
  롯데카드: '롯데카드 홈페이지(또는 앱) 로그인 → 이용내역 조회 → 기간 선택 → 엑셀 다운로드',
  KB국민카드: 'KB국민카드 홈페이지 로그인 → 이용내역 조회(승인내역) → 기간 선택 → 엑셀 저장',
};
function CardImport({ f, update, now, onMonth }) {
  const ref = useRef(null);
  const [pick, setPick] = useState('auto');
  const [msg, setMsg] = useState(null);
  const [undo, setUndo] = useState(null);
  const last = f.cardImport;
  const upload = async files => {
    const out = [];
    let fin = f, total = 0, err = false, lastMonth = null;
    for (const file of [...(files || [])]) {
      try {
        const rows = await readTable(file);
        const parsed = parseCardRows(rows, { pick, fileName: file.name, year: now.getFullYear() });
        if (!parsed.items.length) throw new Error('가져올 이용 건이 없습니다');
        const res = mergeCard(fin, parsed, uid);
        fin = res.fin; total += res.added;
        lastMonth = parsed.items.map(x => x.date).sort().pop().slice(0, 7);
        out.push(`${file.name} (${parsed.company}): 새로 ${res.added}건${res.dup ? `, 이미 있음 ${res.dup}건` : ''}${parsed.cancelled ? `, 취소 제외 ${parsed.cancelled}건` : ''}${res.removedExamples ? `, 예시 지출 ${res.removedExamples}건 삭제` : ''}`);
      } catch (e) { err = true; out.push(`${file.name}: 읽지 못했습니다 (${e.message})`); }
    }
    if (fin !== f) {
      const before = f;
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      update(() => ({ ...fin, cardImport: { at: stamp, added: total } }));
      setUndo(before);
      if (lastMonth) onMonth(lastMonth);
    }
    setMsg({ err: err && fin === f, t: out.join(' / ') });
    if (ref.current) ref.current.value = '';
  };
  return (
    <section className="panel fv-card">
      <div className="csum-h"><h2>카드 이용내역 가져오기</h2>
        <span className="muted">{last ? `마지막 가져오기 ${last.at}` : '롯데카드 · KB국민카드 이용내역 엑셀을 올리면 지출 내역에 들어갑니다'}</span></div>
      <div className="fv-card-row">
        <label className="fv-card-pick">카드사<select value={pick} onChange={e => setPick(e.target.value)}>
          <option value="auto">자동 인식</option>{CARD_COMPANIES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="btn primary">이용내역 파일 올리기<input ref={ref} type="file" accept=".xls,.xlsx,.csv,.htm,.html" multiple hidden onChange={e => upload(e.target.files)} /></label>
        {undo && <button className="btn" onClick={() => { update(() => undo); setUndo(null); setMsg({ t: '가져오기 전으로 되돌렸습니다.' }); }}>되돌리기</button>}
      </div>
      {msg && <p className={`sh-msg ${msg.err ? 'err' : ''}`} role="status">{msg.t}</p>}
      <ul className="fv-card-guide">{CARD_COMPANIES.map(c => <li key={c}><b>{c}</b> {GUIDE[c]}</li>)}</ul>
      <p className="note">.xls · .xlsx · .csv 를 읽습니다. 열은 머리글(이용일 · 가맹점 · 이용금액 · 승인번호 …)로 찾고, 취소 건은 빼고, 같은 승인번호는 한 번만 넣습니다. 분류는 가맹점 이름으로 추측하니 지출 내역에서 고쳐 주세요.</p>
    </section>
  );
}
