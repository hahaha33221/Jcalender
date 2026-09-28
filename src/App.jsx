import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AREAS, CYCLES, ROWS, PRIO, defaultPrio, isDue, iso, pad, periodKey } from './data.js';
import { mockAi, mockApi } from './mock.js';

/* ───────────────────────── 공통 ───────────────────────── */
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SENS = /검진|결과지|급여|명세|계약|명함|공제/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hhmm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const areaVar = a => (AREAS[a] ? `var(${AREAS[a].v})` : 'var(--ink3)');

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
const INIT = { done: {}, outs: {}, prio: {}, events: null, log: [], settings: { weekDay: 0, monthDay: 'last' } };

function useStore() {
  const [store, setStore] = useState(() => {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* 저장소 사용 불가 또는 손상 */ }
    const merged = { ...INIT, ...(v || {}) };
    return { ...merged, events: merged.events ?? seedEvents() };
  });
  const [persist, setPersist] = useState(true);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { setPersist(false); }
  }, [store]);
  return [store, setStore, persist];
}

const Ctx = createContext(null);
const useCtx = () => useContext(Ctx);

/* ───────────────────────── 앱 ───────────────────────── */
export default function App() {
  const [store, setStore, persist] = useStore();
  const [page, setPage] = useState('home');
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

  const ctx = { store, setStore, now, todayStr, isDone, prioOf, cyclePrio, toggle, run, runMany, view, finish, busy, setPanel };
  const remaining = ROWS.filter(r => isDue(r.c, now, store.settings) && !isDone(r)).length;
  const areaLeft = a => ROWS.filter(r => r.a === a && isDue(r.c, now, store.settings) && !isDone(r)).length;

  const NAV = [
    { id: 'home', label: '오늘 체크리스트', badge: remaining },
    { sec: '상세 내용' },
    { id: 'P', label: AREAS.P.n, color: areaVar('P'), badge: areaLeft('P') },
    { id: 'B', label: AREAS.B.n, color: areaVar('B'), badge: areaLeft('B') },
    { id: 'W', label: AREAS.W.n, color: areaVar('W'), badge: areaLeft('W') },
    { sec: '관리' },
    { id: 'progress', label: '진행 현황' },
    { id: 'settings', label: '설정' },
  ];

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <aside className="nav" aria-label="주 메뉴">
          <div className="brand"><b>생활 관리</b><span>{now.getFullYear()}.{pad(now.getMonth() + 1)}.{pad(now.getDate())} ({WEEK[now.getDay()]})</span></div>
          <nav>
            {NAV.map((n, i) => n.sec
              ? <div className="nav-sec" key={i}>{n.sec}</div>
              : <button key={n.id} className={page === n.id ? 'on' : ''} aria-current={page === n.id ? 'page' : undefined} style={n.color ? { '--ac': n.color } : undefined} onClick={() => setPage(n.id)}>
                  {n.color && <i className="dot" />}<span>{n.label}</span>{n.badge > 0 && <em title="오늘 남은 항목">{n.badge}</em>}
                </button>)}
          </nav>
          <p className="nav-foot">숫자는 오늘 도래한 주기 중 남은 항목입니다.</p>
        </aside>
        <main className="main">
          {!persist && <p className="banner">이 브라우저에서는 데이터가 저장되지 않습니다. 새로고침하면 진행 상태가 사라집니다.</p>}
          {page === 'home' && <Home />}
          {AREAS[page] && <AreaPage key={page} area={page} />}
          {page === 'progress' && <Progress />}
          {page === 'settings' && <Settings />}
        </main>
        {panel && <Drawer key={`${panel.row.id}-${panel.kind}`} panel={panel} onClose={() => setPanel(null)} />}
        <div className="pushes" aria-live="polite">{pushes.map(p => <div className="push" key={p.id}><b>{p.title}</b><span>{p.body}</span></div>)}</div>
      </div>
    </Ctx.Provider>
  );
}

