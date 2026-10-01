import React, { useState } from 'react';
import { MoneyInput } from '../shared.jsx';
import { catsOf, won } from './finance.js';

/* 개인 재무 › 구독관리 탭: 매달(매년) 나가는 구독 고정비
   finance.subs = [{ id, name, amount, cycle: 'M' 매월 | 'Y' 매년, day(결제일), month(매년일 때 결제 월), cat(지출 분류), key(카드 내역에서 찾을 글자), active, memo }]
   - 월 고정비 = 매월 금액 + 매년 금액 ÷ 12, 연 고정비 = 매월 × 12 + 매년
   - 이번 달 결제 확인: 그 달 지출 내역(카드 가져오기)에서 찾을 글자가 들어간 줄 → 결제됨 / 예정 / 확인 안 됨
   - 구독 후보: 지출 내역에서 2달 이상 비슷한 금액으로 반복된 가맹점, 흔한 구독 서비스 이름 */
const uid = () => Math.random().toString(36).slice(2, 10);
const ymL = k => `${k.slice(0, 4)}년 ${Number(k.slice(5, 7))}월`;
const lastDay = ym => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
const norm = t => String(t || '').toLowerCase().replace(/\s+/g, '').replace(/\(.*?\)/g, '').replace(/[0-9*#_\-.]/g, '');
const KNOWN = /넷플릭스|netflix|유튜브|youtube|쿠팡\s?와우|와우멤버|멜론|melon|스포티파이|spotify|디즈니|disney|티빙|tving|웨이브|wavve|왓챠|watcha|애플|apple|icloud|구글|google|네이버\s?플러스|naver ?plus|chatgpt|openai|claude|anthropic|노션|notion|어도비|adobe|마이크로소프트|microsoft|365|지니|genie|밀리의서재|리디|ridi|배민클럽|요기패스|컬리패스|github|figma|canva|dropbox/i;

export const monthlyOf = s => (s.cycle === 'Y' ? Math.round((Number(s.amount) || 0) / 12) : Number(s.amount) || 0);
const keysOf = s => [s.key, s.name].map(norm).filter(Boolean);
/** 지출 한 줄이 어느 구독의 결제인지 (찾을 글자 · 이름이 가맹점에 들어 있으면) */
export const subOf = (e, subs) => (subs || []).find(s => keysOf(s).some(k => norm(e.memo).includes(k)));
/** 그 달의 결제일 (매년이면 결제 월에만) → 'YYYY-MM-DD' | null */
export const dueIn = (s, ym) => {
  if (s.cycle === 'Y' && Number(s.month || 1) !== Number(ym.slice(5, 7))) return null;
  return `${ym}-${String(Math.min(Number(s.day) || 1, lastDay(ym))).padStart(2, '0')}`;
};
/** 지출관리 화면 요약용: 이번 달 구독 고정비 */
export function subsSummary(f, ym) {
  const subs = (f.subs || []).filter(s => s.active !== false);
  const due = subs.filter(s => dueIn(s, ym));
  return { n: subs.length, monthly: subs.reduce((a, s) => a + monthlyOf(s), 0), thisMonth: due.reduce((a, s) => a + (Number(s.amount) || 0), 0), due: due.length };
}

export default function FinanceSubs({ f, update, today, month, setMonth, months }) {
  const subs = f.subs || [];
  const active = subs.filter(s => s.active !== false);
  const setSubs = fn => update(x => ({ ...x, subs: fn(x.subs || []) }));
  const cats = catsOf(f).map(c => c.name);
  const blank = { name: '', amount: '', cycle: 'M', day: Number(today.slice(8, 10)), month: Number(today.slice(5, 7)), cat: cats.includes('구독') ? '구독' : cats[0] || '기타', key: '', memo: '' };
  const [form, setForm] = useState(blank);
  const add = (e, base = form) => {
    e?.preventDefault?.();
    const amount = Number(base.amount) || 0;
    if (!base.name.trim() || !amount) return;
    setSubs(l => [...l, { id: uid(), ...base, name: base.name.trim(), key: (base.key || '').trim(), amount, day: Math.min(31, Math.max(1, Number(base.day) || 1)), month: Number(base.month) || 1, active: true }]);
    setForm({ ...blank, cat: base.cat });
  };
  const patch = (id, p) => setSubs(l => l.map(s => (s.id === id ? { ...s, ...p } : s)));
  const [arm, setArm] = useState(null);
  const del = id => { if (arm !== id) { setArm(id); setTimeout(() => setArm(a => (a === id ? null : a)), 3000); return; } setSubs(l => l.filter(s => s.id !== id)); setArm(null); };

  // 합계
  const monthly = active.reduce((a, s) => a + monthlyOf(s), 0);
  const yearly = active.reduce((a, s) => a + (s.cycle === 'Y' ? Number(s.amount) || 0 : (Number(s.amount) || 0) * 12), 0);
  const monthExp = f.expenses.filter(e => e.date.startsWith(month));
  const spent = monthExp.reduce((a, e) => a + e.amount, 0);

  // 이번 달 결제 확인
  const checks = active.map(s => {
    const date = dueIn(s, month);
    if (!date) return null;
    const paid = monthExp.filter(e => keysOf(s).some(k => norm(e.memo).includes(k)));
    const d = Math.round((new Date(`${date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 864e5);
    return { s, date, paid, sum: paid.reduce((a, e) => a + e.amount, 0), st: paid.length ? 'paid' : d >= 0 ? 'soon' : 'miss', d };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  const thisMonth = checks.reduce((a, c) => a + (Number(c.s.amount) || 0), 0);
  const paidSum = checks.filter(c => c.st === 'paid').reduce((a, c) => a + c.sum, 0);

  // 분류별 월 고정비
  const byCat = [...new Set(active.map(s => s.cat || '기타'))].map(c => ({ c, v: active.filter(s => (s.cat || '기타') === c).reduce((a, s) => a + monthlyOf(s), 0) })).sort((a, b) => b.v - a.v);
  const maxCat = Math.max(1, ...byCat.map(x => x.v));

  // 구독 후보: 지출에서 반복된 가맹점 · 흔한 구독 이름 (이미 등록한 것은 뺌)
  const groups = {};
  f.expenses.forEach(e => { const k = norm(e.memo); if (k.length >= 2) (groups[k] ||= []).push(e); });
  const cands = Object.values(groups).map(list => {
    const ms = [...new Set(list.map(e => e.date.slice(0, 7)))];
    const amts = list.map(e => e.amount), lo = Math.min(...amts), hi = Math.max(...amts);
    const known = KNOWN.test(list[0].memo || '');
    if (!(known || (ms.length >= 2 && hi <= lo * 1.2))) return null;
    if (subs.some(s => keysOf(s).some(k => norm(list[0].memo).includes(k)))) return null;
    const last = [...list].sort((a, b) => b.date.localeCompare(a.date))[0];
    return { name: (last.memo || '').replace(/\s*\(.*\)$/, ''), amount: last.amount, day: Number(last.date.slice(8, 10)), months: ms.length, cat: last.cat, known };
  }).filter(Boolean).sort((a, b) => b.months - a.months || b.amount - a.amount).slice(0, 8);

  const ST = { paid: '결제됨', soon: '예정', miss: '확인 안 됨' };
  return (
    <>
      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">월 구독 고정비</span><b>{won(monthly)}</b><span className="hv-sub">{active.length}개 · 매년 결제는 ÷12</span></div>
        <div className="hv-stat sl"><span className="muted">연간 구독비</span><b>{won(yearly)}</b><span className="hv-sub">1년 동안 나가는 돈</span></div>
        <div className="hv-stat ex"><span className="muted">{ymL(month)} 결제 예정</span><b>{won(thisMonth)}</b><span className="hv-sub">{checks.length}건 · 확인 {won(paidSum)}</span></div>
        <div className="hv-stat ex"><span className="muted">{ymL(month)} 지출 중 구독</span><b>{spent ? `${Math.round(paidSum / spent * 100)}%` : '-'}</b><span className="hv-sub">지출 {won(spent)} 중</span></div>
      </div>

      <div className="fv-grid fv-grid2">
        <section className="panel">
          <h2>구독 추가</h2>
          <form className="fv-form" onSubmit={add}>
            <label>서비스 이름<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="예: 넷플릭스, 유튜브 프리미엄" /></label>
            <label>금액(원)<MoneyInput value={form.amount} onChange={v => setForm({ ...form, amount: v })} aria-label="구독 금액" /></label>
            <label>주기<select value={form.cycle} onChange={e => setForm({ ...form, cycle: e.target.value })}><option value="M">매월</option><option value="Y">매년</option></select></label>
            {form.cycle === 'Y' && <label>결제 월<select value={form.month} onChange={e => setForm({ ...form, month: Number(e.target.value) })}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}월</option>)}</select></label>}
            <label>결제일<select value={form.day} onChange={e => setForm({ ...form, day: Number(e.target.value) })}>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}일</option>)}</select></label>
            <label>지출 분류<select value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })}>{[...new Set([...cats, '구독', '기타'])].map(c => <option key={c}>{c}</option>)}</select></label>
            <label className="wide">카드 내역에서 찾을 글자 (선택)<input value={form.key} onChange={e => setForm({ ...form, key: e.target.value })} placeholder="비우면 서비스 이름으로 찾습니다 (예: NETFLIX)" /></label>
            <button className="btn primary" disabled={!form.name.trim() || !Number(form.amount)}>추가</button>
          </form>
        </section>
        <section className="panel">
          <div className="hv-ch"><h2>구독 후보</h2><span className="muted">지출 내역에서 반복된 결제</span></div>
          {cands.length ? <ul className="fs-cands">{cands.map(c => (
            <li key={c.name}><span className="grow"><b>{c.name}</b> <small className="muted">{c.known ? '구독 서비스' : `${c.months}달 반복`} · 매월 {c.day}일쯤</small></span><b>{won(c.amount)}</b>
              <button className="btn sm" onClick={() => add(null, { ...blank, name: c.name, amount: c.amount, day: c.day, cat: cats.includes(c.cat) ? c.cat : blank.cat, key: c.name })}>구독으로 등록</button></li>))}</ul>
            : <p className="muted">카드 내역을 가져오면 매달 반복되는 결제를 찾아 보여 줍니다.</p>}
        </section>
      </div>

      <section className="panel">
        <div className="csum-h"><h2>구독 목록</h2><span className="muted">{subs.length}개 · 사용 중 {active.length}개 · 금액 · 결제일을 바로 고칠 수 있습니다</span></div>
        {subs.length ? <div className="tablewrap"><table className="prog fv-table fs-table">
          <thead><tr><th>사용</th><th>서비스</th><th>주기 · 결제일</th><th>금액</th><th>월 환산</th><th>분류</th><th>찾을 글자</th><th /></tr></thead>
          <tbody>{[...subs].sort((a, b) => (b.active !== false) - (a.active !== false) || monthlyOf(b) - monthlyOf(a)).map(s => (
            <tr key={s.id} className={s.active === false ? 'off' : ''}>
              <td className="c"><input type="checkbox" checked={s.active !== false} onChange={e => patch(s.id, { active: e.target.checked })} aria-label={`${s.name} 사용 중`} /></td>
              <td><input value={s.name} onChange={e => patch(s.id, { name: e.target.value })} aria-label="서비스 이름" /></td>
              <td className="nw"><select value={s.cycle} onChange={e => patch(s.id, { cycle: e.target.value })} aria-label="주기"><option value="M">매월</option><option value="Y">매년</option></select>
                {s.cycle === 'Y' && <select value={s.month || 1} onChange={e => patch(s.id, { month: Number(e.target.value) })} aria-label="결제 월">{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}월</option>)}</select>}
                <select value={s.day} onChange={e => patch(s.id, { day: Number(e.target.value) })} aria-label="결제일">{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}일</option>)}</select></td>
              <td><MoneyInput value={s.amount} onChange={v => patch(s.id, { amount: Number(v) || 0 })} aria-label={`${s.name} 금액`} /></td>
              <td className="num">{won(monthlyOf(s))}</td>
              <td><select className="fv-cat" value={s.cat} onChange={e => patch(s.id, { cat: e.target.value })} aria-label="분류">{[...new Set([...cats, '구독', '기타', s.cat])].map(c => <option key={c}>{c}</option>)}</select></td>
              <td><input value={s.key || ''} onChange={e => patch(s.id, { key: e.target.value })} placeholder={s.name} aria-label="찾을 글자" /></td>
              <td><button className={`tl-del ${arm === s.id ? 'arm' : ''}`} onClick={() => del(s.id)}>{arm === s.id ? '정말 삭제?' : '삭제'}</button></td>
            </tr>))}
            <tr className="fs-sum"><td /><td>합계 (사용 중)</td><td /><td /><td className="num"><b>{won(monthly)}</b></td><td colSpan={3} className="muted">연 {won(yearly)}</td></tr>
          </tbody></table></div>
          : <p className="muted">아직 등록한 구독이 없습니다. 위에서 추가하거나 구독 후보에서 등록하세요.</p>}
      </section>

      <div className="fv-grid fv-grid2">
        <section className="panel">
          <div className="csum-h"><h2>{ymL(month)} 결제 확인</h2>
            <select value={month} onChange={e => setMonth(e.target.value)} aria-label="월 선택" className="fv-month">{months.map(m => <option key={m} value={m}>{m.replace('-', '년 ')}월</option>)}</select></div>
          {checks.length ? <ul className="fs-checks">{checks.map(c => (
            <li key={c.s.id} className={c.st}>
              <span className="fs-d">{Number(c.date.slice(5, 7))}/{Number(c.date.slice(8, 10))}</span>
              <span className="grow"><b>{c.s.name}</b> <small className="muted">{won(c.s.amount)}{c.st === 'paid' && c.sum !== Number(c.s.amount) ? ` · 실제 ${won(c.sum)}` : ''}</small></span>
              <span className={`fs-st ${c.st}`}>{c.st === 'soon' ? (c.d === 0 ? '오늘' : `D-${c.d}`) : ST[c.st]}</span>
            </li>))}</ul> : <p className="muted">이 달에 결제할 구독이 없습니다.</p>}
          <p className="note">결제됨 = 그 달 지출 내역(카드 가져오기)에 찾을 글자가 들어간 결제가 있음. 확인 안 됨이면 카드 내역을 가져왔는지, 찾을 글자가 맞는지 확인하세요.</p>
        </section>
        <section className="panel">
          <div className="hv-ch"><h2>분류별 월 고정비</h2></div>
          {byCat.length ? <ul className="fv-bars fv-cbars">{byCat.map(x => (
            <li key={x.c}><span className="fv-bl">{x.c}</span><span className="fv-track"><i style={{ width: `${x.v / maxCat * 100}%` }} /></span>
              <span className="fv-bv">{won(x.v)} <small>{monthly ? Math.round(x.v / monthly * 100) : 0}%</small></span></li>))}</ul> : <p className="muted">구독이 없습니다.</p>}
        </section>
      </div>
    </>
  );
}
