import React, { useState } from 'react';
import { iso } from '../data.js';
import { MoneyInput, useCtx } from '../shared.jsx';
import { ACT_EXPENSE, addShop, catsOf, buyShop, delShop, seedFinance, unbuyShop, won } from './finance.js';

/** 재무 데이터와 변경 함수 */
export function useFinance() {
  const { store, setStore, now, isDone, finish } = useCtx();
  // 연계 프로젝트는 공통 프로젝트 표(store.projects)에 있다. 재무 화면에는 합쳐서 보여 주고, 바뀐 것은 나눠 저장한다
  const f = { ...(store.finance || seedFinance(now)), projects: store.projects || [] };
  const update = (fn, todayMemo) => {
    setStore(s => {
      const next = fn({ ...(s.finance || seedFinance(now)), projects: s.projects || [] });
      const { projects, ...fin } = next;
      return { ...s, finance: fin, projects: (projects || []).map(p => ({ status: '진행', start: '', end: '', areas: ['P'], ...p })) };
    });
  };
  return [f, update, now];
}

/* 구매해야 할 물품. compact 는 대시보드용(구매 예정만, 짧게) */
export default function ShoppingList({ compact }) {
  const { openCat } = useCtx();
  const [f, update, now] = useFinance();
  const today = iso(now);
  const todo = f.shopping.filter(s => !s.bought).sort((a, b) => (a.added || '').localeCompare(b.added || ''));
  const done = f.shopping.filter(s => s.bought).sort((a, b) => b.bought.localeCompare(a.bought));
  const expect = todo.reduce((a, s) => a + s.price * s.qty, 0);
  const monthPaid = done.filter(s => s.bought.slice(0, 7) === today.slice(0, 7)).reduce((a, s) => a + s.paid, 0);
  const [form0, setForm] = useState({ name: '', price: '', cat: '생활용품', qty: 1 });
  const names = catsOf(f).map(c => c.name);
  const form = names.includes(form0.cat) ? form0 : { ...form0, cat: names[0] };   // 카테고리를 바꾸거나 지웠을 때
  const [paid, setPaid] = useState({});          // 물품별 실제 결제 금액 입력값

  const add = e => {
    e.preventDefault();
    if (!form.name.trim()) return;
    update(x => addShop(x, { name: form.name.trim(), price: Math.max(0, Number(form.price) || 0), cat: form.cat, qty: Math.max(1, Number(form.qty) || 1), added: today }));
    setForm({ ...form, name: '', price: '', qty: 1 });
  };
  const buy = s => {
    const amount = Math.max(0, Number(paid[s.id] ?? s.price * s.qty) || 0);
    update(x => buyShop(x, s.id, amount, today), `${s.name} ${won(amount)}`);
  };
  const shown = compact ? todo.slice(0, 6) : todo;

  return (
    <section className={`panel shop ${compact ? 'compact' : ''}`} aria-label="구매해야 할 물품">
      <div className="csum-h">
        <h2>구매해야 할 물품</h2>
        <span className="muted">{todo.length}건 · 예상 {won(expect)}{monthPaid ? ` · 이번 달 구매 ${won(monthPaid)}` : ''}</span>
        {compact && <button className="btn sm" onClick={() => openCat('P', '개인 재무')}>지출 관리에서 보기</button>}
      </div>
      <form className="shop-add" onSubmit={add}>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="물품 이름 (예: 샴푸)" aria-label="물품 이름" />
        {!compact && <label className="shop-qty">수량<input type="number" min="1" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></label>}
        <MoneyInput value={form.price} onChange={v => setForm({ ...form, price: v })} placeholder="예상 금액(원)" aria-label="예상 금액" />
        <select value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })} aria-label="지출 분류">{catsOf(f).map(c => <option key={c.name}>{c.name}</option>)}</select>
        <button className="btn primary" disabled={!form.name.trim()}>추가</button>
      </form>
      {shown.length ? (
        <ul className="shop-list">{shown.map(s => (
          <li key={s.id}>
            <span className="shop-n"><b>{s.name}</b>{s.qty > 1 && <span className="muted"> ×{s.qty}</span>}<span className="tag">{s.cat}</span></span>
            <label className="shop-pay"><MoneyInput value={paid[s.id] ?? s.price * s.qty}
              onChange={v => setPaid({ ...paid, [s.id]: v })} aria-label={`${s.name} 결제 금액`} />원</label>
            <button className="btn sm primary" onClick={() => buy(s)}>구매 완료</button>
            <button className="tl-del" onClick={() => update(x => delShop(x, s.id))} aria-label={`${s.name} 삭제`}>삭제</button>
          </li>))}</ul>
      ) : <p className="muted shop-empty">구매할 물품이 없습니다.</p>}
      {compact && todo.length > shown.length && <p className="note">외 {todo.length - shown.length}건은 지출 관리에서 볼 수 있습니다.</p>}
      <p className="note">구매 완료를 누르면 그 금액이 개인 재무의 지출 내역에 오늘 날짜로 기록됩니다.</p>
      {!compact && done.length > 0 && (
        <>
          <h3 className="shop-h3">최근 구매</h3>
          <ul className="shop-list done">{done.slice(0, 8).map(s => (
            <li key={s.id}>
              <span className="shop-n"><b>{s.name}</b><span className="tag">{s.cat}</span></span>
              <span className="muted">{s.bought.slice(5).replace('-', '/')} · {won(s.paid)}</span>
              <button className="btn sm" onClick={() => update(x => unbuyShop(x, s.id))}>구매 취소</button>
            </li>))}</ul>
        </>
      )}
    </section>
  );
}