/* ───────────────────────── 홈: 오늘 체크리스트 ───────────────────────── */
function Home() {
  const { now } = useCtx();
  const [sel, setSel] = useState(iso(now));
  return (
    <>
      <header className="page-h"><h1>오늘 체크리스트</h1><p>{now.getFullYear()}년 {now.getMonth() + 1}월 {now.getDate()}일 {WEEK[now.getDay()]}요일 · 일정 확인 후 우선순위 순으로 체크하세요.</p></header>
      <Calendar sel={sel} setSel={setSel} />
      <Checklist />
    </>
  );
}

/* 일정관리 캘린더 */
function Calendar({ sel, setSel }) {
  const { store, setStore, now, todayStr } = useCtx();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [form, setForm] = useState({ title: '', time: '', area: 'P' });
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
  const addEvent = e => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setStore(s => ({ ...s, events: [...s.events, { id: uid(), date: sel, time: form.time, title: form.title.trim(), area: form.area }] }));
    setForm({ ...form, title: '', time: '' });
  };
  const delEvent = id => setStore(s => ({ ...s, events: s.events.filter(x => x.id !== id) }));
  const selDate = new Date(sel + 'T00:00:00');
  const dueCycles = Object.keys(CYCLES).filter(c => c !== 'S' && isDue(c, selDate, store.settings));
  const list = byDate[sel] || [];

  return (
    <section className="cal" aria-label="일정 캘린더">
      <div className="cal-main">
        <div className="cal-h">
          <h2>{ym.y}년 {ym.m + 1}월</h2>
          <div className="btns"><button className="btn sm" onClick={() => move(-1)} aria-label="이전 달">이전</button><button className="btn sm" onClick={goToday}>오늘</button><button className="btn sm" onClick={() => move(1)} aria-label="다음 달">다음</button></div>
        </div>
        <div className="cal-grid" role="grid">
          {WEEK.map((w, i) => <div key={w} className={`cal-dow ${i === 0 ? 'sun' : ''}`}>{w}</div>)}
          {cells.map(d => {
            const k = iso(d), evs = byDate[k] || [];
            return (
              <button key={k} role="gridcell" className={`cal-cell ${d.getMonth() !== ym.m ? 'out' : ''} ${k === todayStr ? 'today' : ''} ${k === sel ? 'sel' : ''}`} onClick={() => setSel(k)} aria-label={`${d.getMonth() + 1}월 ${d.getDate()}일 일정 ${evs.length}건`}>
                <span className="cal-n">{d.getDate()}</span>
                {evs.slice(0, 2).map(e => <span key={e.id} className="cal-ev" style={{ '--ac': areaVar(e.area) }}>{e.time && <small>{e.time}</small>} {e.title}</span>)}
                {evs.length > 2 && <span className="cal-more">+{evs.length - 2}건</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="cal-side">
        <h2>{selDate.getMonth() + 1}월 {selDate.getDate()}일 ({WEEK[selDate.getDay()]}) 일정</h2>
        {dueCycles.length > 1 && <p className="due-note">이 날은 {dueCycles.filter(c => c !== 'D').map(c => CYCLES[c]).join(', ')}일입니다.</p>}
        {list.length ? <ul className="agenda">{list.map(e => (
          <li key={e.id} style={{ '--ac': areaVar(e.area) }}><i className="dot" /><span className="tm">{e.time || '종일'}</span><span className="grow">{e.title}</span>
            <button className="btn sm" onClick={() => delEvent(e.id)} aria-label={`${e.title} 삭제`}>삭제</button></li>))}</ul>
          : <p className="muted">등록된 일정이 없습니다.</p>}
        <form className="ev-form" onSubmit={addEvent}>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="일정 제목" aria-label="일정 제목" />
          <div className="row2">
            <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} aria-label="시간" />
            <select value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} aria-label="영역">
              {Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v.n}</option>)}
            </select>
          </div>
          <button className="btn primary">일정 추가</button>
        </form>
      </div>
    </section>
  );
}

