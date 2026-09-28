import React, { useState } from 'react';
import { AREAS, iso } from '../data.js';
import { ActionRow, areaVar, useCtx } from '../shared.jsx';
import {
  EMPTY, addItem, addMile, boardForYear, boardKey, daysBetween, delItem, delMile, flatten, progressOf, seedGoals, statusOf, toDate, updItem, updMile,
} from './goals.js';

/* 목표 관리 (연 단위 WBS + 마일스톤)
   - GoalBoard: 카테고리 하나의 목표 보드. 모든 카테고리 상세 페이지 아래에 붙는다
   - GoalView : '목표 관리' 카테고리 화면. 영역 전체 목표 현황 + 영역 공통 목표 보드 */
const md = s => { const d = toDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const clampPct = v => Math.max(0, Math.min(100, v));
const nextDay = s => { const d = toDate(s); d.setDate(d.getDate() + 1); return iso(d); };

/** 저장된 모든 목표 보드와 보드 하나를 고치는 함수 */
export function useGoals(area, cat) {
  const { store, setStore, now } = useCtx();
  const boards = (store.goals?.v === 2 ? store.goals : seedGoals(now)).boards;
  const key = boardKey(area, cat);
  const update = fn => setStore(s => {
    const cur = s.goals?.v === 2 ? s.goals : seedGoals(now);
    return { ...s, goals: { ...cur, boards: { ...cur.boards, [key]: fn(cur.boards[key] || EMPTY) } } };
  });
  return { boards, g: boards[key] || EMPTY, update };
}

export function YearPicker({ year, setYear }) {
  return (
    <div className="year-pick" role="group" aria-label="연도">
      <button className="btn sm" onClick={() => setYear(year - 1)} aria-label="이전 해">‹</button>
      <b>{year}년</b>
      <button className="btn sm" onClick={() => setYear(year + 1)} aria-label="다음 해">›</button>
    </div>
  );
}

export function GoalBoard({ area, cat, title = '목표 관리', year: yearProp, setYear: setYearProp }) {
  const { now } = useCtx();
  const today = iso(now);
  const [yearOwn, setYearOwn] = useState(now.getFullYear());
  const year = yearProp ?? yearOwn, setYear = setYearProp ?? setYearOwn;
  const { g: full, update } = useGoals(area, cat);
  const g = boardForYear(full, year);
  const [fold, setFold] = useState({});
  const [mform, setMform] = useState({ name: '', date: today, link: '' });

  const rows = flatten(g.items);
  const hidden = new Set();
  rows.forEach(r => { if (r.item.parent && (hidden.has(r.item.parent) || fold[r.item.parent])) hidden.add(r.item.id); });
  const shown = rows.filter(r => !hidden.has(r.item.id));

  // 요약
  const roots = rows.filter(r => r.level === 0);
  const leaves = rows.filter(r => !r.hasKids);
  let w = 0, sum = 0;
  roots.forEach(r => { const d = Math.max(1, daysBetween(r.item.start, r.item.end) + 1); w += d; sum += d * progressOf(g.items, r.item.id); });
  const overall = w ? Math.round(sum / w) : 0;
  const late = leaves.filter(r => statusOf(r.item, progressOf(g.items, r.item.id), today).k === 'late');
  const nextMile = [...g.miles].filter(m => !m.done && m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];

  // 일정 막대: 그 해 1월 1일 ~ 12월 31일
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`, span = daysBetween(y0, y1) + 1;
  const pct = s => clampPct((daysBetween(y0, s) / span) * 100);
  const pos = s => `${pct(s)}%`;
  const showToday = today >= y0 && today <= y1;
  const mDate = mform.date >= y0 && mform.date <= y1 ? mform.date : (showToday ? today : `${year}-06-30`);

  const setDate = (it, k, v) => {
    if (!v) return;
    const patch = { [k]: v };
    if (k === 'start' && v > it.end) patch.end = v;
    if (k === 'end' && v < it.start) patch.start = v;
    update(x => updItem(x, it.id, patch));
  };
  const addM = e => {
    e.preventDefault();
    if (!mform.name.trim()) return;
    update(x => addMile(x, { name: mform.name.trim(), date: mDate, link: mform.link || null }));
    setMform({ ...mform, name: '' });
  };

  return (
    <section className="goalb" style={{ '--ac': areaVar(area) }} aria-label={`${cat} ${title}`}>
      <div className="goalb-h">
        <h2>{title}</h2>
        <span className="muted">{year}년 · 목표 {roots.length} · 작업 {leaves.length} · 진행률 {overall}%{late.length ? ` · 지연 ${late.length}` : ''}
          {nextMile ? ` · 다음 마일스톤 ${nextMile.name} (D-${daysBetween(today, nextMile.date)})` : ''}</span>
        {!yearProp && <YearPicker year={year} setYear={setYear} />}
      </div>

      <div className="panel">
        <div className="csum-h"><h2>WBS</h2><span className="muted">목표 › 단계 › 작업 · 칸을 눌러 바로 고칠 수 있습니다</span>
          <button className="btn sm primary" onClick={() => update(x => addItem(x, null, today, year))}>+ 목표 추가</button></div>
        {g.items.length > 0 ? (
          <div className="tablewrap">
            <table className="wbs">
              <thead>
                <tr><th className="c-code">WBS</th><th className="c-name">항목</th><th>시작</th><th>종료</th><th className="c-prog">진행률</th><th>상태</th><th /></tr>
              </thead>
              <tbody>
                {shown.map(({ item: it, level, code, hasKids }) => {
                  const p = progressOf(g.items, it.id), st = statusOf(it, p, today);
                  const l = pct(it.start), r = pct(nextDay(it.end));
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
                      <td className="c-act">
                        {level < 2 && <button className="btn sm" onClick={() => { update(x => addItem(x, it.id, today, year)); setFold({ ...fold, [it.id]: false }); }}>+ 하위</button>}
                        <button className="tl-del" onClick={() => update(x => delItem(x, it.id))} aria-label={`${code} 삭제`}>삭제</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted goalb-empty">{year}년 목표가 없습니다. "+ 목표 추가"로 시작하세요.</p>}
      </div>

      {g.items.length > 0 && (
        <div className="panel">
          <div className="csum-h"><h2>연간 일정표</h2><span className="muted">{year}년 1월 ~ 12월</span></div>
          <div className="tablewrap">
            <div className="gantt">
              <div className="gantt-row gantt-head">
                <span className="gantt-label" />
                <div className="gantt-track">
                  {Array.from({ length: 12 }, (_, m) => {
                    const s0 = `${year}-${String(m + 1).padStart(2, '0')}-01`;
                    return <span key={m} className="gantt-month" style={{ left: pos(s0) }}>{m + 1}월</span>;
                  })}
                  {showToday && <i className="tl-today" style={{ left: pos(today) }} title={`오늘 ${md(today)}`} />}
                </div>
              </div>
              {shown.map(({ item: it, level, code }) => {
                const p = progressOf(g.items, it.id), st = statusOf(it, p, today);
                const l = pct(it.start), r = pct(nextDay(it.end));
                return (
                  <div key={it.id} className={`gantt-row lv${Math.min(level, 2)}`}>
                    <span className="gantt-label" style={{ paddingLeft: level * 14 }}><em>{code}</em> {it.name}</span>
                    <div className="gantt-track">
                      {Array.from({ length: 12 }, (_, m) => <i key={m} className="gantt-grid" style={{ left: pos(`${year}-${String(m + 1).padStart(2, '0')}-01`) }} />)}
                      {showToday && <i className="tl-today" style={{ left: pos(today) }} />}
                      {r > l && <span className={`gbar ${st.k}`} style={{ left: `${l}%`, width: `${r - l}%` }} title={`${it.name} · ${md(it.start)} ~ ${md(it.end)} · ${p}%`}>
                        <i style={{ width: `${p}%` }} /></span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="note">진한 부분이 진행률, 빨간 세로선은 오늘입니다.</p>
        </div>
      )}

      <div className="panel">
        <div className="csum-h"><h2>마일스톤</h2><span className="muted">{year}년 · {g.miles.filter(m => m.done).length}/{g.miles.length} 완료</span></div>
        {g.miles.length > 0 && (
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
        )}
        <form className="anniv-add" onSubmit={addM}>
          <input value={mform.name} onChange={e => setMform({ ...mform, name: e.target.value })} placeholder="마일스톤 이름 (예: 상반기 점검)" aria-label="새 마일스톤 이름" />
          <input type="date" value={mDate} min={y0} max={y1} onChange={e => setMform({ ...mform, date: e.target.value })} aria-label="새 마일스톤 날짜" />
          <select value={mform.link} onChange={e => setMform({ ...mform, link: e.target.value })} aria-label="새 마일스톤 연결 항목">
            <option value="">연결 안 함</option>{rows.map(r => <option key={r.item.id} value={r.item.id}>{r.code} {r.item.name}</option>)}</select>
          <button className="btn primary" disabled={!mform.name.trim()}>추가</button>
        </form>
      </div>
    </section>
  );
}

/* '목표 관리' 카테고리 화면: 영역 전체 목표 현황 + 영역 공통 목표 */
export default function GoalView({ area, cat, group }) {
  const { now, isDone, openCat } = useCtx();
  const today = iso(now);
  const [year, setYear] = useState(now.getFullYear());
  const { boards } = useGoals(area, cat);

  // 영역의 모든 카테고리 보드에서 그 해의 최상위 목표를 모은다
  const all = Object.entries(boards).filter(([k]) => k.startsWith(`${area}|`)).flatMap(([k, b]) => {
    const c = k.slice(2), yb = boardForYear(b, year);
    return yb.items.filter(i => !i.parent).map(it => {
      const p = progressOf(yb.items, it.id);
      const ms = yb.miles.filter(m => !m.done && m.date >= today).sort((a, b2) => a.date.localeCompare(b2.date));
      return { c, it, p, st: statusOf(it, p, today), next: ms[0] };
    });
  }).sort((a, b) => a.it.end.localeCompare(b.it.end));
  const avg = all.length ? Math.round(all.reduce((a, x) => a + x.p, 0) / all.length) : 0;
  const cats = new Set(all.map(x => x.c));
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv gv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 카테고리마다 세운 {year}년 목표를 한눈에 봅니다. 각 카테고리 상세 페이지 아래에서도 목표를 관리할 수 있습니다.</p>
      </header>

      <div className="bar"><YearPicker year={year} setYear={setYear} /></div>

      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">{year}년 목표</span><b>{all.length}</b><span className="hv-sub">{cats.size}개 카테고리</span></div>
        <div className="hv-stat sl"><span className="muted">평균 진행률</span><b>{avg}%</b><span className="pbar"><i style={{ width: `${avg}%`, background: 'var(--ac)' }} /></span></div>
        <div className="hv-stat sl"><span className="muted">완료 목표</span><b>{all.filter(x => x.p >= 100).length}</b><span className="hv-sub">지연 {all.filter(x => x.st.k === 'late').length}</span></div>
      </div>

      <section className="panel">
        <div className="csum-h"><h2>카테고리별 목표 현황</h2><span className="muted">{year}년 · 종료일 순</span></div>
        {all.length ? (
          <div className="tablewrap"><table className="prog goal-ov">
            <thead><tr><th>카테고리</th><th>목표</th><th>기간</th><th>진행률</th><th>상태</th><th>다음 마일스톤</th></tr></thead>
            <tbody>{all.map(x => (
              <tr key={x.it.id}>
                <td><button className="linkish" onClick={() => openCat(area, x.c)}>{x.c}</button></td>
                <td className="goal-ov-n">{x.it.name}</td>
                <td className="nowrap">{md(x.it.start)} ~ {md(x.it.end)}</td>
                <td><div className="goal-ov-p"><span className="pbar"><i style={{ width: `${x.p}%`, background: 'var(--ac)' }} /></span><b>{x.p}%</b></div></td>
                <td><span className={`st ${x.st.k}`}>{x.st.t}</span></td>
                <td className="nowrap">{x.next ? `${x.next.name} · D-${daysBetween(today, x.next.date)}` : '-'}</td>
              </tr>))}</tbody>
          </table></div>
        ) : <p className="muted">{year}년에 세운 목표가 없습니다.</p>}
      </section>

      <GoalBoard area={area} cat={cat} title="영역 공통 목표" year={year} setYear={setYear} />

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
