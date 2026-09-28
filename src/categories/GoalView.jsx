import React, { useState } from 'react';
import { AREAS, iso } from '../data.js';
import { ActionRow, WEEK, areaVar, useCtx } from '../shared.jsx';
import {
  addDays, addItem, addMile, daysBetween, delItem, delMile, flatten, progressOf, seedGoals, statusOf, toDate, updItem, updMile,
} from './goals.js';

/* 목표 관리 전용 화면 (개인·사업·근로 공통): WBS 표 + 일정 막대 + 마일스톤 */
const md = s => { const d = toDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mdw = s => { const d = toDate(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };

export default function GoalView({ area, cat, group }) {
  const { store, setStore, now, isDone } = useCtx();
  const today = iso(now);
  const all = store.goals || seedGoals(now);
  const g = all[area] || { items: [], miles: [] };
  const update = fn => setStore(s => { const cur = s.goals || seedGoals(now); return { ...s, goals: { ...cur, [area]: fn(cur[area] || { items: [], miles: [] }) } }; });
  const [fold, setFold] = useState({});             // 접힌 항목 id
  const [mform, setMform] = useState({ name: '', date: addDays(today, 14), link: '' });

  const rows = flatten(g.items);
  const hidden = new Set();
  rows.forEach(r => { if (r.item.parent && (hidden.has(r.item.parent) || fold[r.item.parent])) hidden.add(r.item.id); });
  const shown = rows.filter(r => !hidden.has(r.item.id));
  const codeOf = Object.fromEntries(rows.map(r => [r.item.id, r.code]));

  // 요약
  const roots = rows.filter(r => r.level === 0);
  const leaves = rows.filter(r => !r.hasKids);
  let w = 0, sum = 0;
  roots.forEach(r => { const d = Math.max(1, daysBetween(r.item.start, r.item.end) + 1); w += d; sum += d * progressOf(g.items, r.item.id); });
  const overall = w ? Math.round(sum / w) : 0;
  const late = leaves.filter(r => statusOf(r.item, progressOf(g.items, r.item.id), today).k === 'late');
  const nextMile = [...g.miles].filter(m => !m.done && m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];

  // 일정 막대 범위: 모든 작업·마일스톤을 덮고 앞뒤로 3일 여유
  const dates = [...g.items.flatMap(i => [i.start, i.end]), ...g.miles.map(m => m.date), today].sort();
  const r0 = addDays(dates[0], -3), r1 = addDays(dates[dates.length - 1], 3);
  const span = Math.max(1, daysBetween(r0, r1));
  const pos = s => `${(daysBetween(r0, s) / span) * 100}%`;
  const months = [];
  for (let d = toDate(r0); d <= toDate(r1); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const k = iso(new Date(d.getFullYear(), d.getMonth(), 1));
    if (k >= r0) months.push(k);
  }
  const milesOf = id => g.miles.filter(m => m.link === id);
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  const setDate = (it, k, v) => {
    if (!v) return;
    const patch = { [k]: v };
    if (k === 'start' && v > it.end) patch.end = v;
    if (k === 'end' && v < it.start) patch.start = v;
    update(x => updItem(x, it.id, patch));
  };
  const addM = e => {
    e.preventDefault();
    if (!mform.name.trim() || !mform.date) return;
    update(x => addMile(x, { name: mform.name.trim(), date: mform.date, link: mform.link || null }));
    setMform({ ...mform, name: '' });
  };

  return (
    <div className="catv gv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 목표를 단계와 작업으로 나눈 WBS와 마일스톤으로 관리합니다. 상위 항목 진행률은 하위 작업에서 자동 계산됩니다.</p>
      </header>

      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">전체 진행률</span><b>{overall}%</b>
          <span className="pbar"><i style={{ width: `${overall}%`, background: 'var(--ac)' }} /></span></div>
        <div className="hv-stat sl"><span className="muted">목표 · 작업</span><b>{roots.length} · {leaves.length}</b>
          <span className="hv-sub">완료 작업 {leaves.filter(r => progressOf(g.items, r.item.id) >= 100).length}개</span></div>
        <div className={`hv-stat ${late.length ? 'over' : 'sl'}`}><span className="muted">지연 작업</span><b>{late.length}</b>
          <span className="hv-sub">{late.length ? late.slice(0, 2).map(r => r.item.name).join(', ') : '없음'}</span></div>
        <div className="hv-stat ex"><span className="muted">다음 마일스톤</span><b>{nextMile ? (nextMile.date === today ? '오늘' : `D-${daysBetween(today, nextMile.date)}`) : '-'}</b>
          <span className="hv-sub">{nextMile ? `${nextMile.name} · ${mdw(nextMile.date)}` : '예정된 마일스톤 없음'}</span></div>
      </div>

      <section className="panel">
        <div className="csum-h"><h2>WBS</h2><span className="muted">목표 › 단계 › 작업 · 칸을 눌러 바로 고칠 수 있습니다</span>
          <button className="btn sm primary" onClick={() => update(x => addItem(x, null, today))}>+ 목표 추가</button></div>
        <div className="tablewrap">
          <table className="wbs">
            <thead>
              <tr><th className="c-code">WBS</th><th className="c-name">항목</th><th>시작</th><th>종료</th><th className="c-prog">진행률</th><th>상태</th>
                <th className="c-tl">
                  <div className="tl-scale">{months.map(m => <span key={m} style={{ left: pos(m) }}>{toDate(m).getMonth() + 1}월</span>)}
                    <i className="tl-today" style={{ left: pos(today) }} title={`오늘 ${md(today)}`} /></div>
                </th><th /></tr>
            </thead>
            <tbody>
              {shown.map(({ item: it, level, code, hasKids }) => {
                const p = progressOf(g.items, it.id), st = statusOf(it, p, today);
                return (
                  <tr key={it.id} className={`lv${Math.min(level, 2)}`}>
                    <td className="c-code">{code}</td>
                    <td className="c-name">
                      <div className="wbs-name" style={{ paddingLeft: level * 18 }}>
                        {hasKids ? <button className="fold" onClick={() => setFold({ ...fold, [it.id]: !fold[it.id] })} aria-label={fold[it.id] ? '펼치기' : '접기'}>{fold[it.id] ? '▸' : '▾'}</button> : <span className="fold" />}
                        <input value={it.name} onChange={e => update(x => updItem(x, it.id, { name: e.target.value }))} aria-label={`${code} 이름`} />
                      </div>
                    </td>
                    <td><input type="date" value={it.start} onChange={e => setDate(it, 'start', e.target.value)} aria-label={`${code} 시작일`} /></td>
                    <td><input type="date" value={it.end} onChange={e => setDate(it, 'end', e.target.value)} aria-label={`${code} 종료일`} /></td>
                    <td className="c-prog">{hasKids ? <b>{p}%</b> : (
                      <select value={p} onChange={e => update(x => updItem(x, it.id, { progress: Number(e.target.value) }))} aria-label={`${code} 진행률`}>
                        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(v => <option key={v} value={v}>{v}%</option>)}</select>)}</td>
                    <td><span className={`st ${st.k}`}>{st.t}</span></td>
                    <td className="c-tl"><div className="tl-cell">
                      <i className="tl-today" style={{ left: pos(today) }} />
                      <span className={`gbar ${st.k}`} style={{ left: pos(it.start), width: `calc(${pos(addDays(it.end, 1))} - ${pos(it.start)})` }} title={`${it.name} · ${md(it.start)} ~ ${md(it.end)} · ${p}%`}>
                        <i style={{ width: `${p}%` }} /></span>
                      {milesOf(it.id).map(m => <span key={m.id} className={`mile ${m.done ? 'done' : m.date < today ? 'late' : ''}`} style={{ left: pos(m.date) }} title={`${m.name} · ${mdw(m.date)}`} />)}
                    </div></td>
                    <td className="c-act">
                      {level < 2 && <button className="btn sm" onClick={() => { update(x => addItem(x, it.id, today)); setFold({ ...fold, [it.id]: false }); }}>+ 하위</button>}
                      <button className="tl-del" onClick={() => update(x => delItem(x, it.id))} aria-label={`${code} 삭제`}>삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {g.items.length === 0 && <p className="muted">목표가 없습니다. "+ 목표 추가"로 시작하세요.</p>}
        <p className="note">막대의 진한 부분이 진행률입니다. 세로선은 오늘, 마름모는 연결된 마일스톤입니다(빨강: 지남, 초록: 완료).</p>
      </section>

      <section className="panel">
        <div className="csum-h"><h2>마일스톤</h2><span className="muted">중요한 시점 · {g.miles.filter(m => m.done).length}/{g.miles.length} 완료</span></div>
        <div className="tablewrap">
          <table className="prog mile-tb">
            <thead><tr><th>완료</th><th>날짜</th><th>남은 날</th><th>마일스톤</th><th>연결 항목</th><th /></tr></thead>
            <tbody>{[...g.miles].sort((a, b) => a.date.localeCompare(b.date)).map(m => {
              const dd = daysBetween(today, m.date);
              return (
                <tr key={m.id} className={m.done ? 'is-done' : ''}>
                  <td><input type="checkbox" checked={m.done} onChange={e => update(x => updMile(x, m.id, { done: e.target.checked }))} aria-label={`${m.name} 완료`} /></td>
                  <td><input type="date" value={m.date} onChange={e => e.target.value && update(x => updMile(x, m.id, { date: e.target.value }))} aria-label={`${m.name} 날짜`} /></td>
                  <td className={`nowrap ${!m.done && dd < 0 ? 'late-t' : ''}`}>{m.done ? '완료' : dd === 0 ? '오늘' : dd > 0 ? `D-${dd}` : `${-dd}일 지남`}</td>
                  <td><input value={m.name} onChange={e => update(x => updMile(x, m.id, { name: e.target.value }))} aria-label="마일스톤 이름" /></td>
                  <td><select value={m.link || ''} onChange={e => update(x => updMile(x, m.id, { link: e.target.value || null }))} aria-label="연결 항목">
                    <option value="">연결 안 함</option>{rows.map(r => <option key={r.item.id} value={r.item.id}>{r.code} {r.item.name}</option>)}</select></td>
                  <td><button className="tl-del" onClick={() => update(x => delMile(x, m.id))}>삭제</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <form className="anniv-add" onSubmit={addM}>
          <input value={mform.name} onChange={e => setMform({ ...mform, name: e.target.value })} placeholder="마일스톤 이름 (예: 1차 결과 보고)" aria-label="새 마일스톤 이름" />
          <input type="date" value={mform.date} onChange={e => setMform({ ...mform, date: e.target.value })} aria-label="새 마일스톤 날짜" />
          <select value={mform.link} onChange={e => setMform({ ...mform, link: e.target.value })} aria-label="새 마일스톤 연결 항목">
            <option value="">연결 안 함</option>{rows.map(r => <option key={r.item.id} value={r.item.id}>{codeOf[r.item.id]} {r.item.name}</option>)}</select>
          <button className="btn primary" disabled={!mform.name.trim()}>추가</button>
        </form>
      </section>

      <h2 className="hv-sec">목표 관리 체크 항목</h2>
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
