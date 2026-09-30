import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActionRow, Ctx, WEEK, areaVar, num, useCtx } from './shared.jsx';
import NeedsPanel from './Needs.jsx';
import { hasCustomView, isFirstReviewed, viewFor } from './categories/index.js';
import { seedHealth } from './categories/health.js';
import { clearFinanceOnce, seedFinance } from './categories/finance.js';
import { addExampleGoals, boardForYear, boardKey, dropNoGoal, hasGoals, migrateGoals, seedGoals } from './categories/goals.js';
import { DashYearGantt, GoalBoard } from './categories/GoalView.jsx';
import ShoppingList from './categories/Shopping.jsx';
import { migratePeople, seedPeople } from './categories/RelationView.jsx';
import { seedLeisure } from './categories/LeisureView.jsx';
import { seedJournal } from './categories/ReviewView.jsx';
import { AREAS, CYCLES, DEFAULT_RULES, ROWS, PRIO, defaultPrio, dueRule, isDue, iso, nextDue, pad, periodKey, setRules } from './data.js';
import { mockAi, mockApi } from './mock.js';
import { SpeechRec, parseKoEvent } from './voice.js';
import { HOLIDAYS } from './holidays.js';
import { annivOn, nextAnniv, seedAnniv } from './anniv.js';

/* ───────────────────────── 공통 ───────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hhmm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ───────────────────────── 저장소 (브라우저 localStorage) ───────────────────────── */
const KEY = 'lifeboard.react.v1';
const seedEvents = () => {
  const d = n => iso(new Date(Date.now() + n * 864e5));
  return [
    { id: uid(), date: d(0), time: '14:00', title: '고객 미팅 (예시)', area: 'B' },
    { id: uid(), date: d(2), time: '10:30', title: '치과 검진 (예시)', area: 'P' },
    { id: uid(), date: d(4), time: '16:00', title: '팀 회의 (예시)', area: 'W' },
  ];
};
const PAGES = ['home', 'check', 'P', 'B', 'W', 'progress', 'settings'];
const readHash = () => {
  let [p, c] = window.location.hash.replace(/^#\/?/, '').split('/');
  try { p = decodeURIComponent(p || ''); c = c ? decodeURIComponent(c) : null; } catch (e) { p = ''; c = null; }
  return PAGES.includes(p) ? { page: p, cat: AREAS[p] ? c : null } : { page: 'home', cat: null };
};
const INIT = { done: {}, outs: {}, prio: {}, events: null, anniv: null, annivDays: 10, health: null, finance: null, goals: null, people: null, leisure: null, journal: null, rules: DEFAULT_RULES, log: [] };
/** 이름을 바꾼 카테고리: 저장된 검수 표시·목표 보드의 키도 새 이름으로 옮긴다 */
const RENAMED_CATS = { 'P|인맥/관계 관리': 'P|인맥 관리', 'P|리뷰/회고, 저널링': 'P|저널링' };
function renameCats(st) {
  const mv = o => { if (!o) return o; const r = { ...o }; Object.entries(RENAMED_CATS).forEach(([a, b]) => { if (a in r) { if (!(b in r)) r[b] = r[a]; delete r[a]; } }); return r; };
  return { ...st, reviewed: mv(st.reviewed), goals: st.goals?.boards ? { ...st.goals, boards: mv(st.goals.boards) } : st.goals };
}
const seedAll = () => ({ ...INIT, financeCleared: true, financeCleared2: true, events: seedEvents(), anniv: seedAnniv(), health: seedHealth(), finance: seedFinance(), goals: seedGoals(), people: seedPeople(), leisure: seedLeisure(), journal: seedJournal() });

function useStore() {
  const [store, setStore] = useState(() => {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* 저장소 사용 불가 또는 손상 */ }
    const merged = renameCats({ ...INIT, ...(v || {}) });
    return clearFinanceOnce({ ...merged, events: merged.events ?? seedEvents(), anniv: merged.anniv ?? seedAnniv(), health: merged.health ?? seedHealth(), finance: merged.finance ?? seedFinance(), goals: dropNoGoal(merged.goals ? addExampleGoals(migrateGoals(merged.goals)) : seedGoals()), people: merged.people ? migratePeople(merged.people, new Date()) : seedPeople(), leisure: merged.leisure ?? seedLeisure(), journal: merged.journal ?? seedJournal() });
  });
  const [persist, setPersist] = useState(true);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { setPersist(false); }
  }, [store]);
  return [store, setStore, persist];
}


