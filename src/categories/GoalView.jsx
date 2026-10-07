import React, { useState } from 'react';
import GoalOnboard, { goalOnboardNeed } from './GoalOnboard.jsx';
import GoalCrud from './GoalCrud.jsx';
import { AREAS, CATS, ROWS, iso, periodKeysBetween } from '../data.js';
import { areaVar, useCtx } from '../shared.jsx';
import {
  EMPTY, NO_GOAL, hasGoals, addItem, addMile, boardForYear, boardKey, checkProgress, daysBetween, deadlineOf, delItem, delMile, flatten, seedGoals, toDate, updItem, updMile,
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

/** 보드가 따라가는 체크 항목: 카테고리 보드는 그 카테고리, '목표 관리'(영역 공통) 보드는 영역 전체 */
const checkRowsOf = (area, cat) => ROWS.filter(r => r.a === area && (cat === '목표 관리' || r.cat === cat));
/** 작업 진행률을 체크리스트 기록으로 계산하는 함수 (월간 점검 등 내부 계산용, 화면에는 진행률 대신 마감 · D-day) */
export const leafFor = (area, cat, done) => checkProgress(checkRowsOf(area, cat), done || {}, periodKeysBetween);
/** 마일스톤 완료 = 직접 체크했거나 연결된 목표 · 작업을 완료로 체크 */
const withDone = (miles, items) => miles.map(m => ({ ...m, done: !!m.done || (!!m.link && !!items.find(i => i.id === m.link)?.done) }));
/** 마감 D-day 표시 (상태 색) */
export const DDay = ({ it, today }) => { const s = deadlineOf(it, today); return <span className={`dd ${s.k}`} title={`마감 ${it.end} · ${s.t}`}>{s.dd}</span>; };
/** 아직 안 끝난 것 중 가장 가까운 마감 */
const nearest = (items, today) => items.filter(i => !i.done).sort((a, b) => a.end.localeCompare(b.end)).find(i => i.end >= today) || null;

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
  const { now, store } = useCtx();
  const today = iso(now);
  const [yearOwn, setYearOwn] = useState(now.getFullYear());
  const year = yearProp ?? yearOwn, setYear = setYearProp ?? setYearOwn;
  const { g: full, update } = useGoals(area, cat);
  const yb = boardForYear(full, year);
  const g = { ...yb, miles: withDone(yb.miles, full.items) };
  const [fold, setFold] = useState({});
  const [mform, setMform] = useState({ name: '', date: today, link: '' });

  const rows = flatten(g.items);
  const hidden = new Set();
  rows.forEach(r => { if (r.item.parent && (hidden.has(r.item.parent) || fold[r.item.parent])) hidden.add(r.item.id); });
  const shown = rows.filter(r => !hidden.has(r.item.id));

  // 요약
  const roots = rows.filter(r => r.level === 0);
  const leaves = rows.filter(r => !r.hasKids);
  const late = rows.filter(r => deadlineOf(r.item, today).k === 'late');
  const near = nearest(roots.map(r => r.item), today);
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
        <span className="muted">{year}년 · 목표 {roots.length} · 작업 {leaves.length}{near ? ` · 가장 가까운 마감 ${near.name} (${deadlineOf(near, today).dd})` : ''}{late.length ? ` · 마감 지남 ${late.length}` : ''}
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
                <tr><th className="c-code">WBS</th><th className="c-name">항목</th><th className="c-mid">시작</th><th className="c-mid">마감</th><th className="c-mid">D-day</th><th className="c-mid">완료</th><th className="c-mid">상태</th><th /></tr>
              </thead>
              <tbody>
                {shown.map(({ item: it, level, code, hasKids }) => {
                  const st = deadlineOf(it, today);
                  return (
                    <tr key={it.id} className={`lv${Math.min(level, 2)}`}>
                      <td className="c-code">{code}</td>
                      <td className="c-name">
                        <div className="wbs-name" style={{ paddingLeft: level * 18 }}>
                          {hasKids ? <button className="fold" onClick={() => setFold({ ...fold, [it.id]: !fold[it.id] })} aria-label={fold[it.id] ? '펼치기' : '접기'}>{fold[it.id] ? '▸' : '▾'}</button> : <span className="fold" />}
                          <input value={it.name} onChange={e => update(x => updItem(x, it.id, { name: e.target.value }))} aria-label={`${code} 이름`} />
                        </div>
                      </td>
                      <td className="c-mid"><input type="date" value={it.start} onChange={e => setDate(it, 'start', e.target.value)} aria-label={`${code} 시작일`} /></td>
                      <td className="c-mid"><input type="date" value={it.end} onChange={e => setDate(it, 'end', e.target.value)} aria-label={`${code} 마감일`} /></td>
                      <td className="c-mid"><DDay it={it} today={today} /></td>
                      <td className="c-mid"><input type="checkbox" className="g-done" checked={!!it.done} onChange={e => update(x => updItem(x, it.id, { done: e.target.checked }))} aria-label={`${code} 완료`} /></td>
                      <td className="c-mid"><span className={`st ${st.k}`}>{st.t}</span></td>
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
                const st = deadlineOf(it, today);
                const l = pct(it.start), r = pct(nextDay(it.end));
                return (
                  <div key={it.id} className={`gantt-row lv${Math.min(level, 2)}`}>
                    <span className="gantt-label" style={{ paddingLeft: level * 14 }}><em>{code}</em> {it.name} <DDay it={it} today={today} /></span>
                    <div className="gantt-track">
                      {Array.from({ length: 12 }, (_, m) => <i key={m} className="gantt-grid" style={{ left: pos(`${year}-${String(m + 1).padStart(2, '0')}-01`) }} />)}
                      {showToday && <i className="tl-today" style={{ left: pos(today) }} />}
                      {r > l && <span className={`gbar dl ${st.k}`} style={{ left: `${l}%`, width: `${r - l}%` }} title={`${it.name} · ${md(it.start)} ~ 마감 ${md(it.end)} · ${st.dd}`} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="note">막대 오른쪽 끝(진한 선)이 마감, 빨간 세로선은 오늘입니다. 완료한 것은 진하게 칠해집니다.</p>
        </div>
      )}

      <div className="panel">
        <div className="csum-h"><h2>마일스톤</h2><span className="muted">{year}년 · {g.miles.filter(m => m.done).length}/{g.miles.length} 완료 · 직접 체크하거나 연결 항목을 완료하면 완료</span></div>
        {g.miles.length > 0 && (
          <div className="tablewrap">
            <table className="prog mile-tb">
              <thead><tr><th>완료</th><th>날짜</th><th>D-day</th><th>마일스톤</th><th>연결 항목</th><th /></tr></thead>
              <tbody>{[...g.miles].sort((a, b) => a.date.localeCompare(b.date)).map(m => {
                const dd = daysBetween(today, m.date);
                return (
                  <tr key={m.id} className={m.done ? 'is-done' : ''}>
                    <td><input type="checkbox" className="g-done" checked={!!m.done} onChange={e => update(x => updMile(x, m.id, { done: e.target.checked }))} aria-label={`${m.name} 완료`} /></td>
                    <td><input type="date" value={m.date} onChange={e => e.target.value && update(x => updMile(x, m.id, { date: e.target.value }))} aria-label={`${m.name} 날짜`} /></td>
                    <td className={`nowrap ${!m.done && dd < 0 ? 'late-t' : ''}`}>{m.done ? '완료' : dd === 0 ? 'D-day' : dd > 0 ? `D-${dd}` : `D+${-dd}`}</td>
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

/* '목표 관리' 카테고리 화면: 영역의 모든 카테고리 목표를 모아서 본다 (통합 WBS · 연간 일정표 · 마일스톤) + 영역 공통 목표 */
export default function GoalView({ area, cat, group }) {
  const { now, openCat, store } = useCtx();
  const today = iso(now);
  const [year, setYear] = useState(now.getFullYear());
  // 온보딩 팝업: 처음이면 목표 설정부터, 매월 1일부터는 이번 달 점검 (닫으면 다시 들어올 때 또 뜸, "건너뛰기"를 누르면 그달은 안 뜸)
  const need = goalOnboardNeed(store, area, today);
  const [onb, setOnb] = useState(need);
  const [onbMsg, setOnbMsg] = useState('');
  const [tasks, setTasks] = useState(false);        // 작업(3단계)까지 펼치기
  const [fold, setFold] = useState({});             // 접은 카테고리
  const { boards } = useGoals(area, cat);

  // 카테고리 순서: 영역 공통(목표 관리) → 데이터 순서. 숨긴 카테고리는 뺀다
  const order = ['목표 관리', ...new Set(CATS.filter(r => r.a === area && r.cat !== '목표 관리').map(r => r.cat))];
  const groups = order.map((c, ci) => {
    const b = boards[boardKey(area, c)];
    if (!b || !hasGoals(area, c)) return null;
    const yb0 = boardForYear(b, year), yb = { ...yb0, miles: withDone(yb0.miles, b.items) };
    const rows = flatten(yb.items);
    const roots = rows.filter(r => r.level === 0);
    if (!roots.length && !yb.miles.length) return null;
    const starts = roots.map(r => r.item.start).sort(), ends = roots.map(r => r.item.end).sort();
    return { c, key: boardKey(area, c), yb, rows, roots, near: nearest(roots.map(r => r.item), today), start: starts[0], end: ends[ends.length - 1] };
  }).filter(Boolean).map((g, i) => ({ ...g, n: i + 1 }));

  // 목표 마감 D-day: 안 끝난 것 → 마감 가까운 순, 완료는 뒤로
  const allRoots = groups.flatMap(g => g.roots.map(r => ({ g, r, st: deadlineOf(r.item, today) })))
    .sort((a, b) => (a.st.k === 'done') - (b.st.k === 'done') || a.r.item.end.localeCompare(b.r.item.end));
  const openN = allRoots.filter(x => x.st.k !== 'done').length, lateN = allRoots.filter(x => x.st.k === 'late').length;
  const near = allRoots.find(x => x.st.k !== 'done' && x.st.d >= 0);
  const miles = groups.flatMap(g => g.yb.miles.map(m => ({ g, m, link: g.rows.find(r => r.item.id === m.link) }))).sort((a, b) => a.m.date.localeCompare(b.m.date));
  const nextMile = miles.find(x => !x.m.done && x.m.date >= today);
  const mm = today.slice(5, 7), monthKey = `${year}-${mm}`;
  const monthMiles = miles.filter(x => x.m.date.slice(0, 7) === monthKey);
  const soonMiles = miles.filter(x => !x.m.done && x.m.date.slice(0, 7) !== monthKey && x.m.date > today && daysBetween(today, x.m.date) <= 30);

  // 연간 일정표 위치
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`, span = daysBetween(y0, y1) + 1;
  const pct = d => clampPct((daysBetween(y0, d) / span) * 100);
  const showToday = today >= y0 && today <= y1;
  const bar = (it, st, cls = '') => {
    const l = pct(it.start), r = pct(nextDay(it.end));
    return r > l ? <span className={`gbar dl ${st} ${cls}`} style={{ left: `${l}%`, width: `${r - l}%` }} title={`${it.name} · ${md(it.start)} ~ 마감 ${md(it.end)}`} /> : null;
  };
  const catLabel = c => (c === '목표 관리' ? '영역 공통' : c);
  const MileList = ({ list }) => (
    <ul className="gv-miles">{list.map(({ g, m }) => {
      const d = daysBetween(today, m.date);
      return (
        <li key={m.id} className={m.done ? 'done' : d < 0 ? 'late' : d <= 7 ? 'soon' : ''}>
          <b className="gv-dd">{m.done ? '완료' : d === 0 ? 'D-day' : d > 0 ? `D-${d}` : `D+${-d}`}</b>
          <span className="gv-mn">{m.name}<small className="muted"> · {md(m.date)}</small></span>
          <button className="gv-cat" onClick={() => openCat(area, g.c)}>{catLabel(g.c)}</button>
        </li>
      );
    })}</ul>
  );

  return (
    <div className="catv gv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
      </header>

      <div className="bar"><YearPicker year={year} setYear={setYear} />
        <div className="chips grow-r" role="group" aria-label="보기"><button aria-pressed={tasks} onClick={() => setTasks(!tasks)}>작업까지 보기</button></div>
        <button className="btn primary sm" onClick={() => setOnb(need === 'month' ? 'month' : 'setup')}>{need === 'month' ? `${now.getMonth() + 1}월 목표 점검` : '목표 · 루틴 온보딩'}</button></div>
      {onbMsg && <p className="banner ok" role="status">{onbMsg}<button className="linkish" onClick={() => setOnbMsg('')}>닫기</button></p>}
      {onb && <GoalOnboard area={area} mode={onb} onClose={(saved, msg) => { setOnb(null); if (saved) { setYear(now.getFullYear()); setOnbMsg(msg || '저장했습니다. 아래 목표 · 마일스톤 표에 들어갔습니다. 다음 달 1일에 다시 점검 창이 열립니다.'); } }} />}

      <GoalCrud area={area} year={year} />

      <div className="gv-top">
        <section className="panel">
          <div className="csum-h"><h2>{year}년 목표 마감 D-day</h2><span className="muted">진행 중 {openN}개{lateN ? ` · 마감 지남 ${lateN}개` : ''}{near ? ` · 가장 가까운 마감 ${md(near.r.item.end)} (${near.st.dd})` : ''}</span></div>
          {allRoots.length ? (
            <ul className="gv-goals gv-dl">{allRoots.map(({ g, r, st }) => (
              <li key={r.item.id} className={st.k}>
                <b className={`dd ${st.k}`}>{st.dd}</b>
                <span className="gv-gn">{r.item.name}<small className="muted"> · 마감 {r.item.end.slice(0, 4) !== String(year) ? `${r.item.end.slice(0, 4)}. ` : ''}{md(r.item.end)}</small></span>
                <button className="gv-cat" onClick={() => openCat(area, g.c)}>{catLabel(g.c)}</button>
              </li>))}</ul>
          ) : <p className="muted">{year}년 목표가 없습니다.</p>}
        </section>
        <section className="panel">
          <div className="csum-h"><h2>{year !== now.getFullYear() ? `${year}년 ` : '이번 달 '}{Number(mm)}월 주요 마일스톤</h2><span className="muted">이번 달 {monthMiles.length}건 · 다음 30일 {soonMiles.length}건</span></div>
          {monthMiles.length ? <MileList list={monthMiles} /> : <p className="muted gv-none">{Number(mm)}월에 남은 마일스톤이 없습니다.</p>}
          {soonMiles.length > 0 && <>
            <h3 className="lv-h3">다음 30일</h3>
            <MileList list={soonMiles} />
          </>}
        </section>
      </div>


      <section className="panel">
        <div className="csum-h"><h2>통합 WBS</h2><span className="muted">카테고리 › 목표 › 단계{tasks ? ' › 작업' : ''}</span></div>
        {groups.length ? (
          <div className="tablewrap"><table className="wbs agg">
            <thead><tr><th className="c-code">WBS</th><th className="c-name">항목</th><th className="c-mid">기간 (시작 ~ 마감)</th><th className="c-mid">D-day</th><th className="c-mid">상태</th></tr></thead>
            <tbody>{groups.map(g => [
              <tr key={g.key} className="cat-row">
                <td className="c-code">{g.n}</td>
                <td className="c-name"><div className="wbs-name">
                  <button className="fold" onClick={() => setFold({ ...fold, [g.key]: !fold[g.key] })} aria-label={fold[g.key] ? '펼치기' : '접기'}>{fold[g.key] ? '▸' : '▾'}</button>
                  <button className="linkish" onClick={() => openCat(area, g.c)}>{catLabel(g.c)}</button><small className="muted">목표 {g.roots.length}</small></div></td>
                <td className="nowrap c-mid">{g.start ? `${md(g.start)} ~ ${md(g.end)}` : '-'}</td>
                <td className="c-mid">{g.near ? <DDay it={g.near} today={today} /> : ''}</td>
                <td className="c-mid">{g.near ? <small className="muted">가장 가까운 마감</small> : ''}</td>
              </tr>,
              ...(fold[g.key] ? [] : g.rows.filter(r => tasks || r.level < 2).map(r => {
                const st = deadlineOf(r.item, today);
                return (
                  <tr key={r.item.id} className={`lv${Math.min(r.level, 2)}`}>
                    <td className="c-code">{g.n}.{r.code}</td>
                    <td className="c-name"><div className="wbs-name" style={{ paddingLeft: 20 + r.level * 18 }}><span className="agg-n">{r.item.name}</span></div></td>
                    <td className="nowrap c-mid">{md(r.item.start)} ~ {md(r.item.end)}</td>
                    <td className="c-mid"><DDay it={r.item} today={today} /></td>
                    <td className="c-mid"><span className={`st ${st.k}`}>{st.t}</span></td>
                  </tr>
                );
              })),
            ])}</tbody>
          </table></div>
        ) : <p className="muted">{year}년에 세운 목표가 없습니다.</p>}
      </section>

      {groups.length > 0 && (
        <section className="panel">
          <div className="csum-h"><h2>통합 연간 일정표</h2><span className="muted">{year}년 1월 ~ 12월 · 카테고리 › 목표{tasks ? ' › 단계' : ''}</span></div>
          <div className="tablewrap"><div className="gantt">
            <div className="gantt-row gantt-head"><span className="gantt-label" />
              <div className="gantt-track">
                {Array.from({ length: 12 }, (_, m) => <span key={m} className="gantt-month" style={{ left: `${pct(`${year}-${String(m + 1).padStart(2, '0')}-01`)}%` }}>{m + 1}월</span>)}
                {showToday && <i className="tl-today" style={{ left: `${pct(today)}%` }} />}
              </div></div>
            {groups.map(g => [
              <div key={g.key} className="gantt-row cat-row">
                <span className="gantt-label"><em>{g.n}</em> {catLabel(g.c)}</span>
                <div className="gantt-track">
                  {Array.from({ length: 12 }, (_, m) => <i key={m} className="gantt-grid" style={{ left: `${pct(`${year}-${String(m + 1).padStart(2, '0')}-01`)}%` }} />)}
                  {showToday && <i className="tl-today" style={{ left: `${pct(today)}%` }} />}
                  {g.start && bar({ name: catLabel(g.c), start: g.start, end: g.end }, 'run', 'cat')}
                </div></div>,
              ...g.rows.filter(r => r.level === 0 || (tasks && r.level === 1)).map(r => {
                const st = deadlineOf(r.item, today);
                return (
                  <div key={r.item.id} className={`gantt-row lv${r.level + 1}`}>
                    <span className="gantt-label" style={{ paddingLeft: 14 + r.level * 14 }}><em>{g.n}.{r.code}</em> {r.item.name} <DDay it={r.item} today={today} /></span>
                    <div className="gantt-track">
                      {Array.from({ length: 12 }, (_, m) => <i key={m} className="gantt-grid" style={{ left: `${pct(`${year}-${String(m + 1).padStart(2, '0')}-01`)}%` }} />)}
                      {showToday && <i className="tl-today" style={{ left: `${pct(today)}%` }} />}
                      {bar(r.item, st.k)}
                    </div></div>
                );
              }),
            ])}
          </div></div>
          <p className="note">막대 오른쪽 끝(진한 선)이 마감, 빨간 세로선은 오늘입니다. 카테고리 줄은 그 카테고리 목표 전체 기간입니다.</p>
        </section>
      )}

      <section className="panel">
        <div className="csum-h"><h2>통합 마일스톤</h2><span className="muted">{year}년 · {miles.filter(x => x.m.done).length}/{miles.length} 완료</span></div>
        {miles.length ? (
          <div className="tablewrap"><table className="prog mile-tb">
            <thead><tr><th>날짜</th><th>D-day</th><th>마일스톤</th><th>카테고리</th><th>연결 목표</th></tr></thead>
            <tbody>{miles.map(({ g, m, link }) => {
              const dd = daysBetween(today, m.date);
              return (
                <tr key={m.id} className={m.done ? 'is-done' : ''}>
                  <td className="nowrap">{md(m.date)}</td>
                  <td className={`nowrap ${!m.done && dd < 0 ? 'late-t' : ''}`}>{m.done ? '완료' : dd === 0 ? 'D-day' : dd > 0 ? `D-${dd}` : `D+${-dd}`}</td>
                  <td className={m.done ? 'muted' : ''}>{m.name}</td>
                  <td><button className="linkish" onClick={() => openCat(area, g.c)}>{catLabel(g.c)}</button></td>
                  <td className="muted">{link ? `${g.n}.${link.code} ${link.item.name}` : '-'}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <p className="muted">{year}년 마일스톤이 없습니다.</p>}
      </section>


    </div>
  );
}

/* 대시보드용 통합 연간 일정표: 개인·사업·근로의 모든 목표를 영역 › 목표 순으로 한 일정표에 */
export function DashYearGantt() {
  const { now, store, openCat } = useCtx();
  const today = iso(now);
  const [year, setYear] = useState(now.getFullYear());
  const [fold, setFold] = useState({});
  const boards = (store.goals?.v === 2 ? store.goals : seedGoals(now)).boards;
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`, span = daysBetween(y0, y1) + 1;
  const pct = d => clampPct((daysBetween(y0, d) / span) * 100);
  const showToday = today >= y0 && today <= y1;
  const months = Array.from({ length: 12 }, (_, m) => `${year}-${String(m + 1).padStart(2, '0')}-01`);
  const grid = () => <>{months.map(m => <i key={m} className="gantt-grid" style={{ left: `${pct(m)}%` }} />)}{showToday && <i className="tl-today" style={{ left: `${pct(today)}%` }} />}</>;
  const bar = (it, st, cls = '') => { const l = pct(it.start), r = pct(nextDay(it.end));
    return r > l ? <span className={`gbar dl ${st} ${cls}`} style={{ left: `${l}%`, width: `${r - l}%` }} title={`${it.name} · ${md(it.start)} ~ 마감 ${md(it.end)}`} /> : null; };

  const areas = Object.keys(AREAS).map(a => {
    const order = ['목표 관리', ...new Set(CATS.filter(r => r.a === a && r.cat !== '목표 관리').map(r => r.cat))];
    const goals = order.flatMap(c => {
      const b = boards[boardKey(a, c)];
      if (!b || !hasGoals(a, c)) return [];
      return boardForYear(b, year).items.filter(i => !i.parent).map(it => ({ c, it, st: deadlineOf(it, today) }));
    });
    const starts = goals.map(g => g.it.start).sort(), ends = goals.map(g => g.it.end).sort();
    return { a, goals, near: nearest(goals.map(g => g.it), today), start: starts[0], end: ends[ends.length - 1] };
  }).filter(x => x.goals.length);
  // 다가오는 마감: 모든 영역에서 안 끝난 목표를 마감 가까운 순 (지난 것 먼저)
  const upcoming = areas.flatMap(A => A.goals.map(g => ({ ...g, a: A.a }))).filter(g => g.st.k !== 'done').sort((x, y) => x.it.end.localeCompare(y.it.end)).slice(0, 6);

  return (
    <section className="panel dash-gantt" aria-label="통합 연간 일정표">
      <div className="csum-h"><h2>통합 연간 일정표</h2><span className="muted">개인 · 사업 · 근로 목표 · 마감(최종 데드라인) · D-day</span>
        <div className="grow-r"><YearPicker year={year} setYear={setYear} /></div></div>
      {upcoming.length > 0 && <div className="dg-up" aria-label="다가오는 마감">{upcoming.map(g => (
        <button key={g.it.id} className={`dg-dd ${g.st.k}`} style={{ '--ac': areaVar(g.a) }} onClick={() => openCat(g.a, g.c)} title={`${AREAS[g.a].n} · ${g.c === '목표 관리' ? '영역 공통' : g.c} · 마감 ${g.it.end}`}>
          <b className={`dd ${g.st.k}`}>{g.st.dd}</b> {g.it.name}<small> · {md(g.it.end)}</small></button>))}</div>}
      {areas.length ? (
        <div className="tablewrap"><div className="gantt">
          <div className="gantt-row gantt-head"><span className="gantt-label" />
            <div className="gantt-track">{months.map((m, i) => <span key={m} className="gantt-month" style={{ left: `${pct(m)}%` }}>{i + 1}월</span>)}
              {showToday && <i className="tl-today" style={{ left: `${pct(today)}%` }} />}</div></div>
          {areas.map(A => [
            <div key={A.a} className="gantt-row cat-row" style={{ '--ac': areaVar(A.a) }}>
              <span className="gantt-label"><button className="fold" onClick={() => setFold({ ...fold, [A.a]: !fold[A.a] })} aria-label={fold[A.a] ? '펼치기' : '접기'}>{fold[A.a] ? '▸' : '▾'}</button>
                {AREAS[A.a].n} <em>목표 {A.goals.length}{A.near ? ` · 다음 마감 ${deadlineOf(A.near, today).dd}` : ''}</em></span>
              <div className="gantt-track">{grid()}{A.start && bar({ name: AREAS[A.a].n, start: A.start, end: A.end }, 'run', 'cat')}</div></div>,
            ...(fold[A.a] ? [] : A.goals.map(g => (
              <div key={g.it.id} className="gantt-row lv1" style={{ '--ac': areaVar(A.a) }}>
                <span className="gantt-label" style={{ paddingLeft: 26 }} title={`${g.c === '목표 관리' ? '영역 공통' : g.c} · ${g.it.name} · 마감 ${g.it.end} · ${g.st.dd}`}>
                  <button className="linkish dg-cat" onClick={() => openCat(A.a, g.c)}>{g.c === '목표 관리' ? '공통' : g.c}</button> {g.it.name} <DDay it={g.it} today={today} /></span>
                <div className="gantt-track">{grid()}{bar(g.it, g.st.k)}</div></div>))),
          ])}
        </div></div>
      ) : <p className="muted">{year}년 목표가 없습니다.</p>}
      <p className="note">막대 오른쪽 끝(진한 선)이 마감, 빨간 세로선은 오늘입니다. 카테고리 이름을 누르면 그 카테고리로 이동합니다.</p>
    </section>
  );
}
