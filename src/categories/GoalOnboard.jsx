import React, { useMemo, useState } from 'react';
import { AREAS, CATS, iso } from '../data.js';
import { Popup, useCtx } from '../shared.jsx';
import { GOAL_EXAMPLES } from './goalExamples.js';
import { EMPTY, boardForYear, boardKey, childrenOf, delItem, hasGoals, progressOf, seedGoals, toDate } from './goals.js';
import { leafFor } from './GoalView.jsx';

/* 목표 관리 온보딩 (팝업)
   - 처음: ① 올해 목표 설정 → ② 이번 달 마일스톤 → ③ 이번 달 할 일 → 저장 (예시 목표는 지울 수 있음)
   - 매월 1일부터 (그 달에 아직 안 했으면): ① 지난달 돌아보기(못 끝낸 것: 이번 달로 미루기 · 그대로 · 지우기) → ② 올해 목표 확인 · 추가 → ③ 마일스톤 → ④ 할 일
   store.goalOnboard = { [영역]: { setupAt: 'YYYY-MM-DD', months: { 'YYYY-MM': 'done' | 'skip' } } } */
const uid = () => Math.random().toString(36).slice(2, 10);
const ym = d => d.slice(0, 7);
const monthEnd = d => { const x = toDate(`${ym(d)}-01`); x.setMonth(x.getMonth() + 1); x.setDate(0); return iso(x); };
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
  const { store, setStore, now } = useCtx();
  const today = iso(now), year = now.getFullYear(), mEnd = monthEnd(today), last = prevMonth(today);
  const goals0 = store.goals?.v === 2 ? store.goals : seedGoals(now);
  const cats = goalCats(area);
  const boards = Object.fromEntries(cats.map(c => [c, goals0.boards[boardKey(area, c)] || EMPTY]));
  const isEx = n => /\(예시\)\s*$/.test(n);

  // 올해 목표 (이미 있는 것)
  const existing = useMemo(() => cats.flatMap(c => boardForYear(boards[c], year).items.filter(i => !i.parent).map(i => ({ key: i.id, cat: c, name: i.name, end: i.end, ex: isEx(i.name) }))), []);
  const hasEx = existing.some(g => g.ex);
  const [clearEx, setClearEx] = useState(mode === 'setup' && hasEx);
  const [news, setNews] = useState(mode === 'setup' ? [{ key: uid(), cat: cats[0], name: '', end: `${year}-12-31` }] : []);
  const goalList = [...existing.filter(g => !(clearEx && g.ex)), ...news.filter(g => g.name.trim())];

  // 지난달 돌아보기: 못 끝낸 마일스톤 · 작업
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

  const [miles, setMiles] = useState([]);                   // [{ key, goal, name, date }]
  const [tasks, setTasks] = useState([]);                   // [{ key, goal, name, end }]
  const steps = mode === 'month' ? ['review', 'goals', 'miles', 'tasks', 'done'] : ['goals', 'miles', 'tasks', 'done'];
  const [si, setSi] = useState(0);
  const step = steps[si];
  const NAMES = { review: '지난달 돌아보기', goals: mode === 'month' ? '올해 목표 확인' : '올해 목표 설정', miles: '이번 달 마일스톤', tasks: '이번 달 할 일', done: '확인 · 저장' };
  const goalName = k => goalList.find(g => g.key === k)?.name || '';
  const canNext = step !== 'goals' || goalList.length > 0;

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
      // 예시 목표 지우기
      if (clearEx) cats.forEach(c => {
        let b = B(c);
        const gone = b.items.filter(i => !i.parent && isEx(i.name)).map(i => i.id);
        b = { ...b, miles: b.miles.filter(m => !gone.includes(m.link)) };       // 예시 목표에 달린 마일스톤도 함께
        gone.forEach(id => { b = delItem(b, id); });
        bs[boardKey(area, c)] = b;
      });
      // 지난달 못 끝낸 것
      review.forEach(r => {
        const k = boardKey(area, r.cat), b = bs[k];
        if (!b) return;
        if (r.kind === 'mile') bs[k] = { ...b, miles: r.act === 'del' ? b.miles.filter(m => m.id !== r.id) : r.act === 'move' ? b.miles.map(m => (m.id === r.id ? { ...m, date: mEnd } : m)) : b.miles };
        else if (r.act === 'del') bs[k] = delItem(b, r.id);
        else if (r.act === 'move') bs[k] = { ...b, items: b.items.map(i => (i.id === r.id ? { ...i, end: mEnd } : i)) };
      });
      // 새 목표 → 최상위 항목
      const rootId = {}, catOfGoal = {};
      existing.forEach(g => { rootId[g.key] = g.key; catOfGoal[g.key] = g.cat; });
      news.filter(g => g.name.trim()).forEach(g => {
        const id = uid(), b = B(g.cat);
        bs[boardKey(area, g.cat)] = { ...b, items: [...b.items, { id, parent: null, name: g.name.trim(), start: today, end: g.end || `${year}-12-31`, progress: 0 }] };
        rootId[g.key] = id; catOfGoal[g.key] = g.cat;
      });
      // 할 일 → 목표 아래 작업 (목표 기간을 넘으면 목표 끝을 늘림)
      tasks.filter(t => t.name.trim() && rootId[t.goal]).forEach(t => {
        const k = boardKey(area, catOfGoal[t.goal]), b = bs[k], end = t.end || mEnd;
        bs[k] = { ...b, items: [...b.items.map(i => (i.id === rootId[t.goal] && i.end < end ? { ...i, end } : i)), { id: uid(), parent: rootId[t.goal], name: t.name.trim(), start: today, end, progress: 0 }] };
      });
      // 마일스톤
      miles.filter(m => m.name.trim() && rootId[m.goal]).forEach(m => {
        const k = boardKey(area, catOfGoal[m.goal]), b = bs[k];
        bs[k] = { ...b, miles: [...b.miles, { id: uid(), name: m.name.trim(), date: m.date || mEnd, link: rootId[m.goal], done: false }] };
      });
      const ob = s.goalOnboard?.[area] || {};
      return { ...s, goals: { ...cur, boards: bs }, goalOnboard: { ...(s.goalOnboard || {}), [area]: { ...ob, setupAt: ob.setupAt || today, months: { ...(ob.months || {}), [ym(today)]: 'done' } } } };
    });
    onClose(true);
  };

  const sugg = c => { const ex = GOAL_EXAMPLES[boardKey(area, c)]; return ex ? ex[0].replace(/\s*\(예시\)\s*$/, '') : ''; };
  const title = mode === 'month' ? `${Number(today.slice(5, 7))}월 목표 점검 · ${AREAS[area].n}` : `목표 설정 시작하기 · ${AREAS[area].n}`;
  return (
    <Popup wide title={title} sub={mode === 'month' ? '매월 1일부터 한 번: 지난달을 돌아보고 이번 달 할 일을 정합니다' : '올해 이루고 싶은 목표부터 정하고, 이번 달 마일스톤과 할 일로 쪼갭니다'} onClose={() => onClose(false)}>
      <ol className="go-steps">{steps.map((k, i) => <li key={k} className={i === si ? 'on' : i < si ? 'past' : ''}><span>{i + 1}</span>{NAMES[k]}</li>)}</ol>

      {step === 'review' && <div className="go-body">
        <p className="go-lead">{Number(last.slice(5))}월 마일스톤 {doneLast + review.filter(r => r.kind === 'mile').length}개 중 <b>{doneLast}개 완료</b>{review.length ? ` · 못 끝낸 것 ${review.length}개를 어떻게 할지 골라 주세요` : ' · 못 끝낸 것이 없습니다. 잘하셨어요!'}</p>
        {review.length > 0 && <ul className="go-review">{review.map(r => (
          <li key={r.id}>
            <span className="go-rn"><small className="tag">{r.kind === 'mile' ? '마일스톤' : `작업 ${r.p}%`}</small><b>{r.name}</b><small className="muted">{catLabel(r.cat)} · {md(r.date)}</small></span>
            <span className="chips" role="group" aria-label={`${r.name} 처리`}>{[['move', '이번 달로 미루기'], ['keep', '그대로'], ['del', '지우기']].map(([k, n]) => (
              <button key={k} aria-pressed={r.act === k} onClick={() => setReview(v => v.map(x => (x.id === r.id ? { ...x, act: k } : x)))}>{n}</button>))}</span>
          </li>))}</ul>}
      </div>}

      {step === 'goals' && <div className="go-body">
        <p className="go-lead">{mode === 'month' ? '올해 목표가 그대로 맞는지 보고, 새로 생긴 목표가 있으면 더하세요.' : '올해 꼭 이루고 싶은 목표를 1~3개 적어 보세요. 아래 추천을 눌러도 됩니다.'}</p>
        {existing.length > 0 && <ul className="go-ex">{existing.map(g => (
          <li key={g.key} className={clearEx && g.ex ? 'off' : ''}><small className="tag">{catLabel(g.cat)}</small><b>{g.name}</b><small className="muted">~ {md(g.end)}</small></li>))}</ul>}
        {hasEx && <label className="sh-chk go-clear"><input type="checkbox" checked={clearEx} onChange={e => setClearEx(e.target.checked)} />"(예시)" 목표는 지우고 내 목표로 시작하기</label>}
        {news.map((g, i) => (
          <div key={g.key} className="go-row">
            <select value={g.cat} onChange={e => setNews(v => v.map(x => (x.key === g.key ? { ...x, cat: e.target.value } : x)))} aria-label="카테고리">{cats.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select>
            <input value={g.name} placeholder={sugg(g.cat) ? `예: ${sugg(g.cat)}` : '목표 이름'} onChange={e => setNews(v => v.map(x => (x.key === g.key ? { ...x, name: e.target.value } : x)))} aria-label={`새 목표 ${i + 1}`} autoFocus={i === 0} />
            <label className="go-end">까지<input type="date" value={g.end} min={today} onChange={e => setNews(v => v.map(x => (x.key === g.key ? { ...x, end: e.target.value } : x)))} /></label>
            <button className="tl-del" onClick={() => setNews(v => v.filter(x => x.key !== g.key))} aria-label="빼기">×</button>
          </div>))}
        <button className="btn sm" onClick={() => setNews(v => [...v, { key: uid(), cat: cats[0], name: '', end: `${year}-12-31` }])}>+ 목표 더하기</button>
        <div className="go-sugg"><small className="muted">추천</small>{cats.filter(sugg).slice(0, 8).map(c => (
          <button key={c} className="chip-btn" onClick={() => setNews(v => { const empty = v.find(x => !x.name.trim()); const g = { key: empty?.key || uid(), cat: c, name: sugg(c), end: `${year}-12-31` }; return empty ? v.map(x => (x.key === empty.key ? g : x)) : [...v, g]; })}>
            <small>{catLabel(c)}</small> {sugg(c)}</button>))}</div>
      </div>}

      {step === 'miles' && <div className="go-body">
        <p className="go-lead">이번 달({Number(today.slice(5, 7))}월) 안에 확인할 수 있는 중간 결과를 목표마다 하나씩 정해 보세요. 예: "5km 30분 안에 달리기", "제안서 3곳 발송"</p>
        {goalList.map(g => (
          <div key={g.key} className="go-goal">
            <b>{g.name}</b>
            {miles.filter(m => m.goal === g.key).map(m => (
              <div key={m.key} className="go-row">
                <input value={m.name} placeholder="마일스톤" onChange={e => setMiles(v => v.map(x => (x.key === m.key ? { ...x, name: e.target.value } : x)))} aria-label={`${g.name} 마일스톤`} />
                <input type="date" value={m.date} min={today} max={mEnd} onChange={e => setMiles(v => v.map(x => (x.key === m.key ? { ...x, date: e.target.value } : x)))} />
                <button className="tl-del" onClick={() => setMiles(v => v.filter(x => x.key !== m.key))} aria-label="빼기">×</button>
              </div>))}
            <button className="btn sm" onClick={() => setMiles(v => [...v, { key: uid(), goal: g.key, name: '', date: mEnd }])}>+ 마일스톤</button>
          </div>))}
      </div>}

      {step === 'tasks' && <div className="go-body">
        <p className="go-lead">이번 달에 할 일을 목표 아래에 적어 두면 목표 관리 표(WBS)에 작업으로 들어갑니다. 진행률은 체크리스트 기록으로 계산됩니다.</p>
        {goalList.map(g => (
          <div key={g.key} className="go-goal">
            <b>{g.name}</b>
            {tasks.filter(t => t.goal === g.key).map(t => (
              <div key={t.key} className="go-row">
                <input value={t.name} placeholder="할 일" onChange={e => setTasks(v => v.map(x => (x.key === t.key ? { ...x, name: e.target.value } : x)))} aria-label={`${g.name} 할 일`} />
                <label className="go-end">까지<input type="date" value={t.end} min={today} onChange={e => setTasks(v => v.map(x => (x.key === t.key ? { ...x, end: e.target.value } : x)))} /></label>
                <button className="tl-del" onClick={() => setTasks(v => v.filter(x => x.key !== t.key))} aria-label="빼기">×</button>
              </div>))}
            <button className="btn sm" onClick={() => setTasks(v => [...v, { key: uid(), goal: g.key, name: '', end: mEnd }])}>+ 할 일</button>
          </div>))}
      </div>}

      {step === 'done' && <div className="go-body">
        <p className="go-lead">이대로 저장할까요? 저장한 뒤에도 목표 관리 표에서 언제든 고칠 수 있습니다.</p>
        <ul className="go-sum">
          {clearEx && <li>예시 목표 지우기</li>}
          {review.length > 0 && <li>지난달 못 끝낸 것: 미루기 {review.filter(r => r.act === 'move').length} · 그대로 {review.filter(r => r.act === 'keep').length} · 지우기 {review.filter(r => r.act === 'del').length}</li>}
          <li>새 목표 {news.filter(g => g.name.trim()).length}개{news.filter(g => g.name.trim()).map(g => ` · ${g.name}`).join('')}</li>
          <li>이번 달 마일스톤 {miles.filter(m => m.name.trim()).length}개 · 할 일 {tasks.filter(t => t.name.trim()).length}개</li>
        </ul>
      </div>}

      <div className="go-foot">
        {si > 0 && <button className="btn" onClick={() => setSi(si - 1)}>이전</button>}
        <button className="linkish" onClick={() => { markOnly(mode); onClose(false); }}>{mode === 'month' ? '이번 달은 건너뛰기' : '나중에 직접 할게요'}</button>
        {step === 'done' ? <button className="btn primary grow-r" onClick={save}>저장</button>
          : <button className="btn primary grow-r" disabled={!canNext} onClick={() => setSi(si + 1)}>{step === 'goals' && !goalList.length ? '목표를 하나 이상 적어 주세요' : '다음'}</button>}
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
      <div><h2>{month.length ? `${now.getMonth() + 1}월 목표 점검을 해 볼까요?` : '목표 설정부터 시작해 볼까요?'}</h2>
        <p className="muted">{month.length ? '지난달을 돌아보고 이번 달 마일스톤 · 할 일을 정합니다 (2~3분)' : '올해 목표를 정하고 이번 달 할 일로 쪼개 드려요'}</p></div>
      <span className="go-card-b">{[...month, ...setup].map(x => <button key={x.a} className="btn primary" onClick={() => openCat(x.a, '목표 관리')}>{AREAS[x.a].n} {x.need === 'month' ? '점검' : '목표 설정'}</button>)}</span>
    </section>
  );
}