/* ───────────────────────── 앱 ───────────────────────── */
export default function App() {
  const [store, setStore, persist] = useStore();
  setRules(store.rules);                           // 도래 규칙을 저장된 설정으로 맞춘다 (렌더 전에)
  const [route, setRoute] = useState(readHash);    // 주소 #/페이지/카테고리 와 연동 (브라우저 뒤로가기 지원)
  const { page, cat } = route;
  const [checkInit, setCheckInit] = useState(null);   // 대시보드에서 체크리스트로 이동할 때 적용할 필터
  const [panel, setPanel] = useState(null);
  const [pushes, setPushes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [todayStr, setTodayStr] = useState(iso(new Date()));
  const job = useRef(0);

  useEffect(() => { const t = setInterval(() => setTodayStr(iso(new Date())), 60000); return () => clearInterval(t); }, []);
  const now = useMemo(() => new Date(todayStr + 'T00:00:00'), [todayStr]);

  const doneKey = row => `${row.id}@${periodKey(row.c, now)}`;
  const isDone = row => !!store.done[doneKey(row)];
  const prioOf = row => store.prio[row.id] ?? defaultPrio(row);
  const cyclePrio = row => setStore(s => ({ ...s, prio: { ...s.prio, [row.id]: (prioOf(row) % 3) + 1 } }));

  const pushToast = (title, body) => {
    const id = uid();
    setPushes(p => [...p, { id, title, body }]);
    setTimeout(() => setPushes(p => p.filter(x => x.id !== id)), 4800);
  };

  const finish = (row, out) => {
    setStore(s => {
      const next = {
        ...s,
        done: { ...s.done, [doneKey(row)]: { at: `${iso(new Date())} ${hhmm()}` } },
        outs: { ...s.outs, [row.id]: out },
        log: [{ at: hhmm(), a: row.a, item: row.item, action: row.action, ty: row.ty }, ...s.log].slice(0, 40),
      };
      // API가 캘린더 일정을 만들면 홈 캘린더에도 반영한다
      if (out.t === 'API' && out.res.m === 'POST' && out.res.e === '/v1/calendar/events') {
        const b = out.res.b;
        next.events = [...s.events, { id: uid(), date: b.start.slice(0, 10), time: b.start.slice(11, 16), title: b.title, area: row.a }];
      }
      return next;
    });
  };

  /** 시뮬레이션 실행. fast=true 이면 지연 없이 결과만 반영한다 */
  const run = async (row, fast = false) => {
    const my = ++job.current, live = () => my === job.current;
    if (row.ty === '없음') { setPanel({ row, kind: 'manual' }); return; }
    if (row.ty === 'API') {
      const res = mockApi(row);
      for (let i = 0; i < 3; i++) { if (live() && !fast) setPanel({ row, kind: 'api', step: i }); await sleep(fast ? 30 : 420); }
      if (res.push) pushToast(res.b.title, res.b.message);
      if (live() && !fast) setPanel({ row, kind: 'api', step: 3, res });
      finish(row, { t: 'API', res });
    } else {
      const text = mockAi(row);
      if (!fast) {
        for (let i = 3; i <= text.length + 2 && live(); i += 3) { setPanel({ row, kind: 'ai', text: text.slice(0, i), typing: true }); await sleep(16); }
      }
      if (live() && !fast) setPanel({ row, kind: 'ai', text });
      finish(row, { t: 'AI', text });
    }
  };
  const runMany = async rows => {
    const todo = rows.filter(r => r.ty !== '없음' && !isDone(r));
    if (!todo.length) return;
    setBusy(true);
    for (const r of todo) await run(r, true);
    setBusy(false);
    pushToast('일괄 실행 완료', `${todo.length}건을 시뮬레이션으로 실행했습니다.`);
  };
  const toggle = row => {
    if (isDone(row)) { setStore(s => { const done = { ...s.done }; delete done[doneKey(row)]; return { ...s, done }; }); return; }
    if (row.ty === '없음') finish(row, { t: '없음', memo: '' }); else run(row);
  };
  const view = row => {
    const o = store.outs[row.id];
    job.current++;
    if (!o || o.t === '없음') setPanel({ row, kind: 'manual' });
    else if (o.t === 'API') setPanel({ row, kind: 'api', step: 3, res: o.res, saved: true });
    else setPanel({ row, kind: 'ai', text: o.text, saved: true });
  };

  /** 페이지 이동. 체크리스트는 { area, cyc } 필터를 받아 열 수 있다 */
  useEffect(() => { const f = () => { setRoute(readHash()); setPanel(null); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);   // 페이지를 옮기면 결과 패널은 닫는다
  const nav = (p, c = null) => {
    const h = `#/${[p, c].filter(Boolean).map(encodeURIComponent).join('/')}`;
    if (window.location.hash !== h) window.location.hash = h; else setRoute({ page: p, cat: c });
    window.scrollTo(0, 0);
  };
  const go = (p, init = null) => { setCheckInit(init); nav(p); };
  const openCat = (a, c) => nav(a, c);

  const ctx = { store, setStore, now, todayStr, isDone, prioOf, cyclePrio, toggle, run, runMany, view, finish, busy, setPanel, go, openCat };

  const NAV = [
    { id: 'home', label: '대시보드' },
    { id: 'progress', label: '진행 현황' },
    { id: 'check', label: '체크리스트' },
    { sec: '상세 내용' },
    { id: 'P', label: AREAS.P.n, color: areaVar('P') },
    { id: 'W', label: AREAS.W.n, color: areaVar('W') },
    { id: 'B', label: AREAS.B.n, color: areaVar('B') },
    { sec: '관리' },
    { id: 'settings', label: '설정' },
  ];

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <aside className="nav" aria-label="주 메뉴">
          <div className="brand"><b>Jcalender</b><span>{now.getFullYear()}.{pad(now.getMonth() + 1)}.{pad(now.getDate())} ({WEEK[now.getDay()]})</span></div>
          <nav>
            {NAV.map((n, i) => n.sec
              ? <div className="nav-sec" key={i}>{n.sec}</div>
              : <button key={n.id} className={page === n.id ? 'on' : ''} aria-current={page === n.id ? 'page' : undefined} style={n.color ? { '--ac': n.color } : undefined} onClick={() => go(n.id)}>
                  {n.color && <i className="dot" />}<span>{n.label}</span>
                </button>)}
          </nav>
        </aside>
        <main className="main">
          {!persist && <p className="banner">이 브라우저에서는 데이터가 저장되지 않습니다. 새로고침하면 진행 상태가 사라집니다.</p>}
          {page === 'home' && <Home />}
          {page === 'check' && <CheckPage key={JSON.stringify(checkInit)} init={checkInit} />}
          {AREAS[page] && !cat && <AreaPage key={page} area={page} />}
          {AREAS[page] && cat && <CategoryPage key={`${page}|${cat}`} area={page} cat={cat} />}
          {page === 'progress' && <Progress />}
          {page === 'settings' && <Settings />}
        </main>
        {panel && <Drawer key={`${panel.row.id}-${panel.kind}`} panel={panel} onClose={() => setPanel(null)} />}
        <div className="pushes" aria-live="polite">{pushes.map(p => <div className="push" key={p.id}><b>{p.title}</b><span>{p.body}</span></div>)}</div>
      </div>
    </Ctx.Provider>
  );
}

/* ───────────────────────── 홈: 대시보드 ───────────────────────── */
const fmtMD = d => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
const dayDiff = (a, b) => Math.round((b - a) / 864e5);

function Home() {
  const { now } = useCtx();
  const [sel, setSel] = useState(iso(now));
  const dueToday = ['W', 'M', 'Y'].filter(c => isDue(c, now));
  return (
    <>
      <header className="page-h"><h1>대시보드</h1><p>{now.getFullYear()}년 {now.getMonth() + 1}월 {now.getDate()}일 {WEEK[now.getDay()]}요일 · 일정과 오늘 남은 항목을 한눈에 확인하세요.</p></header>
      <div className="dash-top">
        <Remain />
        <DueCards />
      </div>
      <Calendar sel={sel} setSel={setSel} />
      <AnnivStrip />
      <ShoppingList compact />
      {dueToday.map(c => <CycleSummary key={c} c={c} hot title={`오늘은 ${CYCLES[c]}일입니다`} note={`${dueRule(c)} 도래 · 기간 ${periodKey(c, now)}`} />)}
      <DashYearGantt />
    </>
  );
}

/* 다가오는 기념일 (설정한 일수 이내) */
function AnnivStrip() {
  const { store, now, openCat } = useCtx();
  const days = store.annivDays;
  const list = store.anniv.map(a => ({ a, n: nextAnniv(a, now) })).filter(x => x.n && x.n.dday <= days).sort((x, y) => x.n.dday - y.n.dday);
  return (
    <section className="panel anniv" aria-label="다가오는 기념일">
      <div className="csum-h"><h2>다가오는 기념일</h2><span className="muted">D-{days}일 이내 · {list.length}건</span>
        <button className="btn sm" onClick={() => openCat('P', '기념일 관리')}>기념일 관리</button></div>
      {list.length ? (
        <div className="anniv-list">{list.map(({ a, n }) => (
          <div key={a.id} className={`anniv-card ${n.dday === 0 ? 'hot' : n.dday <= 3 ? 'soon' : ''}`}>
            <b className="anniv-d">{n.dday === 0 ? '오늘' : `D-${n.dday}`}</b>
            <span className="anniv-n">{a.name}</span>
            <span className="anniv-m">{a.kind} · {fmtMD(n.date)}{a.kind === '기념일' && n.years > 0 ? ` · ${n.years}주년` : ''}{a.person ? ` · ${a.person}` : ''}</span>
          </div>))}</div>
      ) : <p className="muted anniv-empty">{days}일 이내에 다가오는 기념일이 없습니다.</p>}
    </section>
  );
}

/* 오늘 남은 항목 */
function Remain() {
  const { now, isDone, prioOf, go } = useCtx();
  const cycles = Object.keys(CYCLES).filter(c => isDue(c, now));
  const base = ROWS.filter(r => cycles.includes(r.c));
  const doneN = base.filter(isDone).length;
  const left = { 1: 0, 2: 0, 3: 0 };
  base.filter(r => !isDone(r)).forEach(r => { left[prioOf(r)]++; });
  return (
    <section className="panel remain" aria-label="오늘 남은 항목">
      <h2>오늘 남은 항목</h2>
      <div className="sum-n"><b>{base.length - doneN}</b><span>개 남음 · {doneN}/{base.length} 완료</span></div>
      <div className="pbar" role="progressbar" aria-valuenow={doneN} aria-valuemax={base.length}><i style={{ width: `${base.length ? doneN / base.length * 100 : 0}%` }} /></div>
      <div className="sum-p"><span className="prio p1">높음 {left[1]}</span><span className="prio p2">중간 {left[2]}</span><span className="prio p3">낮음 {left[3]}</span></div>
      <div className="sum-p">{cycles.map(c => {
        const rs = base.filter(r => r.c === c);
        return <span key={c} className="tag">{CYCLES[c].replace('체크-루틴', '').replace('체크', '')} {rs.filter(isDone).length}/{rs.length}</span>;
      })}</div>
      <button className="btn primary sm remain-go" onClick={() => go('check')}>체크리스트 열기</button>
    </section>
  );
}

/* 주간·월간·년간 도래일 */
function DueCards() {
  const { now, isDone, go } = useCtx();
  return (
    <div className="due-cards">
      {['W', 'M', 'Y'].map(c => {
        const nd = nextDue(c, now), dd = dayDiff(now, nd), today = dd === 0;
        const rs = ROWS.filter(r => r.c === c), d = rs.filter(isDone).length;
        return (
          <button key={c} className={`due-card ${today ? 'hot' : ''}`} onClick={() => go('check', { cyc: c })}>
            <span className="due-t">{CYCLES[c]}</span>
            <b className="due-d">{today ? '오늘' : `D-${dd}`}</b>
            <span className="due-r">{dueRule(c)} · {fmtMD(nd)}</span>
            <span className="due-c">{today ? `완료 ${d}/${rs.length}` : `${rs.length}개 항목`}</span>
          </button>
        );
      })}
    </div>
  );
}

/* 주기별 · 영역별 · 카테고리별 요약 */
function CycleSummary({ c, title, note, hot }) {
  const { isDone, prioOf, go } = useCtx();
  return (
    <section className={`panel csum ${hot ? 'hot' : ''}`} aria-label={title}>
      <div className="csum-h"><h2>{title}</h2><span className="muted">{note}</span>
        <button className="btn sm" onClick={() => go('check', { cyc: c })}>전체 보기</button></div>
      <div className="acards">
        {Object.keys(AREAS).map(a => {
          const rs = ROWS.filter(r => r.a === a && r.c === c);
          if (!rs.length) return null;
          const d = rs.filter(isDone).length;
          const cats = [];
          rs.forEach(r => { let g = cats.find(x => x.cat === r.cat); if (!g) cats.push(g = { cat: r.cat, rows: [] }); g.rows.push(r); });
          cats.forEach(g => { g.left = g.rows.filter(r => !isDone(r)).sort((x, y) => prioOf(x) - prioOf(y)); });
          cats.sort((x, y) => (x.left.length ? Math.min(...x.left.map(prioOf)) : 4) - (y.left.length ? Math.min(...y.left.map(prioOf)) : 4));
          return (
            <div className="acard" key={a} style={{ '--ac': areaVar(a) }}>
              <div className="acard-h"><i className="dot" /><b>{AREAS[a].n}</b><span className="muted">{d}/{rs.length}</span></div>
              <div className="pbar"><i style={{ width: `${d / rs.length * 100}%` }} /></div>
              <ul className="cats">{cats.map(g => {
                const hi = g.left.filter(r => prioOf(r) === 1).length;
                const names = g.left.slice(0, 2).map(r => r.action.replace(' (제안)', '')).join(', ');
                return (
                  <li key={g.cat}><button onClick={() => go('check', { area: a, cyc: c })} className={g.left.length ? '' : 'ok'}>
                    <span className="cat-n">{g.cat}</span>
                    {hi > 0 && <span className="prio p1">높음 {hi}</span>}
                    <span className="cat-c">{g.rows.length - g.left.length}/{g.rows.length}</span>
                    <span className="cat-l">{g.left.length ? names + (g.left.length > 2 ? ` 외 ${g.left.length - 2}` : '') : '모두 완료'}</span>
                  </button></li>
                );
              })}</ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ───────────────────────── 체크리스트 ───────────────────────── */
function CheckPage({ init }) {
  const { now } = useCtx();
  return (
    <>
      <header className="page-h"><h1>체크리스트</h1><p>{now.getFullYear()}년 {now.getMonth() + 1}월 {now.getDate()}일 {WEEK[now.getDay()]}요일 · 우선순위 순으로 체크하세요. 주간은 {dueRule('W')}, 월간은 {dueRule('M')}, 년간은 {dueRule('Y')}에 도래합니다.</p></header>
      <Checklist init={init} />
    </>
  );
}

/* 일정관리 캘린더 */
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function Calendar({ sel, setSel }) {
  const { store, setStore, now, todayStr } = useCtx();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [adding, setAdding] = useState(null);     // null 이면 닫힘, { date, time, ... } 이면 일정 추가 창 열림
  const [voice, setVoice] = useState(false);
  const first = new Date(ym.y, ym.m, 1), start = new Date(ym.y, ym.m, 1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const byDate = useMemo(() => {
    const m = {};
    for (const e of store.events) (m[e.date] ||= []).push(e);
    for (const k in m) m[k].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    return m;
  }, [store.events]);
  const move = n => { const d = new Date(ym.y, ym.m + n, 1); setYm({ y: d.getFullYear(), m: d.getMonth() }); };
  const goToday = () => { setYm({ y: now.getFullYear(), m: now.getMonth() }); setSel(todayStr); };
  const pick = k => { setSel(k); const d = new Date(k + 'T00:00:00'); if (d.getMonth() !== ym.m) setYm({ y: d.getFullYear(), m: d.getMonth() }); };
  const addEvent = ev => {
    setStore(s => ({ ...s, events: [...s.events, { id: uid(), ...ev }] }));
    pick(ev.date);
    setAdding(null);
  };
  const delEvent = id => setStore(s => ({ ...s, events: s.events.filter(x => x.id !== id) }));
  const selDate = new Date(sel + 'T00:00:00');
  const dueCycles = Object.keys(CYCLES).filter(c => c !== 'S' && isDue(c, selDate));
  const list = byDate[sel] || [];

  return (
    <section className="cal" aria-label="일정 캘린더">
      <div className="cal-main">
        <div className="cal-h">
          <h2>{ym.y}년 {ym.m + 1}월</h2>
          <div className="btns">
            <button className="btn sm" onClick={() => move(-1)} aria-label="이전 달">이전</button><button className="btn sm" onClick={goToday}>오늘</button><button className="btn sm" onClick={() => move(1)} aria-label="다음 달">다음</button>
            <button className="btn sm primary" onClick={() => setAdding({ date: sel, time: '' })}>+ 일정 추가</button>
            <button className="btn sm" onClick={() => setVoice(true)}>음성으로 추가</button>
          </div>
        </div>
        <div className="cal-grid" role="grid">
          {WEEK.map((w, i) => <div key={w} className={`cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>{w}</div>)}
          {cells.map(d => {
            const k = iso(d), evs = byDate[k] || [];
            return (
              <button key={k} role="gridcell" className={`cal-cell ${d.getMonth() !== ym.m ? 'out' : ''} ${k === todayStr ? 'today' : ''} ${k === sel ? 'sel' : ''} ${HOLIDAYS[k] || d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''}`} onClick={() => pick(k)} aria-label={`${d.getMonth() + 1}월 ${d.getDate()}일${HOLIDAYS[k] ? ` ${HOLIDAYS[k]}` : ''} 일정 ${evs.length}건`}>
                <span className="cal-top"><span className="cal-n">{d.getDate()}</span>
                  {['Y', 'M', 'W'].filter(c => isDue(c, d)).map(c => <span key={c} className={`cal-due ${c}`}>{CYCLES[c].slice(0, 2)}</span>)}</span>
                {HOLIDAYS[k] && <span className="cal-hol">{HOLIDAYS[k]}</span>}
                {annivOn(store.anniv, k).map(a => <span key={a.id} className="cal-anniv">{a.name}</span>)}
                {evs.slice(0, 2).map(e => <span key={e.id} className="cal-ev" style={{ '--ac': areaVar(e.area) }}>{e.time && <small>{e.time}</small>} {e.title}</span>)}
                {evs.length > 2 && <span className="cal-more">+{evs.length - 2}건</span>}
              </button>
            );
          })}
        </div>
      </div>
      <DayTimeline date={selDate} isToday={sel === todayStr} list={list} dueCycles={dueCycles} holiday={HOLIDAYS[sel]} anniv={annivOn(store.anniv, sel)}
        onAdd={time => setAdding({ date: sel, time })} onDelete={delEvent} />
      {adding && <EventDialog init={adding} onSave={addEvent} onClose={() => setAdding(null)} />}
      {voice && <VoiceDialog now={now} onDone={ev => { setVoice(false); setAdding(ev); }} onClose={() => setVoice(false)} />}
    </section>
  );
}

/* 선택한 날짜의 1시간 단위 일정 */
function DayTimeline({ date, isToday, list, dueCycles, holiday, anniv, onAdd, onDelete }) {
  const box = useRef(null);
  const allDay = list.filter(e => !e.time);
  const byHour = {};
  list.filter(e => e.time).forEach(e => { (byHour[Number(e.time.slice(0, 2))] ||= []).push(e); });
  const nowH = new Date().getHours();
  // 날짜를 바꾸면 첫 일정 시각(없으면 오늘은 현재 시각, 다른 날은 8시) 근처로 스크롤
  const firstH = list.filter(e => e.time).map(e => Number(e.time.slice(0, 2)))[0];
  const focusH = Math.max(0, (firstH ?? (isToday ? nowH : 8)) - 1);
  useEffect(() => {
    const el = box.current?.querySelector(`[data-h="${focusH}"]`);
    if (el) box.current.scrollTop = el.offsetTop - box.current.offsetTop;
  }, [iso(date), focusH]);

  return (
    <div className="cal-side">
      <div className="day-h">
        <h2 className={holiday || date.getDay() === 0 ? 'sun' : date.getDay() === 6 ? 'sat' : ''}>{date.getMonth() + 1}월 {date.getDate()}일 ({WEEK[date.getDay()]})</h2>
        <span className="muted">일정 {list.length}건</span>
      </div>
      {(holiday || anniv.length > 0) && <div className="day-tags">
        {holiday && <span className="cal-hol">{holiday}</span>}
        {anniv.map(a => <span key={a.id} className="cal-anniv">{a.kind} · {a.name}</span>)}</div>}
      {dueCycles.length > 1 && <p className="due-note">이 날은 {dueCycles.filter(c => c !== 'D').map(c => CYCLES[c]).join(', ')}일입니다.</p>}
      {allDay.length > 0 && (
        <div className="allday"><span className="tl-h">종일</span>
          <div className="tl-evs">{allDay.map(e => <TimelineEvent key={e.id} e={e} onDelete={onDelete} />)}</div></div>)}
      <div className="tl" ref={box} aria-label="시간대별 일정">
        {HOURS.map(h => {
          const evs = byHour[h] || [];
          return (
            <div key={h} data-h={h} className={`tl-row ${isToday && h === nowH ? 'now' : ''}`}>
              <span className="tl-h">{pad(h)}:00</span>
              <div className="tl-evs">
                {evs.map(e => <TimelineEvent key={e.id} e={e} onDelete={onDelete} />)}
                <button className="tl-add" onClick={() => onAdd(`${pad(h)}:00`)} aria-label={`${h}시에 일정 추가`}>{evs.length ? '+' : ''}</button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="note">빈 시간을 누르면 그 시각으로 일정을 추가합니다.</p>
    </div>
  );
}

function TimelineEvent({ e, onDelete }) {
  return (
    <div className="tl-ev" style={{ '--ac': areaVar(e.area) }}>
      <span className="grow"><small>{e.time || '종일'}</small> {e.title}</span>
      <button className="tl-del" onClick={() => onDelete(e.id)} aria-label={`${e.title} 삭제`}>삭제</button>
    </div>
  );
}

/* 일정 추가 창 */
function EventDialog({ init, onSave, onClose }) {
  const [f, setF] = useState({ title: init.title || '', date: init.date, time: init.time || '', area: init.area || 'P' });
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const submit = e => {
    e.preventDefault();
    if (!f.title.trim() || !f.date) return;
    onSave({ date: f.date, time: f.time, title: f.title.trim(), area: f.area });
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" role="dialog" aria-label="일정 추가" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <h2>일정 추가</h2>
        {init.heard && <p className="heard">인식한 문장: “{init.heard}”<br /><span className="muted">내용을 확인하고 틀린 부분은 고친 뒤 추가하세요.</span></p>}
        <label>제목<input autoFocus={!init.heard} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="일정 제목" /></label>
        <div className="row2">
          <label>날짜<input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
          <label>시간<input type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></label>
        </div>
        <label>영역<select value={f.area} onChange={e => setF({ ...f, area: e.target.value })}>
          {Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v.n}</option>)}</select></label>
        <p className="note">시간을 비우면 종일 일정으로 등록됩니다.</p>
        <div className="btns"><button type="button" className="btn" onClick={onClose}>취소</button><button className="btn primary" disabled={!f.title.trim()}>추가</button></div>
      </form>
    </div>
  );
}

/* 음성으로 일정 추가: 말한 문장을 날짜·시간·제목으로 나눠 추가 창에 채운다 */
function VoiceDialog({ now, onDone, onClose }) {
  const [state, setState] = useState(SpeechRec ? 'listening' : 'unsupported');   // listening | idle | error | unsupported
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const rec = useRef(null);
  const finalText = useRef('');

  const finish = said => {
    const t = said.trim();
    if (!t) return;
    onDone({ ...parseKoEvent(t, now), heard: t });
  };
  const listen = () => {
    if (!SpeechRec) return;
    rec.current?.abort();
    const r = new SpeechRec();
    r.lang = 'ko-KR'; r.interimResults = true; r.continuous = false;
    finalText.current = ''; setText(''); setErr(''); setState('listening');
    r.onresult = e => {
      let fin = '', mid = '';
      for (const res of e.results) (res.isFinal ? (fin += res[0].transcript) : (mid += res[0].transcript));
      finalText.current = fin; setText(fin + mid);
    };
    r.onerror = e => {
      setState('error');
      setErr(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? '마이크 사용 권한이 없습니다. 브라우저 주소창의 마이크 권한을 허용하거나, 아래에 직접 입력하세요.'
        : e.error === 'no-speech' ? '말소리가 들리지 않았습니다. 다시 말하기를 누르세요.'
        : `음성 인식 오류(${e.error}). 아래에 직접 입력해도 됩니다.`);
    };
    r.onend = () => {
      rec.current = null;
      if (finalText.current.trim()) finish(finalText.current);
      else setState(s => (s === 'listening' ? 'idle' : s));
    };
    rec.current = r;
    try { r.start(); } catch (e) { setState('error'); setErr('음성 인식을 시작하지 못했습니다. 아래에 직접 입력하세요.'); }
  };
  useEffect(() => {
    if (SpeechRec) listen();
    const esc = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); rec.current?.abort(); };
  }, []);

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" role="dialog" aria-label="음성으로 일정 추가" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); rec.current?.abort(); finish(text); }}>
        <h2>음성으로 일정 추가</h2>
        <div className={`mic ${state === 'listening' ? 'on' : ''}`} aria-live="polite">
          <span className="mic-dot" />
          {state === 'listening' ? '듣고 있습니다. 말씀하세요.' : state === 'unsupported' ? '이 브라우저는 음성 인식을 지원하지 않습니다. (Chrome, Edge, Safari 권장)' : state === 'error' ? err : '다시 말하기를 누르거나 아래 문장을 고쳐서 분석하세요.'}
        </div>
        <p className="note">예) “내일 오후 3시 반 치과 예약”, “다음주 수요일 10시 팀 회의”, “10월 5일 고객 미팅”</p>
        <label>인식된 문장<textarea rows={2} value={text} onChange={e => { setText(e.target.value); if (state === 'listening') { rec.current?.abort(); setState('idle'); } }} placeholder="여기에 직접 입력해도 됩니다" /></label>
        <div className="btns">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          {SpeechRec && <button type="button" className="btn" onClick={listen} disabled={state === 'listening'}>다시 말하기</button>}
          <button className="btn primary" disabled={!text.trim()}>이 내용으로 추가</button>
        </div>
      </form>
    </div>
  );
}

/* 카테고리별·우선순위순 체크리스트 (길게 스크롤) */
function Checklist({ init }) {
  const { store, now, isDone, prioOf, runMany, busy } = useCtx();
  const [cyc, setCyc] = useState(init?.cyc ? new Set([init.cyc]) : null);   // null 이면 도래한 주기를 자동으로 사용
  const [area, setArea] = useState(init?.area ?? 'ALL');
  const [status, setStatus] = useState('TODO');
  const [sort, setSort] = useState('PRIO');
  const [q, setQ] = useState('');
  const auto = useMemo(() => new Set(Object.keys(CYCLES).filter(c => isDue(c, now))), [now, store.rules]);
  const active = cyc ?? auto;
  const toggleCyc = c => { const n = new Set(active); n.has(c) ? n.delete(c) : n.add(c); setCyc(n); };

  const base = ROWS.filter(r => active.has(r.c));
  const doneN = base.filter(isDone).length;
  const left = { 1: 0, 2: 0, 3: 0 };
  base.filter(r => !isDone(r)).forEach(r => { left[prioOf(r)]++; });

  const rows = base.filter(r => (area === 'ALL' || r.a === area) && (status === 'ALL' || !isDone(r)) &&
    (!q || `${r.cat} ${r.item} ${r.action} ${r.detail}`.toLowerCase().includes(q.toLowerCase())));
  const groups = useMemo(() => {
    const m = new Map();
    rows.forEach((r, i) => {
      const k = `${r.a}|${r.cat}`;
      if (!m.has(k)) m.set(k, { key: k, a: r.a, cat: r.cat, order: i, rows: [] });
      m.get(k).rows.push({ r, i });
    });
    const arr = [...m.values()];
    arr.forEach(g => {
      const undone = g.rows.filter(x => !isDone(x.r));
      g.score = undone.length ? Math.min(...undone.map(x => prioOf(x.r))) : 4;
      g.rows.sort((x, y) => (sort === 'PRIO' ? prioOf(x.r) - prioOf(y.r) : 0) || (isDone(x.r) - isDone(y.r)) || x.i - y.i);
    });
    arr.sort((x, y) => (sort === 'PRIO' ? x.score - y.score : 0) || x.order - y.order);
    return arr;
  }, [rows.map(r => r.id).join(','), store.done, store.prio, sort]);

  return (
    <section className="check" aria-label="체크리스트">
      <div className="check-top">
        <div className="sum">
          <div className="sum-n"><b>{doneN}</b><span>/ {base.length} 완료</span></div>
          <div className="pbar" role="progressbar" aria-valuenow={doneN} aria-valuemax={base.length}><i style={{ width: `${base.length ? doneN / base.length * 100 : 0}%` }} /></div>
          <div className="sum-p">남은 항목 <span className="prio p1">높음 {left[1]}</span><span className="prio p2">중간 {left[2]}</span><span className="prio p3">낮음 {left[3]}</span></div>
        </div>
        <div className="filters">
          <div className="chips" role="group" aria-label="주기">
            {Object.entries(CYCLES).map(([k, n]) => (
              <button key={k} aria-pressed={active.has(k)} onClick={() => toggleCyc(k)}>{n}{auto.has(k) && k !== 'D' && <small> · 오늘 도래</small>}</button>))}
          </div>
          <div className="chips" role="group" aria-label="영역">
            {[['ALL', '전체 영역'], ...Object.entries(AREAS).map(([k, v]) => [k, v.n])].map(([k, n]) => <button key={k} aria-pressed={area === k} onClick={() => setArea(k)}>{n}</button>)}
          </div>
          <div className="chips" role="group" aria-label="보기">
            <button aria-pressed={status === 'TODO'} onClick={() => setStatus('TODO')}>미완료만</button>
            <button aria-pressed={status === 'ALL'} onClick={() => setStatus('ALL')}>전체</button>
            <button aria-pressed={sort === 'PRIO'} onClick={() => setSort(sort === 'PRIO' ? 'CAT' : 'PRIO')}>{sort === 'PRIO' ? '우선순위순' : '카테고리순'}</button>
          </div>
          <div className="row2">
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="액션·내용 검색" aria-label="검색" />
            <button className="btn" disabled={busy} onClick={() => runMany(rows)}>보이는 자동화 일괄 실행</button>
          </div>
        </div>
      </div>
      {groups.length === 0 && <div className="empty">{status === 'TODO' && base.length ? '오늘 남은 항목이 없습니다. 모두 완료했습니다.' : '표시할 항목이 없습니다. 위에서 주기를 선택하세요.'}</div>}
      {groups.map(g => {
        const gd = g.rows.filter(x => isDone(x.r)).length;
        return (
          <div className="group" key={g.key} style={{ '--ac': areaVar(g.a) }}>
            <div className="group-h"><i className="dot" /><h3>{AREAS[g.a].n} · {g.cat}</h3>
              {g.score < 4 && <span className={`prio p${g.score}`}>{PRIO[g.score]}</span>}<span className="muted">{gd}/{g.rows.length}</span></div>
            {g.rows.map(x => <ActionRow key={x.r.id} row={x.r} showCycle />)}
          </div>
        );
      })}
    </section>
  );
}


/* ───────────────────────── 상세: 영역 페이지 (카테고리 버튼) ───────────────────────── */
/** 상세 내용 화면 순서: 앞으로 올릴 카테고리(FIRST 앞에서부터), 맨 뒤로 보낼 카테고리 */
const CAT_ORDER = { P: { last: ['개인 재무'] } };
/** 영역의 카테고리 목록. 카테고리마다 세부 항목, 주기별 개수, 오늘 남은 개수를 모은다 */
function categoriesOf(area, now, isDone) {
  const m = new Map();
  ROWS.filter(r => r.a === area).forEach(r => {
    if (!m.has(r.cat)) m.set(r.cat, { cat: r.cat, rows: [], items: [], cyc: {} });
    const g = m.get(r.cat);
    g.rows.push(r);
    if (!g.items.includes(r.item)) g.items.push(r.item);
    g.cyc[r.c] = (g.cyc[r.c] || 0) + 1;
  });
  const list = [...m.values()];
  // 화면 순서 바꾸기 (액션 id 가 원본 순서에 묶여 있어 표시 순서만 바꾼다)
  const last = CAT_ORDER[area]?.last || [];
  list.sort((x, y) => last.indexOf(x.cat) - last.indexOf(y.cat));   // 목록에 없는 카테고리(-1)는 원래 순서 유지
  return list.map(g => {
    const due = g.rows.filter(r => isDue(r.c, now));
    return { ...g, due: due.length, left: due.filter(r => !isDone(r)).length, done: g.rows.filter(isDone).length };
  });
}

function AreaPage({ area }) {
  const { store, isDone, now, openCat } = useCtx();
  const boards = store.goals?.boards || {};
  const goalsOf = c => (hasGoals(area, c) && boards[boardKey(area, c)] ? boardForYear(boards[boardKey(area, c)], now.getFullYear()).items.filter(i => !i.parent).length : 0);
  const cats = categoriesOf(area, now, isDone);
  return (
    <>
      <header className="page-h" style={{ '--ac': areaVar(area) }}>
        <h1 className="area-title">{AREAS[area].n}</h1>
      </header>
      <div className="tiles" style={{ '--ac': areaVar(area) }}>
        {cats.map(g => (
          <button key={g.cat} className="tile" onClick={() => openCat(area, g.cat)}>
            <span className="tile-h"><b>{g.cat}</b>{isFirstReviewed(area, g.cat) ? <span className="tile-done first" title="1차 검수 완료">1차 검수</span> : hasCustomView(area, g.cat) && <span className="tile-done" title="전용 상세 화면 완료">완료</span>}{store.reviewed?.[`${area}|${g.cat}`] && <span className="tile-rev" title="검수 완료">검수 완료</span>}<span className="tile-go" aria-hidden="true">›</span></span>
            <span className="tile-items">{g.items.slice(0, 5).map(it => <span key={it} className="tile-item">{it}</span>)}{g.items.length > 5 && <span className="tile-item more">외 {g.items.length - 5}</span>}</span>
            <span className="tile-cyc">{Object.keys(CYCLES).filter(c => g.cyc[c]).map(c => <span key={c} className={`cyc c-${c}`}>{CYCLES[c].slice(0, 2)} {g.cyc[c]}</span>)}
              {goalsOf(g.cat) > 0 && <span className="cyc goal">{now.getFullYear()}년 목표 {goalsOf(g.cat)}</span>}</span>
            <span className="tile-f">
              <span className={g.left ? 'tile-left' : 'muted'}>{g.due ? (g.left ? `오늘 남은 ${g.left}개` : '오늘 할 일 완료') : '오늘 도래 없음'}</span>
              <span className="muted">액션 {g.rows.length}</span>
            </span>
            <span className="pbar"><i style={{ width: `${g.rows.length ? g.done / g.rows.length * 100 : 0}%` }} /></span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ───────────────────────── 상세: 카테고리 페이지 ───────────────────────── */
function CategoryPage({ area, cat }) {
  const { now, isDone, openCat, go, store, setStore } = useCtx();
  const cats = categoriesOf(area, now, isDone);
  const rkey = `${area}|${cat}`, reviewed = !!store.reviewed?.[rkey];
  const toggleReviewed = () => setStore(s => { const r = { ...(s.reviewed || {}) }; if (r[rkey]) delete r[rkey]; else r[rkey] = iso(new Date()); return { ...s, reviewed: r }; });
  const g = cats.find(x => x.cat === cat);
  if (!g) return <div className="empty">카테고리를 찾을 수 없습니다. <button className="btn sm" onClick={() => go(area)}>{AREAS[area].n} 화면으로 돌아가기</button></div>;
  const View = viewFor(area, cat);
  return (
    <>
      <nav className="crumb" aria-label="위치">
        <button onClick={() => go(area)}>{AREAS[area].n}</button><span aria-hidden="true">›</span><b>{cat}</b>
        <button className={`btn sm review-btn ${reviewed ? 'on' : ''}`} onClick={toggleReviewed} aria-pressed={reviewed}
          title={reviewed ? `검수 완료 (${store.reviewed[rkey]}) · 누르면 취소` : '마음에 들면 검수 완료로 표시'}>{reviewed ? '검수 완료됨' : '검수 완료로 표시'}</button>
      </nav>
      <View area={area} cat={cat} group={g} />
      {cat !== '목표 관리' && hasGoals(area, cat) && <GoalBoard area={area} cat={cat} title={`${cat} 목표`} />}
    </>
  );
}

/* ───────────────────────── 진행 현황 ───────────────────────── */
function Progress() {
  const { isDone, store, setStore, now } = useCtx();
  return (
    <>
      <header className="page-h"><h1>진행 현황</h1><p>영역과 주기별 완료 수입니다. 현재 기간({iso(now)}) 기준입니다.</p></header>
      <div className="panel tablewrap">
        <table className="prog">
          <thead><tr><th>영역</th>{Object.values(CYCLES).map(n => <th key={n}>{n}</th>)}</tr></thead>
          <tbody>{Object.entries(AREAS).map(([a, v]) => (
            <tr key={a} style={{ '--ac': areaVar(a) }}><td><i className="dot" /> <b>{v.n}</b></td>
              {Object.keys(CYCLES).map(c => {
                const rs = ROWS.filter(r => r.a === a && r.c === c), d = rs.filter(isDone).length;
                return <td key={c}>{d}/{rs.length}<div className="pbar"><i style={{ width: `${rs.length ? d / rs.length * 100 : 0}%` }} /></div></td>;
              })}</tr>))}</tbody>
        </table>
      </div>
      <CycleSummary c="D" title="일일체크 요약" note="카테고리별 진행과 남은 항목 (우선순위순)" />
      <CycleSummary c="S" title="수시체크 요약" note="필요할 때 체크하는 항목 · 오늘 기준" />
      <div className="prog-2">
      <div className="panel">
        <h2>실행 로그</h2>
        {store.log.length ? <ul className="log">{store.log.slice(0, 20).map((l, i) => <li key={i}><time>{l.at}</time><span>{AREAS[l.a].n} · {l.item} · {l.action} <b>{l.ty}</b></span></li>)}</ul> : <p className="muted">아직 실행한 항목이 없습니다.</p>}
        {store.log.length > 0 && <button className="btn sm" onClick={() => setStore(s => ({ ...s, log: [] }))}>로그 지우기</button>}
      </div>
      <NeedsPanel />
      </div>
    </>
  );
}

/* ───────────────────────── 설정 ───────────────────────── */
function Settings() {
  const { store, setStore } = useCtx();
  const [arm, setArm] = useState(false);
  const rules = { ...DEFAULT_RULES, ...store.rules };
  const setRule = (k, v) => setStore(s => ({ ...s, rules: { ...DEFAULT_RULES, ...s.rules, [k]: v } }));
  const isDefault = Object.keys(DEFAULT_RULES).every(k => String(rules[k]) === String(DEFAULT_RULES[k]));
  const reset = () => {
    if (!arm) { setArm(true); setTimeout(() => setArm(false), 3000); return; }
    setStore(seedAll()); setArm(false);
  };
  const days = n => Array.from({ length: n }, (_, i) => i + 1);
  const yearDays = new Date(2025, Number(rules.yearMonth), 0).getDate();   // 윤년 아닌 해 기준
  return (
    <>
      <header className="page-h"><h1>설정</h1><p>정기 체크가 도래하는 날과 데이터를 관리합니다. 바꾸면 대시보드, 캘린더, 체크리스트에 바로 반영됩니다.</p></header>
      <div className="panel">
        <div className="csum-h"><h2>체크 주기 규칙</h2>
          <button className="btn sm" disabled={isDefault} onClick={() => setStore(s => ({ ...s, rules: DEFAULT_RULES }))}>기본값으로</button></div>
        <table className="prog rules"><tbody>
          <tr><td>일일체크-루틴</td><td>매일</td></tr>
          <tr><td>수시체크</td><td>필요할 때 (체크리스트에서 주기 버튼으로 켜기)</td></tr>
          <tr><td>주간체크</td><td><div className="rule-in">매주
            <select value={rules.weekDay} onChange={e => setRule('weekDay', Number(e.target.value))} aria-label="주간체크 요일">
              {WEEK.map((w, i) => <option key={w} value={i}>{w}요일</option>)}</select></div></td></tr>
          <tr><td>월간체크</td><td><div className="rule-in">매월
            <select value={rules.monthDay} onChange={e => setRule('monthDay', e.target.value === 'last' ? 'last' : Number(e.target.value))} aria-label="월간체크 기준일">
              <option value="last">말일</option>{days(31).map(d => <option key={d} value={d}>{d}일</option>)}</select></div></td></tr>
          <tr><td>년간체크</td><td><div className="rule-in">매년
            <select value={rules.yearMonth} onChange={e => setRule('yearMonth', Number(e.target.value))} aria-label="년간체크 월">
              {days(12).map(m => <option key={m} value={m}>{m}월</option>)}</select>
            <select value={Math.min(rules.yearDay, yearDays)} onChange={e => setRule('yearDay', Number(e.target.value))} aria-label="년간체크 일">
              {days(yearDays).map(d => <option key={d} value={d}>{d}일</option>)}</select></div></td></tr>
        </tbody></table>
        <p className="note">기본값: 주간 일요일, 월간 말일, 년간 12월 30일. 월간 기준일이 없는 달(예: 31일)은 그 달 말일에 도래합니다.</p>
      </div>
      <div className="panel">
        <h2>데이터</h2>
        <p className="muted">체크 상태, 일정, 기념일, 건강 기록, 설정은 이 브라우저에만 저장됩니다.</p>
        <button className={`btn ${arm ? 'danger' : ''}`} onClick={reset}>{arm ? '정말 초기화할까요?' : '모든 데이터 초기화'}</button>
      </div>
    </>
  );
}

/* ───────────────────────── 결과 패널 (시뮬레이션) ───────────────────────── */
/** 예시 응답 JSON. 1,000 이상 숫자는 쉼표를 넣어 보여준다 (year 같은 연도 값은 그대로) */
const prettyJson = b => JSON.stringify(b, null, 2)
  .replace(/("([^"]+)":\s*)(-?\d{4,})(?=[,\n}])/g, (m, pre, key, n) => (/year/i.test(key) ? m : pre + num(n)));

function Drawer({ panel, onClose }) {
  const { finish, store } = useCtx();
  const { row } = panel;
  const [memo, setMemo] = useState(store.outs[row.id]?.memo || '');
  const STEPS = ['인증 확인', '요청 전송', '응답 수신'];
  return (
    <aside className="drawer" role="dialog" aria-label="실행 결과">
      <div className="drawer-h"><h2>{row.action} <span className={`badge ${row.code}`}>{row.ty}</span></h2><button className="btn sm" onClick={onClose}>닫기</button></div>
      <div className="kv">{AREAS[row.a].n} · {CYCLES[row.c]} · {row.cat} › {row.item}</div>
      <div className="kv">자동화 내용: {row.detail}</div>
      {panel.kind === 'api' && (<>
        <ul className="steps">{STEPS.map((s, i) => <li key={s} className={i < panel.step ? 'ok' : i === panel.step ? 'run' : ''}>{s}</li>)}</ul>
        {panel.res && <><div className="kv"><code>{panel.res.m}</code> <code>{panel.res.e}</code></div><pre>{prettyJson(panel.res.b)}</pre></>}
      </>)}
      {panel.kind === 'ai' && <div className="ai-out">{panel.text || 'AI가 생성 중…'}</div>}
      {panel.kind === 'manual' && (<>
        <p className="kv">자동화 없이 직접 입력하는 항목입니다.</p>
        <textarea rows={4} value={memo} onChange={e => setMemo(e.target.value)} placeholder="기록 내용을 입력하세요" aria-label="메모" />
        <button className="btn primary" onClick={() => { finish(row, { t: '없음', memo: memo.trim() }); onClose(); }}>완료 처리</button>
      </>)}
      {panel.kind !== 'manual' && <p className="note">{panel.saved ? '이전에 실행한 예시 결과입니다. ' : ''}화면 시연용 예시이며 실제 서비스와 연결되어 있지 않습니다.</p>}
    </aside>
  );
}