/* 카테고리별·우선순위순 체크리스트 (길게 스크롤) */
function Checklist() {
  const { store, now, isDone, prioOf, runMany, busy } = useCtx();
  const [cyc, setCyc] = useState(null);           // null 이면 도래한 주기를 자동으로 사용
  const [area, setArea] = useState('ALL');
  const [status, setStatus] = useState('TODO');
  const [sort, setSort] = useState('PRIO');
  const [q, setQ] = useState('');
  const auto = useMemo(() => new Set(Object.keys(CYCLES).filter(c => isDue(c, now, store.settings))), [now, store.settings]);
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
            <div className="group-h"><i className="dot" /><h3>{AREAS[g.a].n.replace('활동', '')} · {g.cat}</h3>
              {g.score < 4 && <span className={`prio p${g.score}`}>{PRIO[g.score]}</span>}<span className="muted">{gd}/{g.rows.length}</span></div>
            {g.rows.map(x => <ActionRow key={x.r.id} row={x.r} showCycle />)}
          </div>
        );
      })}
    </section>
  );
}

/* 액션 한 줄 */
function ActionRow({ row, showCycle }) {
  const { isDone, prioOf, cyclePrio, toggle, run, view, busy } = useCtx();
  const done = isDone(row), p = prioOf(row), sens = SENS.test(`${row.item} ${row.action} ${row.detail}`);
  const name = row.action.replace(' (제안)', '');
  return (
    <div className={`row ${done ? 'done' : ''}`} style={{ '--ac': areaVar(row.a) }}>
      <input type="checkbox" checked={done} disabled={busy} onChange={() => toggle(row)} aria-label={`${name} 완료`} />
      <div className="act"><b>{name}</b>{row.action.includes('(제안)') && <span className="tag">제안</span>}{sens && <span className="tag sens">민감정보</span>}
        <div className="sub">{row.item}{showCycle && ` · ${CYCLES[row.c]}`}</div></div>
      <span className={`badge ${row.code}`}>{row.ty}</span>
      <button className={`prio p${p}`} onClick={() => cyclePrio(row)} title="눌러서 우선순위 변경">{PRIO[p]}</button>
      <div className="det">{row.detail}</div>
      <div className="btns">{done
        ? <button className="btn sm" onClick={() => view(row)}>결과</button>
        : <button className="btn sm primary" disabled={busy} onClick={() => run(row)}>{row.ty === '없음' ? '메모' : '실행'}</button>}</div>
    </div>
  );
}

