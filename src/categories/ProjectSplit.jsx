import React, { useState } from 'react';
import { won } from './finance.js';

/* 연계 프로젝트 비용 분담: 누구누구 몇 명이, 각자 몇 % 씩 낼지
   project.split = { members: [{ name, pct, me? }], custom }   (me: 나, custom: 비율을 직접 고쳤는지)
   - 사람을 넣고 빼면 custom 이 아니면 균등(N분의 1)으로 다시 나눔
   - 비율 합이 100% 가 아니어도 금액은 비율대로 나눠 합계와 맞춘다 (화면에 "합계 n%" 경고)
   - 1원 단위 나머지는 나(있으면) 또는 첫 사람이 부담
   예전 형식 { people: ['김민수'], me: true } 도 읽는다 */
export function membersOf(p) {
  const sp = p?.split || {};
  if (Array.isArray(sp.members)) return sp.members;
  const names = [...(sp.me !== false ? [{ name: '나', me: true }] : []), ...(sp.people || []).map(name => ({ name }))];
  return names.length > 1 || (names.length === 1 && !names[0].me) ? equalize(names) : [];
}
const r2 = v => Math.round(v * 100) / 100;
/** 균등 분배: 100 을 n 으로 나누고, 소수 끝자리 차이는 마지막 사람에게 */
export function equalize(members) {
  const n = members.length;
  if (!n) return [];
  const base = r2(100 / n);
  return members.map((m, i) => ({ ...m, pct: i === n - 1 ? r2(100 - base * (n - 1)) : base }));
}
export const pctSum = members => r2(members.reduce((a, m) => a + (Number(m.pct) || 0), 0));

/** 금액 나누기 → { n, rows: [{ name, me, pct, amount }], receive(다른 사람이 나에게 보낼 합), mine, total(비율 합) } | null(본인 부담) */
export function settle(sum, members, equal = false) {
  if (!members.length || (members.length === 1 && members[0].me)) return null;
  const total = pctSum(members);
  if (!equal && total <= 0) return null;
  // 균등이면 정확히 N분의 1 (33.33% 같은 반올림 차이 없이)
  const rows = members.map(m => ({ ...m, pct: Number(m.pct) || 0, amount: Math.floor(equal ? sum / members.length : sum * (Number(m.pct) || 0) / total) }));
  const rest = sum - rows.reduce((a, r) => a + r.amount, 0);
  const to = rows.find(r => r.me) || rows[0];
  to.amount += rest;
  return { n: rows.length, rows, rest, restTo: rest ? to.name : '', total: equal ? 100 : total, mine: rows.filter(r => r.me).reduce((a, r) => a + r.amount, 0), receive: rows.filter(r => !r.me).reduce((a, r) => a + r.amount, 0) };
}
/** 프로젝트의 분담 계산 (비율을 직접 고치지 않았으면 균등) */
export const settleProject = (p, sum) => settle(sum, membersOf(p), !p?.split?.custom);
export const splitLabel = members => (members.length ? members.map(m => `${m.name} ${m.pct}%`).join(', ') : '본인 부담');

/** 연계 프로젝트 화면의 분담 입력 */
export function SplitEditor({ p, sum = 0, names = [], onChange }) {
  const members = membersOf(p);
  const custom = !!p?.split?.custom;
  const [v, setV] = useState('');
  const save = (list, isCustom = custom) => onChange({ members: list, custom: isCustom && list.length > 0 });
  const withMe = members.some(m => m.me);
  const add = () => {
    const have = new Set(members.map(m => m.name));
    const list = v.split(/[,，]/).map(x => x.trim()).filter(x => x && x !== '나' && !have.has(x));
    setV('');
    if (!list.length) return;
    let next = [...members, ...list.map(name => ({ name, pct: 0 }))];
    if (!withMe && !members.length) next = [{ name: '나', me: true, pct: 0 }, ...next];   // 처음 넣을 때는 나도 포함
    save(custom ? next : equalize(next));
  };
  const remove = name => { const next = members.filter(m => m.name !== name); save(next.length === 1 && next[0].me ? [] : custom ? next : equalize(next)); };
  const toggleMe = on => {
    const next = on ? [{ name: '나', me: true, pct: 0 }, ...members] : members.filter(m => !m.me);
    save(next.length === 1 && next[0].me ? [] : custom ? next : equalize(next));
  };
  const setPct = (name, val) => save(members.map(m => (m.name === name ? { ...m, pct: val === '' ? '' : Math.max(0, Math.min(100, Number(val))) } : m)), true);
  const st = settle(sum, members, !custom);
  const total = pctSum(members);
  return (
    <div className="ps">
      <div className="ps-h">
        <b>비용 분담</b>
        <span className="ps-n">{members.length ? `${members.length}명 분할${custom ? ' · 비율 조정' : ' · 균등'}` : '본인 부담'}</span>
        <label className="ps-me"><input type="checkbox" checked={withMe || !members.length} disabled={!members.length} onChange={e => toggleMe(e.target.checked)} />나 포함</label>
        {members.length > 0 && custom && <button type="button" className="btn sm" onClick={() => save(equalize(members), false)}>균등 분배</button>}
      </div>
      {members.length > 0 && <ul className="ps-list">{members.map(m => {
        const row = st?.rows.find(r => r.name === m.name);
        return (
          <li key={m.name}>
            <span className="ps-name">{m.name}</span>
            <span className="ps-pct"><input type="number" min="0" max="100" step="0.1" inputMode="decimal" value={m.pct} onChange={e => setPct(m.name, e.target.value)} aria-label={`${m.name} 비율`} />%</span>
            <span className="ps-amt">{row ? won(row.amount) : '-'}</span>
            <span className="ps-role muted">{m.me ? '본인 부담' : '나에게 보낼 금액'}</span>
            <button type="button" className="ps-x" aria-label={`${m.name} 빼기`} onClick={() => remove(m.name)}>×</button>
          </li>);
      })}</ul>}
      {members.length > 0 && total !== 100 && <p className="ps-warn" role="alert">비율 합계 {total}% — 100%가 되도록 조정하세요 (지금은 비율대로 나눠 계산)</p>}
      <div className="ps-add">
        <input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          list={`ps-people-${p.id}`} placeholder="함께 나눌 사람 (쉼표로 여러 명)" aria-label={`${p.name} 함께 나눌 사람`} />
        <datalist id={`ps-people-${p.id}`}>{names.map(n => <option key={n} value={n} />)}</datalist>
        <button type="button" className="btn sm" onClick={add}>추가</button>
        {st && <span className="ps-sum">받을 금액 <b>{won(st.receive)}</b>{withMe ? ` · 내 부담 ${won(st.mine)}` : ''}</span>}
      </div>
    </div>
  );
}
