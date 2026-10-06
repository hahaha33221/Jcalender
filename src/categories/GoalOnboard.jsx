import React, { useEffect, useMemo, useState } from 'react';
import { AREAS, CATS, iso, parseCyc } from '../data.js';
import { Popup, useCtx } from '../shared.jsx';
import { GOAL_TOPICS, HOURS, LEVELS, recommend } from './goalRecs.js';
import { EMPTY, addDays, boardForYear, boardKey, childrenOf, daysBetween, delItem, hasGoals, progressOf, seedGoals, toDate } from './goals.js';
import { leafFor } from './GoalView.jsx';

/* 목표 관리 온보딩 (팝업) — 목표를 추천받는 순서
   - 처음: ① 기간 설정 → ② 온보딩(이루고 싶은 것 · 지금 수준 · 쓸 수 있는 시간) → ③ 목표 추천(목표 · 마일스톤 · 할 일, 고르고 이름 고치기) → 저장
   - 매월 1일부터 (그 달에 아직 안 했으면): 지난달 돌아보기(못 끝낸 것: 이번 달로 미루기 · 그대로 · 지우기) → 위와 같은 순서 (기간 기본값 이번 달, 지난번 답을 기억)
   추천 규칙: goalRecs.js
   store.goalOnboard = { [영역]: { setupAt: 'YYYY-MM-DD', months: { 'YYYY-MM': 'done' | 'skip' }, answers: { topics, level, hours, period } } } */
const uid = () => Math.random().toString(36).slice(2, 10);
const ym = d => d.slice(0, 7);
const monthEnd = d => { const x = toDate(`${ym(d)}-01`); x.setMonth(x.getMonth() + 1); x.setDate(0); return iso(x); };
const addMonths = (d, n) => { const x = toDate(d); x.setMonth(x.getMonth() + n); x.setDate(x.getDate() - 1); return iso(x); };
const prevMonth = d => { const x = toDate(`${ym(d)}-01`); x.setMonth(x.getMonth() - 1); return ym(iso(x)); };
const catLabel = c => (c === '목표 관리' ? '영역 공통' : c);
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

/** 이 영역에서 지금 온보딩이 필요한가: 'setup'(처음) · 'month'(이번 달 점검) · null */
export function goalOnboardNeed(store, area, today) {
  const ob = store.goalOnboard?.[area];
  if (!ob?.setupAt) return 'setup';
  if (ym(ob.setupAt) === ym(today) || ob.months?.[ym(today)]) return null;   // 처음 설정한 달은 점검하지 않음
  return 'month';
}
/** 목표를 둘 수 있는 카테고리 (영역 공통이 먼저) */
const goalCats = area => ['목표 관리', ...new Set(CATS.filter(r => r.a === area && r.cat !== '목표 관리').map(r => r.cat))].filter(c => hasGoals(area, c));

