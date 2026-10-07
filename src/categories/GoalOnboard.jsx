import React, { useEffect, useMemo, useState } from 'react';
import { AREAS, CATS, WEEK_KO, dayLabel, daysOf, iso } from '../data.js';
import { Popup, useCtx } from '../shared.jsx';
import { GOAL_TOPICS, HOURS, LEVELS, recommendByCats, topicsOfCat } from './goalRecs.js';
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

/** 걸리는 시간: "1시간 30분" · "45분" (끝이 시작보다 늦을 때만) */
const durTxt = (a, b) => { const m = (t => { const [h, mm] = String(t).split(':').map(Number); return h * 60 + mm; }); const d = a && b ? m(b) - m(a) : 0; if (!(d > 0)) return ''; const h = Math.floor(d / 60), mm = d % 60; return `${h ? `${h}시간` : ''}${h && mm ? ' ' : ''}${mm ? `${mm}분` : ''}`; };

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
  // 상세 내용의 카테고리를 골라 목표를 그 카테고리에 연동 (목표 보드가 없는 카테고리는 영역 공통에 저장)
  const areaCats = ['목표 관리', ...new Set(CATS.filter(r => r.a === area && r.cat !== '목표 관리').map(r => r.cat))];
  const goalOk = c => hasGoals(area, c);
  const target = c => (goalOk(c) ? c : '목표 관리');
  const [selCats, setSelCats] = useState(() => (saved.cats || [...new Set((saved.topics || []).map(id => GOAL_TOPICS.find(t => t.id === id)?.cat).filter(Boolean))]).filter(c => areaCats.includes(c)));
  const [selTopics, setSelTopics] = useState(() => saved.catTopics || Object.fromEntries(areaCats.map(c => [c, (saved.topics || []).filter(id => topicsOfCat(area, c).some(t => t.id === id))])));
  const topicsOf = c => { const ts = topicsOfCat(area, c); const on = (selTopics[c] || []).filter(id => ts.some(t => t.id === id)); return on.length ? on : ts.slice(0, 1).map(t => t.id); };   // 안 골랐으면 첫 주제
  const toggleCat = c => setSelCats(v => (v.includes(c) ? v.filter(x => x !== c) : [...v, c]));
  const toggleTopic = (c, id) => setSelTopics(v => { const cur = topicsOf(c); const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]; return { ...v, [c]: next.length ? next : cur }; });
  const topics = selCats.flatMap(topicsOf);
  const [level, setLevel] = useState(saved.level ?? 1);
  const [hours, setHours] = useState(saved.hours ?? 1);
  // ③ 추천
  const ctx = { days, months, level, hours };
  const recs = useMemo(() => recommendByCats(area, selCats.map(c => ({ cat: c, topics: topicsOf(c) })), ctx, target), [selCats.join(), JSON.stringify(selTopics), level, hours, days]);
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
      const r = await sync.request('/api/goals/todos', { method: 'POST', body: { area, start: period.start, end: period.end, level, hours, note, goals: chosen.map(g => ({ name: g.name, cat: catLabel(g.srcCat || g.cat) })) } });
      setPlan(Object.fromEntries(chosen.map((g, i) => { const x = r.goals[i] || { milestones: [], todos: [] }; return [g.key, { src: 'ai', milestones: x.milestones.map(m => ({ ...m, key: uid(), on: true })), todos: x.todos.map(t => ({ ...t, key: uid(), on: true })) }]; })));
      setAi({ busy: false, msg: `AI(${r.model})가 상세 To do 를 만들었어요${r.left != null ? ` · 오늘 ${r.left}번 더 받을 수 있음` : ''}`, bad: false });
    } catch (e) { setAi({ busy: false, msg: e.status === 404 ? '서버를 업데이트하면 AI 추천을 쓸 수 있습니다 (기본 추천은 그대로 사용)' : e.message, bad: true }); }
  };

  // 맨 처음: 목표별 To do 추천받기 / 루틴 입력 중 하나
  const [choice, setChoice] = useState(null);                // 'todo' | 'routine'
  const steps = choice === 'routine' ? ['start', 'routine', 'rdone'] : mode === 'month' ? ['start', 'review', 'period', 'ask', 'todos', 'done'] : ['start', 'period', 'ask', 'todos', 'done'];
  // 루틴: 체크리스트에 내 항목으로 들어가고, 목표에 연결하면 그 목표 아래 작업(진행률 = 이 루틴 체크)으로도 들어감
  // 루틴: { key, action, freq: D 매일 | WD 평일(월~금 중) | WE 주말(토 · 일 중) | W 매주(요일 여러 개) | M 매월(날짜), wds: [요일], mday, time, end, goal, newGoal }
  const blankR = (o = {}) => ({ key: uid(), action: '', freq: 'D', wds: [], mday: now.getDate(), time: '', end: '', cat: '', goal: '', newGoal: '', ...o });
  const goalOpts = existing.filter(g => !g.ex);
  /** 루틴 카테고리는 자동: 목표에 연결하면 그 목표의 카테고리(진행률에 잡히게), 아니면 영역 공통(목표 관리) */
  const autoCat = r => r.cat || goalOpts.find(x => x.key === r.goal)?.cat || '목표 관리';   // 루틴(체크리스트)은 고른 카테고리에
  const goalName = r => (r.goal === '__new' ? r.newGoal.trim() : goalOpts.find(g => g.key === r.goal)?.name || '');
  const [routines, setRoutines] = useState([]);
  const [wiz, setWiz] = useState(null);                       // 루틴 추가 팝업 { r, si, edit }
  const [toCal, setToCal] = useState(true);                  // 기간 동안 대시보드 캘린더에 반복 일정으로
  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const timeTxt = r => (r.time ? `${r.time}${r.end && toMin(r.end) > toMin(r.time) ? `~${r.end} (${durTxt(r.time, r.end)})` : ''}` : '시간 없음');
  /** 체크리스트 · 캘린더에 쓸 주기: 매주(요일들)는 '그 요일에만 하는 매일 항목' */
  const byDay = r => r.freq === 'W' || r.freq === 'WD' || r.freq === 'WE';   // 요일을 고르는 주기
  const rowCyc = r => (byDay(r) ? { c: 'D', days: daysOf(r.wds) } : { c: r.freq });
  const cycTxt = r => {
    if (!byDay(r)) return r.freq === 'M' ? `매월 ${r.mday}일` : '매일';
    const d = daysOf(r.wds);
    if (!d) return '매일';
    if (d === 'wd' || d === 'we') return dayLabel(d);                       // 평일 · 주말 전체
    return `${r.freq === 'WD' ? '평일 중 ' : r.freq === 'WE' ? '주말 중 ' : '특정 요일 '}${dayLabel(d)}`;
  };
  /** 반복 일정의 첫 날: 기간 시작일부터 처음으로 맞는 날 */
  const firstDate = r => {
    const d = toDate(period.start);
    for (let i = 0; i < 62; i++, d.setDate(d.getDate() + 1)) {
      if (r.freq === 'D') return iso(d);
      if (byDay(r) && (!r.wds.length || r.wds.includes(d.getDay()))) return iso(d);
      if (r.freq === 'M' && d.getDate() === r.mday) return iso(d);
    }
    return period.end;
  };
  const rList = routines.filter(r => r.action.trim());
  /** 루틴이 끝나는 날: 고른 기간 끝, 이미 있는 목표에 연결했으면 그 목표가 끝나는 날을 넘지 않게 (캘린더 반복 · 목표 작업에 같은 날짜) */
  const rEnd = r => { const g = r.goal && r.goal !== '__new' ? goalOpts.find(x => x.key === r.goal) : null; return g?.end && g.end >= period.start && g.end < period.end ? g.end : period.end; };
  const saveRoutines = () => {
    setStore(s => {
      const cl = s.checklist || {};
      const cur = s.goals?.v === 2 ? s.goals : seedGoals(now);
      const bs = { ...cur.boards };
      // 루틴 입력에서 새로 적은 목표: 고른 카테고리의 목표 보드에 자동으로 만듦 (목표 보드가 없는 카테고리는 영역 공통), 같은 카테고리 · 같은 이름은 하나로
      const made = {}, mk = r => `${target(autoCat(r))}|${r.newGoal.trim()}`;
      rList.filter(r => r.goal === '__new' && r.newGoal.trim()).forEach(r => {
        if (made[mk(r)]) return;
        const gc = target(autoCat(r)), id = uid(), k = boardKey(area, gc), b = bs[k] || { ...EMPTY };
        bs[k] = { ...b, items: [...b.items, { id, parent: null, name: r.newGoal.trim(), start: period.start, end: period.end, progress: 0 }] };
        made[mk(r)] = { key: id, cat: gc, name: r.newGoal.trim(), end: period.end };
      });
      const rows = rList.map(r => { const g = r.goal === '__new' ? made[mk(r)] : goalOpts.find(x => x.key === r.goal); const cat = g && g.cat !== '목표 관리' ? g.cat : autoCat(r);   // 목표와 같은 카테고리여야 진행률에 잡힘
        return { row: { id: uid(), a: area, ...rowCyc(r), cat, item: cat, action: r.action.trim(), detail: `루틴 · ${cycTxt(r)}${r.time ? ` ${timeTxt(r)}` : ''} (목표 온보딩)`, ...(r.time ? { time: r.time } : {}) }, r, g }; });
      // 대시보드 캘린더: 기간 동안 반복 일정 (평일 · 주말은 그날만, 매주는 고른 요일, 매월은 시작일의 날짜)
      const evs = toCal ? rows.map(({ row, r }) => { const pc = rowCyc(r); return { id: uid(), date: firstDate(r), time: r.time || '', end: r.time && r.end && toMin(r.end) > toMin(r.time) ? r.end : '', title: row.action, area, routine: true, memo: '루틴 (목표 온보딩)',
        repeat: { freq: pc.c, until: rEnd(r), skip: [], ...(pc.days ? { days: pc.days } : {}) }, routineId: row.id }; }).filter(e => e.date <= e.repeat.until) : [];
      rows.filter(x => x.g).forEach(({ row, r, g }) => {
        const k = boardKey(area, g.cat), b = bs[k] || { ...EMPTY };   // (새 목표도 위에서 bs 에 넣었으므로 같은 보드에 붙음)
        // 목표의 루틴 작업 기간 = 캘린더 반복 일정과 같은 기간 (첫 날 ~ 루틴 끝) — 대시보드와 목표 화면의 날짜가 어긋나지 않게
        const end = rEnd(r), st = firstDate(r) <= end ? firstDate(r) : period.start;
        bs[k] = { ...b, items: [...b.items, { id: uid(), parent: g.key, name: `${row.action} (${cycTxt(r)})`, start: st, end, progress: 0, link: row.id }] };
      });
      const ob = s.goalOnboard?.[area] || {};
      return { ...s, checklist: { ...cl, custom: [...(cl.custom || []), ...rows.map(x => x.row)] }, goals: { ...cur, boards: bs }, events: [...(s.events || []), ...evs],
        goalOnboard: { ...(s.goalOnboard || {}), [area]: { ...ob, setupAt: ob.setupAt || today, months: { ...(ob.months || {}), [ym(today)]: 'done' } } } };
    });
    const newN = new Set(rList.filter(r => r.goal === '__new' && r.newGoal.trim()).map(r => r.newGoal.trim())).size;
    onClose(true, `루틴 ${rList.length}개를 체크리스트에 넣었습니다${newN ? ` · 새 목표 ${newN}개를 만들었습니다` : ''}${toCal ? ` · ${md(period.start)}~${md(period.end)} 대시보드 캘린더에 반복 일정으로 넣었습니다` : ''}${rList.some(r => goalName(r)) ? ' · 목표에 연결한 루틴은 목표 관리에서 마감 · D-day 로 볼 수 있습니다' : ''}`);
  };
  const [si, setSi] = useState(0);
  const step = steps[si];
  const NAMES = { start: '시작 방식', routine: '루틴 입력', rdone: '확인 · 저장', review: '지난달 돌아보기', period: '기간 설정', ask: '온보딩 · 목표', todos: '상세 To do 추천', done: '확인 · 저장' };
  const canNext = step === 'start' ? !!choice : step === 'routine' ? rList.length > 0 : step === 'period' ? period.end >= period.start : step === 'ask' ? chosen.length > 0 : true;
  const nextLabel = step === 'start' && !choice ? '둘 중 하나를 골라 주세요' : step === 'routine' && !rList.length ? '루틴을 하나 이상 적어 주세요' : step === 'ask' && !selCats.length && !own.some(g => g.name.trim()) ? '카테고리를 하나 이상 골라 주세요' : step === 'ask' && !chosen.length ? '목표를 하나 이상 남겨 주세요' : step === 'ask' ? '상세 To do 추천 받기' : '다음';

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
      return { ...s, goals: { ...cur, boards: bs }, goalOnboard: { ...(s.goalOnboard || {}), [area]: { ...ob, setupAt: ob.setupAt || today, months: { ...(ob.months || {}), [ym(today)]: 'done' }, answers: { topics, cats: selCats, catTopics: selTopics, level, hours, period: period.kind, note } } } };
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
            <Card on={choice === 'routine'} title="루틴 입력" sub="매일 · 매주 · 매월 반복할 일을 적어 체크리스트로 만들어요. 목표에 연결하면 목표 아래 작업으로 들어가요" onClick={() => setChoice('routine')} />
          </div>
        </>}

        {step === 'routine' && <>
          <p className="cob-q">언제까지 할까요?<span className="muted">이 기간 동안 대시보드 캘린더에 반복 일정으로 들어갑니다</span></p>
          <div className="chips go-rper" role="group" aria-label="루틴 기간">{PERIODS.map(([k, n, e]) => (
            <button key={k} aria-pressed={period.kind === k} onClick={() => setPeriod(p => ({ kind: k, start: k === 'custom' ? p.start : today, end: k === 'custom' ? p.end : e }))}>{n}</button>))}
            {period.kind === 'custom' && <span className="go-td"><input type="date" value={period.start} onChange={e => setPeriod(p => ({ ...p, start: e.target.value || today }))} aria-label="시작" />~<input type="date" value={period.end} min={period.start} onChange={e => setPeriod(p => ({ ...p, end: e.target.value || p.end }))} aria-label="끝" /></span>}
            <small className="muted">{md(period.start)} ~ {md(period.end)} · {days}일</small></div>
          <label className="sh-chk go-clear"><input type="checkbox" checked={toCal} onChange={e => setToCal(e.target.checked)} />대시보드 캘린더에도 넣기</label>
          <p className="cob-q">루틴<span className="muted">"+ 루틴 추가"를 누르면 무엇을 · 얼마나 자주 · 어느 요일 · 몇 시 · 목표 연결 순서로 정합니다</span></p>
          {routines.length > 0 ? <ul className="go-rlist">{routines.map(r => (
            <li key={r.key}>
              <span className="go-rmain"><b>{r.action}</b><small className="muted">{cycTxt(r)} · {timeTxt(r)}{r.cat ? ` · ${catLabel(r.cat)}` : ""}{goalName(r) ? ` · ${r.goal === '__new' ? '새 ' : ''}목표: ${goalName(r)}` : ''}</small></span>
              <button className="btn sm" onClick={() => setWiz({ r: { ...r }, si: 0, edit: true })}>수정</button>
              <button className="tl-del" onClick={() => setRoutines(v => v.filter(x => x.key !== r.key))}>삭제</button>
            </li>))}</ul> : <p className="muted go-rnone">아직 루틴이 없습니다.</p>}
          <button className="btn primary go-radd" onClick={() => setWiz({ r: blankR(), si: 0 })}>+ 루틴 추가</button>
          {wiz && <RoutineWizard wiz={wiz} setWiz={setWiz} byDay={byDay} goalOpts={goalOpts} areaCats={areaCats} target={target} goalOk={goalOk} routines={routines} cycTxt={cycTxt} timeTxt={timeTxt} toMin={toMin}
            onDone={r => { setRoutines(v => (v.some(x => x.key === r.key) ? v.map(x => (x.key === r.key ? r : x)) : [...v, r])); setWiz(null); }} />}
        </>}

        {step === 'rdone' && <>
          <p className="go-lead">이 루틴들을 체크리스트에 넣을까요?{toCal ? <> <b>{md(period.start)} ~ {md(period.end)}</b> 동안 대시보드 캘린더에도 반복 일정으로 들어갑니다.</> : ''} 체크리스트 › 편집 · 캘린더에서 언제든 고치거나 뺄 수 있습니다.</p>
          <ul className="go-sum">{rList.map(r => <li key={r.key}><b>{r.action}</b> <small className="muted">{cycTxt(r)} · {timeTxt(r)} · {catLabel(autoCat(r))}{goalName(r) ? ` · ${r.goal === '__new' ? '새 ' : ''}목표 "${goalName(r)}" 에 연결` : ''} · {rEnd(r) < period.end ? <b>{md(rEnd(r))}까지 (목표가 끝나는 날)</b> : `${md(period.end)}까지`}</small></li>)}</ul>
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
          <p className="cob-q">어느 카테고리의 목표를 세울까요?<span className="muted">상세 내용의 {AREAS[area].n} 카테고리 · 여러 개 골라도 됩니다 · 목표와 To do 는 고른 카테고리에 들어갑니다</span></p>
          <div className="cob-cards">{areaCats.map(c => { const ts = topicsOfCat(area, c); return (
            <Card key={c} on={selCats.includes(c)} title={catLabel(c)} sub={`${ts.length ? ts.map(t => t.name).join(' · ') : '기본 틀 · AI 추천 권장'}${goalOk(c) ? '' : ' · 목표는 영역 공통에 저장'}`} onClick={() => toggleCat(c)} />); })}</div>
          {selCats.filter(c => topicsOfCat(area, c).length > 1).map(c => (
            <div key={c} className="chips go-ctopics" role="group" aria-label={`${c} 세부 주제`}><small className="muted">{catLabel(c)} 세부 주제</small>
              {topicsOfCat(area, c).map(t => <button key={t.id} aria-pressed={topicsOf(c).includes(t.id)} onClick={() => toggleTopic(c, t.id)}>{t.name}</button>)}</div>))}
          <p className="cob-q">지금은 어느 정도인가요?</p>
          <div className="cob-cards go-3">{LEVELS.map(([n, d], i) => <Card key={n} on={level === i} title={n} sub={d} onClick={() => setLevel(i)} />)}</div>
          <p className="cob-q">일주일에 쓸 수 있는 시간은요?</p>
          <div className="cob-cards go-3">{HOURS.map(([n, d], i) => <Card key={n} on={hours === i} title={n} sub={d} onClick={() => setHours(i)} />)}</div>
          {(selCats.length > 0 || own.length > 0) && <p className="cob-q">이 기간의 목표<span className="muted">고른 카테고리로 만든 목표예요. 이름을 내 말로 고치고, 필요 없는 건 체크를 푸세요</span></p>}
          <div className="go-recs">{recs.map(g => {
            const on = pick[g.key] !== false;
            return (
              <div key={g.key} className={`go-rec ${on ? 'on' : ''}`}>
                <label className="go-rh"><input type="checkbox" checked={on} onChange={e => setPick(v => ({ ...v, [g.key]: e.target.checked }))} aria-label={`${g.topicName} 추천 고르기`} />
                  <small className="tag">{catLabel(g.srcCat)}{g.srcCat !== g.cat ? ` → ${catLabel(g.cat)}에 저장` : ''} · {g.topicName}</small></label>
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

/** 루틴 추가 팝업 (온보딩 안의 작은 팝업): 무엇을 → 얼마나 자주 → 어느 요일 · 며칠 → 몇 시 → 목표 연결 → 확인 */
function RoutineWizard({ wiz, setWiz, byDay, goalOpts, areaCats, target, goalOk, routines, cycTxt, timeTxt, toMin, onDone }) {
  const { r, si } = wiz;
  const set = p => setWiz(w => ({ ...w, r: { ...w.r, ...p } }));
  const steps = ['what', 'freq', ...(r.freq === 'D' ? [] : ['when']), 'time', 'cat', 'goal', 'ok'];
  const catGoals = r.cat ? goalOpts.filter(g => g.cat === target(r.cat)) : [];   // 고른 카테고리(목표 보드)의 목표만
  /** 카테고리를 고르면: 그 카테고리에 목표가 없으면 '새 목표'(이름 = 루틴 이름 기반)를 기본으로 */
  const pickCat = c => { const gs = goalOpts.filter(g => g.cat === target(c)); set({ cat: c, goal: gs.some(g => g.key === r.goal) ? r.goal : gs.length ? '' : '__new', newGoal: r.newGoal || `${r.action.trim()} 꾸준히 하기` }); };
  const SHOW = { W: [1, 2, 3, 4, 5, 6, 0], WD: [1, 2, 3, 4, 5], WE: [6, 0] };   // 주기마다 고를 수 있는 요일
  const step = steps[Math.min(si, steps.length - 1)];
  const go = n => setWiz(w => ({ ...w, si: n }));
  const NAMES = { what: '무엇을', freq: '얼마나 자주', when: r.freq === 'M' ? '며칠에' : r.freq === 'WE' ? '주말 중 언제' : r.freq === 'WD' ? '평일 중 언제' : '어느 요일', time: '몇 시', cat: '카테고리', goal: '목표 연결', ok: '확인' };
    const toggleWd = w => set({ wds: r.wds.includes(w) ? r.wds.filter(x => x !== w) : [...r.wds, w] });
  const ok = step === 'what' ? !!r.action.trim() : step === 'when' ? (!byDay(r) || r.wds.length > 0) : step === 'time' ? (!r.end || !r.time || toMin(r.end) > toMin(r.time)) : step === 'cat' ? !!r.cat : step === 'goal' ? (r.goal !== '__new' || !!r.newGoal.trim()) : true;
  const Opt = ({ on, onClick, t, sub }) => <button type="button" className={`cob-card ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}><b>{t}</b>{sub && <small>{sub}</small>}<span className="cob-tick" aria-hidden="true">{on ? '✓' : ''}</span></button>;
  const newNames = [...new Set(routines.filter(x => x.goal === '__new' && x.newGoal.trim()).map(x => x.newGoal.trim()))];
  return (
    <Popup title={wiz.edit ? '루틴 수정' : '루틴 추가'} sub="단계별로 정하면 체크리스트와 캘린더에 그대로 들어갑니다" onClose={() => setWiz(null)}>
      <ol className="go-steps">{steps.map((k, i) => <li key={k} className={k === step ? 'on' : i < steps.indexOf(step) ? 'past' : ''}><span>{i + 1}</span>{NAMES[k]}</li>)}</ol>
      <div className="go-body rw-body">
        {step === 'what' && <>
          <p className="cob-q">어떤 루틴인가요?</p>
          <input className="rw-name" value={r.action} onChange={e => set({ action: e.target.value })} placeholder="예: 아침 러닝 30분" aria-label="루틴 이름" autoFocus onKeyDown={e => { if (e.key === 'Enter' && ok) go(si + 1); }} />
        </>}
        {step === 'freq' && <>
          <p className="cob-q">얼마나 자주 하나요?</p>
          <div className="cob-cards rw-freq">
            <Opt on={r.freq === 'D'} t="매일" sub="날마다 (월~일)" onClick={() => set({ freq: 'D', wds: [] })} />
            <Opt on={r.freq === 'WD'} t="평일" sub="월~금 · 다음에서 평일 중 요일만 고를 수도 있어요" onClick={() => set({ freq: 'WD', wds: r.freq === 'WD' ? r.wds : [1, 2, 3, 4, 5] })} />
            <Opt on={r.freq === 'WE'} t="주말" sub="토 · 일 · 다음에서 하루만 고를 수도 있어요" onClick={() => set({ freq: 'WE', wds: r.freq === 'WE' ? r.wds : [6, 0] })} />
            <Opt on={r.freq === 'W'} t="특정 요일" sub="월~일 중 골라요 (예: 화 · 목)" onClick={() => set({ freq: 'W', wds: r.freq === 'W' ? r.wds : [] })} />
            <Opt on={r.freq === 'M'} t="매월" sub="날짜를 골라요 (예: 매월 25일)" onClick={() => set({ freq: 'M', wds: [] })} />
          </div>
        </>}
        {step === 'when' && byDay(r) && <>
          <p className="cob-q">{r.freq === 'WD' ? '평일 중 어느 요일에 하나요?' : r.freq === 'WE' ? '주말 중 어느 날에 하나요?' : '어느 요일에 하나요? (특정 요일)'}<span className="muted">여러 개 고를 수 있어요</span></p>
          <div className="rw-days" role="group" aria-label="요일">{SHOW[r.freq].map(w => (
            <button key={w} type="button" className={`rw-day ${r.wds.includes(w) ? 'on' : ''} ${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}`} aria-pressed={r.wds.includes(w)} onClick={() => toggleWd(w)}>{WEEK_KO[w]}</button>))}</div>
          <p className="go-pinfo">{r.wds.length ? cycTxt(r) : '요일을 하나 이상 골라 주세요'}</p>
        </>}
        {step === 'when' && r.freq === 'M' && <>
          <p className="cob-q">매월 며칠에 하나요?</p>
          <div className="rw-mdays">{Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
            <button key={d} type="button" className={`rw-day ${r.mday === d ? 'on' : ''}`} aria-pressed={r.mday === d} onClick={() => set({ mday: d })}>{d}</button>))}</div>
          {r.mday > 28 && <p className="note">{r.mday}일이 없는 달은 건너뜁니다.</p>}
        </>}
        {step === 'time' && <>
          <p className="cob-q">몇 시에 하나요?{durTxt(r.time, r.end) && <span className="rw-dur">{durTxt(r.time, r.end)}</span>}<span className="muted">시간을 넣으면 캘린더의 그 시간 칸에 들어갑니다 (안 넣으면 종일)</span></p>
          <div className="rw-time"><label>시작<input type="time" value={r.time} onChange={e => set({ time: e.target.value })} /></label>
            <label>끝<input type="time" value={r.end} onChange={e => set({ end: e.target.value })} disabled={!r.time} /></label>
            {r.time && <button className="linkish" onClick={() => set({ time: '', end: '' })}>시간 없이</button>}</div>
          {r.end && r.time && toMin(r.end) <= toMin(r.time) && <p className="sh-err">끝 시간이 시작보다 늦어야 합니다</p>}
        </>}
        {step === 'cat' && <>
          <p className="cob-q">어느 카테고리의 루틴인가요?<span className="muted">상세 내용의 카테고리 · 체크리스트가 이 카테고리에 들어가고, 다음에서 이 카테고리의 목표와 연결합니다</span></p>
          <div className="cob-cards rw-cats">{areaCats.map(c => (
            <Opt key={c} on={r.cat === c} t={c === '목표 관리' ? '영역 공통' : c} sub={`목표 ${goalOpts.filter(g => g.cat === target(c)).length}개${goalOk(c) ? '' : ' · 목표는 영역 공통에 저장'}`} onClick={() => pickCat(c)} />))}</div>
        </>}
        {step === 'goal' && <>
          <p className="cob-q">{r.cat === '목표 관리' ? '영역 공통' : r.cat}의 어느 목표에 연결할까요?<span className="muted">연결하면 그 목표 아래 작업으로 들어가요 (마감 · D-day 로 관리) · 새 목표는 이 카테고리에 자동으로 만들어져요</span></p>
          <div className="rw-goals">
            <label className={`rw-g ${!r.goal ? 'on' : ''}`}><input type="radio" checked={!r.goal} onChange={() => set({ goal: '' })} />연결 안 함</label>
            {[...new Set(routines.filter(x => x.key !== r.key && x.goal === '__new' && x.newGoal.trim() && target(x.cat) === target(r.cat)).map(x => x.newGoal.trim()))].map(n => (
              <label key={`new-${n}`} className={`rw-g ${r.goal === '__new' && r.newGoal.trim() === n ? 'on' : ''}`}><input type="radio" checked={r.goal === '__new' && r.newGoal.trim() === n} onChange={() => set({ goal: '__new', newGoal: n })} />{n} <small className="muted">(이번에 만드는 새 목표)</small></label>))}
            {catGoals.map(g => <label key={g.key} className={`rw-g ${r.goal === g.key ? 'on' : ''}`}><input type="radio" checked={r.goal === g.key} onChange={() => set({ goal: g.key })} />{g.name}</label>)}
            <label className={`rw-g ${r.goal === '__new' ? 'on' : ''}`}><input type="radio" checked={r.goal === '__new' && !routines.some(x => x.key !== r.key && x.goal === '__new' && x.newGoal.trim() === r.newGoal.trim() && target(x.cat) === target(r.cat))} onChange={() => set({ goal: '__new', newGoal: `${r.action.trim()} 꾸준히 하기` })} />+ 새 목표 만들기 <small className="muted">({target(r.cat) === '목표 관리' ? '영역 공통' : target(r.cat)}에 생성)</small></label>
            {r.goal === '__new' && !routines.some(x => x.key !== r.key && x.goal === '__new' && x.newGoal.trim() === r.newGoal.trim() && target(x.cat) === target(r.cat)) && <><input className="rw-name" value={r.newGoal} onChange={e => set({ newGoal: e.target.value })} placeholder="새 목표 이름 (예: 10월 체력 만들기)" autoFocus list="rw-newg" />
              <datalist id="rw-newg">{newNames.map(n => <option key={n} value={n} />)}</datalist></>}
          </div>
        </>}
        {step === 'ok' && <>
          <p className="cob-q">이렇게 추가할까요?</p>
          <ul className="go-sum">
            <li><b>{r.action}</b></li><li>{cycTxt(r)}</li><li>{timeTxt(r)}</li>
            <li>카테고리: {r.cat === '목표 관리' ? '영역 공통' : r.cat}</li>
            <li>{r.goal ? `목표: ${r.goal === '__new' ? `(새 · ${target(r.cat) === '목표 관리' ? '영역 공통' : target(r.cat)}에 생성) ${r.newGoal.trim()}` : goalOpts.find(g => g.key === r.goal)?.name}` : '목표 연결 안 함'}</li>
          </ul>
        </>}
      </div>
      <div className="go-foot">
        {si > 0 && <button className="btn" onClick={() => go(steps.indexOf(step) - 1)}>이전</button>}
        {step === 'ok' ? <button className="btn primary grow-r" onClick={() => onDone(r)}>{wiz.edit ? '고치기' : '루틴 추가'}</button>
          : <button className="btn primary grow-r" disabled={!ok} onClick={() => go(steps.indexOf(step) + 1)}>다음</button>}
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