/* ───────────────────────── 상세: 영역 페이지 ───────────────────────── */
function AreaPage({ area }) {
  const { isDone, now, store } = useCtx();
  const [cyc, setCyc] = useState('D');
  const [type, setType] = useState('ALL');
  const [q, setQ] = useState('');
  const all = ROWS.filter(r => r.a === area && r.c === cyc);
  const rows = all.filter(r => (type === 'ALL' || r.ty === type) && (!q || `${r.cat} ${r.item} ${r.action} ${r.detail}`.toLowerCase().includes(q.toLowerCase())));
  const done = all.filter(isDone).length;
  const cnt = t => all.filter(r => r.ty === t).length;
  const tree = [];
  rows.forEach(r => {
    let c = tree.find(x => x.cat === r.cat); if (!c) tree.push(c = { cat: r.cat, items: [] });
    let it = c.items.find(x => x.item === r.item); if (!it) c.items.push(it = { item: r.item, rows: [] });
    it.rows.push(r);
  });
  return (
    <>
      <header className="page-h" style={{ '--ac': areaVar(area) }}><h1 className="area-title">{AREAS[area].n}</h1><p>주기별 상세 액션입니다. 체크 상태는 {CYCLES[cyc]}의 현재 기간({periodKey(cyc, now)}) 기준입니다.</p></header>
      <div className="tabs" role="tablist" style={{ '--ac': areaVar(area) }}>
        {Object.entries(CYCLES).map(([k, n]) => <button key={k} role="tab" aria-selected={k === cyc} onClick={() => setCyc(k)}>{n} <small>{ROWS.filter(r => r.a === area && r.c === k).length}</small></button>)}
      </div>
      <div className="bar">
        <div className="chips" role="group" aria-label="자동화 유형">
          {[['ALL', '전체'], ['API', 'API'], ['AI', 'AI'], ['없음', '없음']].map(([k, l]) => <button key={k} aria-pressed={type === k} onClick={() => setType(k)}>{l}</button>)}
        </div>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="액션·내용 검색" aria-label="검색" />
        <span className="muted grow-r">완료 {done}/{all.length} · API {cnt('API')} · AI {cnt('AI')} · 없음 {cnt('없음')}{cyc === 'S' ? '' : isDue(cyc, now, store.settings) ? ' · 오늘 도래' : ''}</span>
      </div>
      {tree.length === 0 && <div className="empty">조건에 맞는 액션이 없습니다.</div>}
      {tree.map(c => (
        <div className="group" key={c.cat} style={{ '--ac': areaVar(area) }}>
          <div className="group-h"><i className="dot" /><h3>{c.cat}</h3></div>
          {c.items.map(it => <div key={it.item}><div className="item">{it.item}</div>{it.rows.map(r => <ActionRow key={r.id} row={r} />)}</div>)}
        </div>
      ))}
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
      <div className="panel">
        <h2>실행 로그</h2>
        {store.log.length ? <ul className="log">{store.log.slice(0, 20).map((l, i) => <li key={i}><time>{l.at}</time><span>{AREAS[l.a].n} · {l.item} · {l.action} <b>{l.ty}</b></span></li>)}</ul> : <p className="muted">아직 실행한 항목이 없습니다.</p>}
        {store.log.length > 0 && <button className="btn sm" onClick={() => setStore(s => ({ ...s, log: [] }))}>로그 지우기</button>}
      </div>
    </>
  );
}

/* ───────────────────────── 설정 ───────────────────────── */
function Settings() {
  const { store, setStore } = useCtx();
  const [arm, setArm] = useState(false);
  const set = (k, v) => setStore(s => ({ ...s, settings: { ...s.settings, [k]: v } }));
  const reset = () => {
    if (!arm) { setArm(true); setTimeout(() => setArm(false), 3000); return; }
    setStore({ ...INIT, events: seedEvents() }); setArm(false);
  };
  return (
    <>
      <header className="page-h"><h1>설정</h1><p>주간·월간 체크가 오늘 체크리스트에 나타나는 날을 정합니다.</p></header>
      <div className="panel form">
        <label>주간체크 요일<select value={store.settings.weekDay} onChange={e => set('weekDay', Number(e.target.value))}>{WEEK.map((w, i) => <option key={w} value={i}>{w}요일</option>)}</select></label>
        <label>월간체크 기준일<select value={store.settings.monthDay} onChange={e => set('monthDay', e.target.value)}>
          <option value="last">매월 말일</option><option value="1">매월 1일</option><option value="15">매월 15일</option><option value="25">매월 25일</option></select></label>
        <p className="muted">년간체크는 12월 31일에 나타납니다. 수시체크는 홈에서 주기 버튼으로 직접 켭니다.</p>
      </div>
      <div className="panel">
        <h2>데이터</h2>
        <p className="muted">체크 상태, 일정, 우선순위 설정은 이 브라우저에만 저장됩니다.</p>
        <button className={`btn ${arm ? 'danger' : ''}`} onClick={reset}>{arm ? '정말 초기화할까요?' : '모든 데이터 초기화'}</button>
      </div>
    </>
  );
}

/* ───────────────────────── 결과 패널 (시뮬레이션) ───────────────────────── */
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
        {panel.res && <><div className="kv"><code>{panel.res.m}</code> <code>{panel.res.e}</code></div><pre>{JSON.stringify(panel.res.b, null, 2)}</pre></>}
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