export default function GoalOnboard({ area, mode, onClose }) {
  const { store, setStore, now, sync } = useCtx();
  const today = iso(now), year = now.getFullYear(), mEnd = monthEnd(today), last = prevMonth(today);
  const goals0 = store.goals?.v === 2 ? store.goals : seedGoals(now);
  const cats = goalCats(area);
  const boards = Object.fromEntries(cats.map(c => [c, goals0.boards[boardKey(area, c)] || EMPTY]));
  const isEx = n => /\(예시\)\s*$/.test(n);
  const saved = store.goalOnboard?.[area]?.answers || {};

  // 이미 있는 올해 목표
  const existing = useMemo(() => cats.flatMap(c => boardForYear(boards[c], year).items.filter(i => !i.parent).map(i => ({ key: i.id, cat: c, name: i.name, end: i.end, ex: isEx(i.name) }))), []);
  const hasEx = existing.some(g => g.ex);
  const [clearEx, setClearEx] = useState(mode === 'setup' && hasEx);

  // 지난달 돌아보기 (월간 점검): 못 끝낸 마일스톤 · 작업
  const review0 = useMemo(() => {
    if (mode !== 'month') return [];
    const out = [];
    cats.forEach(c => {
      const b = boards[c], leaf = leafFor(area, c, store.done);
      b.miles.filter(m => ym(m.date) === last).forEach(m => { const done = !!m.link && b.items.some(i => i.id === m.link) && progressOf(b.items, m.link, leaf) >= 100; if (!done) out.push({ id: m.id, kind: 'mile', cat: c, name: m.name, date: m.date, act: 'move' }); });
      b.items.filter(i => i.parent && !childrenOf(b.items, i.id).length && i.end && ym(i.end) === last).forEach(i => { const p = progressOf(b.items, i.id, leaf); if (p < 100) out.push({ id: i.id, kind: 'task', cat: c, name: i.name, date: i.end, p, act: 'move' }); });
    });
    return out;
  }, []);
  const [review, setReview] = useState(review0);
  const doneLast = useMemo(() => (mode !== 'month' ? 0 : cats.reduce((n, c) => n + boards[c].miles.filter(m => ym(m.date) === last).length, 0) - review0.filter(r => r.kind === 'mile').length), []);

  // ① 기간
  const PERIODS = [['month', '이번 달', mEnd], ['3m', '3개월', addMonths(today, 3)], ['6m', '6개월', addMonths(today, 6)], ['year', '올해 말까지', `${year}-12-31`], ['custom', '직접 정하기', null]];
  const [period, setPeriod] = useState(() => { const k = mode === 'month' ? 'month' : saved.period && saved.period !== 'custom' ? saved.period : '3m'; return { kind: k, start: today, end: PERIODS.find(p => p[0] === k)[2] }; });
  const days = Math.max(1, daysBetween(period.start, period.end) + 1), months = Math.max(1, Math.round(days / 30.4));
  // ② 온보딩 질문
  const topicsAll = GOAL_TOPICS.filter(t => t.a === area);
  const [topics, setTopics] = useState(saved.topics?.filter(id => topicsAll.some(t => t.id === id)) || []);
  const [level, setLevel] = useState(saved.level ?? 1);
  const [hours, setHours] = useState(saved.hours ?? 1);
  // ③ 추천
  const ctx = { days, months, level, hours };
  const recs = useMemo(() => recommend(area, topics, ctx, c => cats.includes(c)), [topics.join(), level, hours, days]);
  const [pick, setPick] = useState({});                     // key → false 면 뺌
  const [names, setNames] = useState({});                   // key → 고친 이름
  const [own, setOwn] = useState([]);                       // 직접 넣은 목표 [{ key, cat, name }]
  const chosen = [...recs.filter(g => pick[g.key] !== false).map(g => ({ ...g, name: (names[g.key] ?? g.name).trim() })), ...own.filter(g => g.name.trim()).map(g => ({ ...g, name: g.name.trim(), miles: [], tasks: [] }))].filter(g => g.name);
  const at = f => addDays(period.start, Math.round(f * (days - 1)));
  const [note, setNote] = useState(saved.note || '');         // AI 에게 더 알려 줄 것
  // ③ 상세 To do: 목표마다 { src: rule | ai, milestones: [{ key, name, date, on }], todos: [{ key, name, start, end, how, on }] }
  const [plan, setPlan] = useState({});
  useEffect(() => { setPlan({}); }, [period.start, period.end]);   // 기간이 바뀌면 다시 계산
  const [ai, setAi] = useState({ busy: false, msg: '', bad: false });
  const ruleOf = g => ({ src: 'rule', milestones: g.miles.map(([n, f]) => ({ key: uid(), name: n, date: at(f), on: true })), todos: g.tasks.map(([n, f0, f1]) => ({ key: uid(), name: n, start: at(f0), end: at(f1), how: '', on: true })) });
  const planOf = g => plan[g.key] || ruleOf(g);
  const setPart = (g, kind, key, patch) => setPlan(v => { const cur = v[g.key] || planOf(g); return { ...v, [g.key]: { ...cur, [kind]: cur[kind].map(x => (x.key === key ? { ...x, ...patch } : x)) } }; });
  const addPart = (g, kind) => setPlan(v => { const cur = v[g.key] || planOf(g); const x = kind === 'todos' ? { key: uid(), name: '', start: period.start, end: period.end, how: '', on: true } : { key: uid(), name: '', date: period.end, on: true }; return { ...v, [g.key]: { ...cur, [kind]: [...cur[kind], x] } }; });
  const askAi = async () => {
    setAi({ busy: true, msg: '', bad: false });
    try {
      const r = await sync.request('/api/goals/todos', { method: 'POST', body: { area, start: period.start, end: period.end, level, hours, note, goals: chosen.map(g => ({ name: g.name, cat: catLabel(g.cat) })) } });
      setPlan(Object.fromEntries(chosen.map((g, i) => { const x = r.goals[i] || { milestones: [], todos: [] }; return [g.key, { src: 'ai', milestones: x.milestones.map(m => ({ ...m, key: uid(), on: true })), todos: x.todos.map(t => ({ ...t, key: uid(), on: true })) }]; })));
      setAi({ busy: false, msg: `AI(${r.model})가 상세 To do 를 만들었어요${r.left != null ? ` · 오늘 ${r.left}번 더 받을 수 있음` : ''}`, bad: false });
    } catch (e) { setAi({ busy: false, msg: e.status === 404 ? '서버를 업데이트하면 AI 추천을 쓸 수 있습니다 (기본 추천은 그대로 사용)' : e.message, bad: true }); }
  };

  // 맨 처음: 목표별 To do 추천받기 / 루틴 입력 중 하나
  const [choice, setChoice] = useState(null);                // 'todo' | 'routine'
  const steps = choice === 'routine' ? ['start', 'routine', 'rdone'] : mode === 'month' ? ['start', 'review', 'period', 'ask', 'todos', 'done'] : ['start', 'period', 'ask', 'todos', 'done'];
  // 루틴: 체크리스트에 내 항목으로 들어가고, 목표에 연결하면 그 목표 아래 작업(진행률 = 이 루틴 체크)으로도 들어감
  const RCYC = [['D', '매일'], ['D:wd', '평일'], ['D:we', '주말'], ['W', '매주'], ['M', '매월']];
  const WD = '일월화수목금토';
  const blankR = (o = {}) => ({ key: uid(), action: '', c: 'D', wd: now.getDay(), time: '', end: '', goal: '', newGoal: '', ...o });
  /** 루틴 카테고리는 자동: 목표에 연결하면 그 목표의 카테고리(진행률에 잡히게), 아니면 영역 공통(목표 관리) */
  const autoCat = r => goalOpts.find(x => x.key === r.goal)?.cat || '목표 관리';   // 새 목표('__new')는 영역 공통에 만듦
  const goalName = r => (r.goal === '__new' ? r.newGoal.trim() : goalOpts.find(g => g.key === r.goal)?.name || '');
  const [routines, setRoutines] = useState([blankR()]);
  const [toCal, setToCal] = useState(true);                  // 기간 동안 대시보드 캘린더에 반복 일정으로
  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const timeTxt = r => (r.time ? `${r.time}${r.end && toMin(r.end) > toMin(r.time) ? `~${r.end}` : ''}` : '시간 없음');
  const cycTxt = r => (r.c === 'W' ? `매주 ${WD[r.wd]}요일` : r.c === 'M' ? `매월 ${Number(period.start.slice(8))}일` : RCYC.find(x => x[0] === r.c)[1]);
  /** 반복 일정의 첫 날: 매주는 기간 시작일부터 고른 요일 */
  const firstDate = r => { if (r.c !== 'W') return period.start; const d = toDate(period.start); d.setDate(d.getDate() + ((r.wd - d.getDay() + 7) % 7)); return iso(d); };
  const rList = routines.filter(r => r.action.trim());
  const setR = (key, patch) => setRoutines(v => v.map(x => (x.key === key ? { ...x, ...patch } : x)));
  const goalOpts = existing.filter(g => !g.ex);
  const saveRoutines = () => {
    setStore(s => {
      const cl = s.checklist || {};
      const cur = s.goals?.v === 2 ? s.goals : seedGoals(now);
      const bs = { ...cur.boards };
      // 루틴 입력에서 새로 적은 목표: 이름이 같으면 하나로, 영역 공통(목표 관리) 보드에 기간 동안의 목표로 만듦
      const made = {};
      rList.filter(r => r.goal === '__new' && r.newGoal.trim()).forEach(r => {
        const name = r.newGoal.trim();
        if (made[name]) return;
        const id = uid(), k = boardKey(area, '목표 관리'), b = bs[k] || { ...EMPTY };
        bs[k] = { ...b, items: [...b.items, { id, parent: null, name, start: period.start, end: period.end, progress: 0 }] };
        made[name] = { key: id, cat: '목표 관리', name, end: period.end };
      });
      const rows = rList.map(r => { const g = r.goal === '__new' ? made[r.newGoal.trim()] : goalOpts.find(x => x.key === r.goal); const cat = autoCat(r);
        return { row: { id: uid(), a: area, ...parseCyc(r.c), cat, item: cat, action: r.action.trim(), detail: `루틴 · ${cycTxt(r)}${r.time ? ` ${timeTxt(r)}` : ''} (목표 온보딩)`, ...(r.time ? { time: r.time } : {}) }, r, g }; });
      // 대시보드 캘린더: 기간 동안 반복 일정 (평일 · 주말은 그날만, 매주는 고른 요일, 매월은 시작일의 날짜)
      const evs = toCal ? rows.map(({ row, r }) => { const pc = parseCyc(r.c); return { id: uid(), date: firstDate(r), time: r.time || '', end: r.time && r.end && toMin(r.end) > toMin(r.time) ? r.end : '', title: row.action, area, memo: '루틴 (목표 온보딩)',
        repeat: { freq: pc.c, until: period.end, skip: [], ...(pc.days ? { days: pc.days } : {}) }, routineId: row.id }; }).filter(e => e.date <= period.end) : [];
      rows.filter(x => x.g).forEach(({ row, r, g }) => {
        const k = boardKey(area, g.cat), b = bs[k] || { ...EMPTY };   // (새 목표도 위에서 bs 에 넣었으므로 같은 보드에 붙음)
        bs[k] = { ...b, items: [...b.items, { id: uid(), parent: g.key, name: `${row.action} (${RCYC.find(x => x[0] === r.c)[1]})`, start: today, end: g.end, progress: 0, link: row.id }] };
      });
      const ob = s.goalOnboard?.[area] || {};
      return { ...s, checklist: { ...cl, custom: [...(cl.custom || []), ...rows.map(x => x.row)] }, goals: { ...cur, boards: bs }, events: [...(s.events || []), ...evs],
        goalOnboard: { ...(s.goalOnboard || {}), [area]: { ...ob, setupAt: ob.setupAt || today, months: { ...(ob.months || {}), [ym(today)]: 'done' } } } };
    });
    const newN = new Set(rList.filter(r => r.goal === '__new' && r.newGoal.trim()).map(r => r.newGoal.trim())).size;
    onClose(true, `루틴 ${rList.length}개를 체크리스트에 넣었습니다${newN ? ` · 새 목표 ${newN}개를 만들었습니다` : ''}${toCal ? ` · ${md(period.start)}~${md(period.end)} 대시보드 캘린더에 반복 일정으로 넣었습니다` : ''}${rList.some(r => goalName(r)) ? ' · 목표에 연결한 루틴은 체크할수록 목표 진행률이 올라갑니다' : ''}`);
  };
  const [si, setSi] = useState(0);
  const step = steps[si];
  const NAMES = { start: '시작 방식', routine: '루틴 입력', rdone: '확인 · 저장', review: '지난달 돌아보기', period: '기간 설정', ask: '온보딩 · 목표', todos: '상세 To do 추천', done: '확인 · 저장' };
  const canNext = step === 'start' ? !!choice : step === 'routine' ? rList.length > 0 : step === 'period' ? period.end >= period.start : step === 'ask' ? chosen.length > 0 : true;
  const nextLabel = step === 'start' && !choice ? '둘 중 하나를 골라 주세요' : step === 'routine' && !rList.length ? '루틴을 하나 이상 적어 주세요' : step === 'ask' && !topics.length && !own.some(g => g.name.trim()) ? '이루고 싶은 것을 하나 이상 골라 주세요' : step === 'ask' && !chosen.length ? '목표를 하나 이상 남겨 주세요' : step === 'ask' ? '상세 To do 추천 받기' : '다음';

  const markOnly = kind => setStore(s => {
    const ob = s.goalOnboard?.[area] || {};
    const next = kind === 'setup' ? { ...ob, setupAt: ob.setupAt || today } : { ...ob, setupAt: ob.setupAt || today, months: { ...(ob.months || {}), [ym(today)]: 'skip' } };
    return { ...s, goalOnboard: { ...(s.goalOnboard || {}), [area]: next } };
  });

  const save = () => {
    setStore(s => {
      const cur = s.goals?.v === 2 ? s.goals : seedGoals(now);
      const bs = { ...cur.boards };
      const B = c => (bs[boardKey(area, c)] ||= { ...EMPTY });
      if (clearEx) cats.forEach(c => {                       // 예시 목표 (달린 마일스톤도 함께) 지우기
        let b = B(c);
        const gone = b.items.filter(i => !i.parent && isEx(i.name)).map(i => i.id);
        b = { ...b, miles: b.miles.filter(m => !gone.includes(m.link)) };
        gone.forEach(id => { b = delItem(b, id); });
        bs[boardKey(area, c)] = b;
      });
      review.forEach(r => {                                   // 지난달 못 끝낸 것
        const k = boardKey(area, r.cat), b = bs[k];
        if (!b) return;
        if (r.kind === 'mile') bs[k] = { ...b, miles: r.act === 'del' ? b.miles.filter(m => m.id !== r.id) : r.act === 'move' ? b.miles.map(m => (m.id === r.id ? { ...m, date: mEnd } : m)) : b.miles };
        else if (r.act === 'del') bs[k] = delItem(b, r.id);
        else if (r.act === 'move') bs[k] = { ...b, items: b.items.map(i => (i.id === r.id ? { ...i, end: mEnd } : i)) };
      });
      chosen.forEach(g => {                                   // 목표 → 상세 To do(직접 체크하는 작업) · 마일스톤
        const b = B(g.cat), id = uid(), pl = planOf(g);
        const items = [{ id, parent: null, name: g.name, start: period.start, end: period.end, progress: 0 },
          ...pl.todos.filter(t => t.on && t.name.trim()).map(t => ({ id: uid(), parent: id, name: t.name.trim(), start: t.start, end: t.end, progress: 0, todo: true, done: false, ...(t.how ? { note: t.how } : {}) }))];
        const miles = pl.milestones.filter(m => m.on && m.name.trim()).map(m => ({ id: uid(), name: m.name.trim(), date: m.date, link: id, done: false }));
        bs[boardKey(area, g.cat)] = { ...b, items: [...b.items, ...items], miles: [...b.miles, ...miles] };
      });
      const ob = s.goalOnboard?.[area] || {};
      return { ...s, goals: { ...cur, boards: bs }, goalOnboard: { ...(s.goalOnboard || {}), [area]: { ...ob, setupAt: ob.setupAt || today, months: { ...(ob.months || {}), [ym(today)]: 'done' }, answers: { topics, level, hours, period: period.kind, note } } } };
    });
    onClose(true);
  };

  const Card = ({ on, onClick, title: t, sub, children }) => (
    <button type="button" className={`cob-card ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}><b>{t}</b>{sub && <small>{sub}</small>}{children}<span className="cob-tick" aria-hidden="true">{on ? '✓' : ''}</span></button>);
  const title = mode === 'month' ? `${Number(today.slice(5, 7))}월 목표 점검 · ${AREAS[area].n}` : `${choice === 'routine' ? '루틴 입력' : choice === 'todo' ? '목표별 To do 추천받기' : '목표 온보딩'} · ${AREAS[area].n}`;
  return (
    <Popup wide title={title} sub={choice === 'routine' ? '반복할 일을 적으면 체크리스트로 만들고, 목표와 연결할 수 있습니다' : '목표별 To do 를 추천받거나, 반복할 루틴을 바로 입력할 수 있습니다'} onClose={() => onClose(false)}>
      <ol className="go-steps">{steps.map((k, i) => <li key={k} className={i === si ? 'on' : i < si ? 'past' : ''}><span>{i + 1}</span>{NAMES[k]}</li>)}</ol>
      <div className="go-body" style={{ '--ac': `var(${AREAS[area].v})` }}>

        {step === 'start' && <>
          <p className="cob-q">어떻게 시작할까요?</p>
          <div className="cob-cards go-start">
            <Card on={choice === 'todo'} title="목표별 To do 추천받기" sub="기간과 목표를 정하면 목표마다 상세 To do · 마일스톤을 추천해 드려요 (AI 가능)" onClick={() => setChoice('todo')} />
            <Card on={choice === 'routine'} title="루틴 입력" sub="매일 · 매주 · 매월 반복할 일을 적어 체크리스트로 만들어요. 목표에 연결하면 체크할수록 진행률이 올라가요" onClick={() => setChoice('routine')} />
          </div>
        </>}

        {step === 'routine' && <>
          <p className="cob-q">언제까지 할까요?<span className="muted">이 기간 동안 대시보드 캘린더에 반복 일정으로 들어갑니다</span></p>
          <div className="chips go-rper" role="group" aria-label="루틴 기간">{PERIODS.map(([k, n, e]) => (
            <button key={k} aria-pressed={period.kind === k} onClick={() => setPeriod(p => ({ kind: k, start: k === 'custom' ? p.start : today, end: k === 'custom' ? p.end : e }))}>{n}</button>))}
            {period.kind === 'custom' && <span className="go-td"><input type="date" value={period.start} onChange={e => setPeriod(p => ({ ...p, start: e.target.value || today }))} aria-label="시작" />~<input type="date" value={period.end} min={period.start} onChange={e => setPeriod(p => ({ ...p, end: e.target.value || p.end }))} aria-label="끝" /></span>}
            <small className="muted">{md(period.start)} ~ {md(period.end)} · {days}일</small></div>
          <label className="sh-chk go-clear"><input type="checkbox" checked={toCal} onChange={e => setToCal(e.target.checked)} />대시보드 캘린더에도 넣기</label>
          <p className="cob-q">반복할 루틴을 적어 주세요<span className="muted">시간을 넣으면 캘린더에 그 시간으로 들어갑니다</span></p>
          {routines.map(r => (
            <div key={r.key} className="go-row go-rt">
              <input value={r.action} onChange={e => setR(r.key, { action: e.target.value })} placeholder="예: 아침 스트레칭 10분" aria-label="루틴" />
              <select value={r.c} onChange={e => setR(r.key, { c: e.target.value })} aria-label="주기">{RCYC.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
              {r.c === 'W' && <select value={r.wd} onChange={e => setR(r.key, { wd: Number(e.target.value) })} aria-label="요일" className="go-wd">{[...WD].map((w, i) => <option key={w} value={i}>{w}요일</option>)}</select>}
              <span className="go-tm"><input type="time" value={r.time} onChange={e => setR(r.key, { time: e.target.value })} aria-label="시작 시간" />~<input type="time" value={r.end} onChange={e => setR(r.key, { end: e.target.value })} aria-label="끝 시간" disabled={!r.time} /></span>
              <select value={r.goal} onChange={e => setR(r.key, { goal: e.target.value })} aria-label="연결할 목표"><option value="">목표 연결 안 함</option>{goalOpts.map(g => <option key={g.key} value={g.key}>목표: {g.name}</option>)}<option value="__new">+ 새 목표 만들기</option></select>
              {r.goal === '__new' && <input className="go-newg" value={r.newGoal} onChange={e => setR(r.key, { newGoal: e.target.value })} placeholder="새 목표 이름 (예: 10월 체력 만들기)" aria-label="새 목표 이름" autoFocus list={`go-newg-${area}`} />}
              <button className="tl-del" onClick={() => setRoutines(v => v.filter(x => x.key !== r.key))} aria-label="빼기">×</button>
            </div>))}
          <button className="btn sm" onClick={() => setRoutines(v => [...v, blankR()])}>+ 루틴 더하기</button>
          <datalist id={`go-newg-${area}`}>{[...new Set(routines.filter(x => x.goal === '__new' && x.newGoal.trim()).map(x => x.newGoal.trim()))].map(n => <option key={n} value={n} />)}</datalist>
          <p className="note">"연결할 목표"에서 <b>+ 새 목표 만들기</b>를 고르면 여기서 바로 목표를 만들 수 있어요 (같은 이름을 적은 루틴은 한 목표로 묶임 · 기간은 위에서 고른 기간). 목표에 연결한 루틴은 체크할수록 그 목표 진행률이 올라갑니다.</p>
        </>}

        {step === 'rdone' && <>
          <p className="go-lead">이 루틴들을 체크리스트에 넣을까요?{toCal ? <> <b>{md(period.start)} ~ {md(period.end)}</b> 동안 대시보드 캘린더에도 반복 일정으로 들어갑니다.</> : ''} 체크리스트 › 편집 · 캘린더에서 언제든 고치거나 뺄 수 있습니다.</p>
          <ul className="go-sum">{rList.map(r => <li key={r.key}><b>{r.action}</b> <small className="muted">{cycTxt(r)} · {timeTxt(r)} · {catLabel(autoCat(r))}{goalName(r) ? ` · ${r.goal === '__new' ? '새 ' : ''}목표 "${goalName(r)}" 에 연결` : ''}</small></li>)}</ul>
        </>}

        {step === 'review' && <>
          <p className="go-lead">{Number(last.slice(5))}월 마일스톤 {doneLast + review.filter(r => r.kind === 'mile').length}개 중 <b>{doneLast}개 완료</b>{review.length ? ` · 못 끝낸 것 ${review.length}개를 어떻게 할지 골라 주세요` : ' · 못 끝낸 것이 없습니다. 잘하셨어요!'}</p>
          {review.length > 0 && <ul className="go-review">{review.map(r => (
            <li key={r.id}>
              <span className="go-rn"><small className="tag">{r.kind === 'mile' ? '마일스톤' : `작업 ${r.p}%`}</small><b>{r.name}</b><small className="muted">{catLabel(r.cat)} · {md(r.date)}</small></span>
              <span className="chips" role="group" aria-label={`${r.name} 처리`}>{[['move', '이번 달로 미루기'], ['keep', '그대로'], ['del', '지우기']].map(([k, n]) => (
                <button key={k} aria-pressed={r.act === k} onClick={() => setReview(v => v.map(x => (x.id === r.id ? { ...x, act: k } : x)))}>{n}</button>))}</span>
            </li>))}</ul>}
        </>}

        {step === 'period' && <>
          <p className="cob-q">어느 기간의 목표를 세울까요?<span className="muted">목표 크기 · 마일스톤 간격이 이 기간에 맞춰집니다</span></p>
          <div className="cob-cards go-periods">{PERIODS.map(([k, n, e]) => (
            <Card key={k} on={period.kind === k} title={n} sub={k === 'custom' ? '시작일 · 끝나는 날 고르기' : `${md(today)} ~ ${md(e)}`}
              onClick={() => setPeriod(p => ({ kind: k, start: k === 'custom' ? p.start : today, end: k === 'custom' ? p.end : e }))} />))}</div>
          {period.kind === 'custom' && <div className="go-row">
            <label className="go-end">시작<input type="date" value={period.start} onChange={e => setPeriod(p => ({ ...p, start: e.target.value || today }))} /></label>
            <label className="go-end">끝<input type="date" value={period.end} min={period.start} onChange={e => setPeriod(p => ({ ...p, end: e.target.value || p.end }))} /></label></div>}
          <p className="muted go-pinfo">{md(period.start)} ~ {md(period.end)} · {days}일 (약 {months}개월)</p>
        </>}

        {step === 'ask' && <>
          <p className="cob-q">이 기간에 무엇을 이루고 싶나요?<span className="muted">여러 개 골라도 됩니다</span></p>
          <div className="cob-cards">{topicsAll.map(t => (
            <Card key={t.id} on={topics.includes(t.id)} title={t.name} sub={t.desc} onClick={() => setTopics(v => (v.includes(t.id) ? v.filter(x => x !== t.id) : [...v, t.id]))} />))}</div>
          <p className="cob-q">지금은 어느 정도인가요?</p>
          <div className="cob-cards go-3">{LEVELS.map(([n, d], i) => <Card key={n} on={level === i} title={n} sub={d} onClick={() => setLevel(i)} />)}</div>
          <p className="cob-q">일주일에 쓸 수 있는 시간은요?</p>
          <div className="cob-cards go-3">{HOURS.map(([n, d], i) => <Card key={n} on={hours === i} title={n} sub={d} onClick={() => setHours(i)} />)}</div>
          {(topics.length > 0 || own.length > 0) && <p className="cob-q">이 기간의 목표<span className="muted">고른 주제로 만든 목표예요. 이름을 내 말로 고치고, 필요 없는 건 체크를 푸세요</span></p>}
          <div className="go-recs">{recs.map(g => {
            const on = pick[g.key] !== false;
            return (
              <div key={g.key} className={`go-rec ${on ? 'on' : ''}`}>
                <label className="go-rh"><input type="checkbox" checked={on} onChange={e => setPick(v => ({ ...v, [g.key]: e.target.checked }))} aria-label={`${g.topicName} 추천 고르기`} />
                  <small className="tag">{g.topicName} · {catLabel(g.cat)}</small></label>
                <input className="go-rname" value={names[g.key] ?? g.name} onChange={e => setNames(v => ({ ...v, [g.key]: e.target.value }))} disabled={!on} aria-label="목표 이름" />
                <small className="muted">{g.why}</small>
              </div>);
          })}</div>
          {own.map(g => (
            <div key={g.key} className="go-row">
              <select value={g.cat} onChange={e => setOwn(v => v.map(x => (x.key === g.key ? { ...x, cat: e.target.value } : x)))} aria-label="카테고리">{cats.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select>
              <input value={g.name} placeholder="내 목표 (직접 입력)" onChange={e => setOwn(v => v.map(x => (x.key === g.key ? { ...x, name: e.target.value } : x)))} aria-label="직접 넣는 목표" autoFocus />
              <button className="tl-del" onClick={() => setOwn(v => v.filter(x => x.key !== g.key))} aria-label="빼기">×</button>
            </div>))}
          <button className="btn sm" onClick={() => setOwn(v => [...v, { key: uid(), cat: cats[0], name: '' }])}>+ 직접 목표 넣기</button>
          {existing.length > 0 && <details className="go-exd"><summary>이미 있는 올해 목표 {existing.length}개</summary>
            <ul className="go-ex">{existing.map(g => <li key={g.key} className={clearEx && g.ex ? 'off' : ''}><small className="tag">{catLabel(g.cat)}</small><b>{g.name}</b><small className="muted">~ {md(g.end)}</small></li>)}</ul></details>}
          {hasEx && <label className="sh-chk go-clear"><input type="checkbox" checked={clearEx} onChange={e => setClearEx(e.target.checked)} />"(예시)" 목표는 지우고 새 목표로 시작하기</label>}
          <p className="cob-q">AI 에게 더 알려 줄 것<span className="muted">선택 · 예: 평일 저녁만 가능, 무릎이 안 좋음, 예산 월 10만원</span></p>
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="상세 To do 를 만들 때 참고합니다" aria-label="AI 에게 더 알려 줄 것" />
        </>}

        {step === 'todos' && <>
          <div className="go-aibar">
            <p className="go-lead"><b>{md(period.start)} ~ {md(period.end)}</b> ({days}일) · {LEVELS[level][0]} · {HOURS[hours][0]}{Object.values(plan).some(x => x.src === 'ai') ? ' · AI 추천' : ' · 기본 추천'}</p>
            <button className="btn primary" disabled={ai.busy || !sync?.connected} onClick={askAi} title={sync?.connected ? '서버의 AI 로 목표별 상세 To do 와 마일스톤을 받습니다' : '로그인해야 AI 추천을 쓸 수 있습니다'}>
              {ai.busy ? 'AI 가 To do 를 만드는 중… (10~40초)' : Object.values(plan).some(x => x.src === 'ai') ? 'AI 로 다시 받기' : 'AI 로 상세 To do 받기'}</button>
          </div>
          {!sync?.connected && <p className="note">로그인 없이 쓰는 중이라 기본 추천만 보입니다. 로그인하면 AI 로 받을 수 있습니다.</p>}
          {ai.msg && <p className={ai.bad ? 'banner' : 'banner ok'}>{ai.msg}</p>}
          {chosen.map(g => { const pl = planOf(g); return (
            <div key={g.key} className="go-plan">
              <div className="go-ph"><b>{g.name}</b><small className="tag">{catLabel(g.cat)}</small><small className="muted">{pl.src === 'ai' ? 'AI 추천' : '기본 추천'} · To do {pl.todos.filter(t => t.on).length} · 마일스톤 {pl.milestones.filter(m => m.on).length}</small></div>
              <ul className="go-todos">{pl.todos.map(t => (
                <li key={t.key} className={t.on ? '' : 'off'}>
                  <input type="checkbox" checked={t.on} onChange={e => setPart(g, 'todos', t.key, { on: e.target.checked })} aria-label="이 To do 넣기" />
                  <span className="go-tn"><input value={t.name} onChange={e => setPart(g, 'todos', t.key, { name: e.target.value })} placeholder="할 일" aria-label="To do" />{t.how && <small className="muted">{t.how}</small>}</span>
                  <span className="go-td"><input type="date" value={t.start} min={period.start} max={period.end} onChange={e => setPart(g, 'todos', t.key, { start: e.target.value || t.start })} aria-label="시작" />~<input type="date" value={t.end} min={t.start} max={period.end} onChange={e => setPart(g, 'todos', t.key, { end: e.target.value || t.end })} aria-label="끝" /></span>
                </li>))}
                {!pl.todos.length && <li className="muted">{pl.src === 'ai' ? 'AI 가 To do 를 만들지 못했어요. 직접 넣어 주세요' : '"AI 로 상세 To do 받기"를 누르거나 직접 넣어 주세요'}</li>}</ul>
              <button className="btn sm" onClick={() => addPart(g, 'todos')}>+ To do</button>
              <div className="go-ms"><b>마일스톤</b>{pl.milestones.map(m => (
                <label key={m.key} className={`go-m ${m.on ? '' : 'off'}`}><input type="checkbox" checked={m.on} onChange={e => setPart(g, 'milestones', m.key, { on: e.target.checked })} />
                  <input value={m.name} onChange={e => setPart(g, 'milestones', m.key, { name: e.target.value })} aria-label="마일스톤" placeholder="마일스톤" />
                  <input type="date" value={m.date} min={period.start} max={period.end} onChange={e => setPart(g, 'milestones', m.key, { date: e.target.value || m.date })} aria-label="날짜" /></label>))}
                <button className="linkish" onClick={() => addPart(g, 'milestones')}>+ 마일스톤</button></div>
            </div>); })}
        </>}

        {step === 'done' && <>
          <p className="go-lead">이대로 저장할까요? To do 는 목표 관리 표에 "직접 체크 (To do)" 작업으로 들어가 끝나면 체크할 수 있습니다.</p>
          <ul className="go-sum">
            <li>기간: {period.start} ~ {period.end} ({days}일)</li>
            {clearEx && <li>예시 목표 지우기</li>}
            {review.length > 0 && <li>지난달 못 끝낸 것: 미루기 {review.filter(r => r.act === 'move').length} · 그대로 {review.filter(r => r.act === 'keep').length} · 지우기 {review.filter(r => r.act === 'del').length}</li>}
            {chosen.map(g => { const pl = planOf(g); return <li key={g.key}><b>{g.name}</b> <small className="muted">{catLabel(g.cat)} · To do {pl.todos.filter(t => t.on && t.name.trim()).length} · 마일스톤 {pl.milestones.filter(m => m.on && m.name.trim()).length} · {pl.src === 'ai' ? 'AI 추천' : '기본 추천'}</small></li>; })}
          </ul>
        </>}
      </div>

      <div className="go-foot">
        {si > 0 && <button className="btn" onClick={() => setSi(si - 1)}>이전</button>}
        <button className="linkish" onClick={() => { markOnly(mode); onClose(false); }}>{mode === 'month' ? '이번 달은 건너뛰기' : '나중에 직접 할게요'}</button>
        {step === 'rdone' ? <button className="btn primary grow-r" onClick={saveRoutines}>체크리스트에 넣기</button>
          : step === 'done' ? <button className="btn primary grow-r" onClick={save}>저장</button>
          : <button className="btn primary grow-r" disabled={!canNext} onClick={() => setSi(si + 1)}>{nextLabel}</button>}
      </div>
    </Popup>
  );
}

/** 대시보드 안내: 목표 설정 · 이번 달 점검이 남은 영역 */
export function GoalOnboardCard() {
  const { store, now, openCat, areasAllowed } = useCtx();
  const today = iso(now);
  const list = [...(areasAllowed || 'PBW')].filter(a => CATS.some(r => r.a === a && r.cat === '목표 관리')).map(a => ({ a, need: goalOnboardNeed(store, a, today) })).filter(x => x.need);
  const month = list.filter(x => x.need === 'month'), setup = list.filter(x => x.need === 'setup');
  if (!month.length && !setup.length) return null;
  return (
    <section className="panel dash-start go-card" aria-label="목표 온보딩">
      <div><h2>{month.length ? `${now.getMonth() + 1}월 목표 점검을 해 볼까요?` : '목표와 상세 To do 를 추천받아 볼까요?'}</h2>
        <p className="muted">{month.length ? '지난달을 돌아보고 이번 달 목표를 추천받습니다 (2~3분)' : '목표별 To do 를 추천받거나(AI 가능), 반복할 루틴을 입력해 시작하세요'}</p></div>
      <span className="go-card-b">{[...month, ...setup].map(x => <button key={x.a} className="btn primary" onClick={() => openCat(x.a, '목표 관리')}>{AREAS[x.a].n} {x.need === 'month' ? '점검' : '시작하기'}</button>)}</span>
    </section>
  );
}
