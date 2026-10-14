/* 아이디어 뱅크 데이터 (store.ideas) · 정리 단계 · 바로 적용
   idea = { id, at, src: voice | text, sec(녹음 길이), text(받아 적은 원문), title, summary, area, cat, tags, ai(정리됨),
            status: inbox(스침 · 정리 대기) | seen(체크 · 봤음) | key(중요) | applied(할 일 모두 적용) | archived(보관) | dropped(버림 · 30일 뒤 삭제),
            later(나중에 누른 날 — 그날 정리에서는 빼고 다음 날 다시), droppedAt,
            points: ['핵심 한 줄', …] (AI 정리 · 3줄, 긴 회의는 5줄까지),
            actions: [{ id, type: event | todo | check | goal | note, title, who, date, time, cycle, goal, detail, done: { at, ref } | null }] }
   예전 데이터: status new → AI 정리됐으면 key, 아니면 inbox (stageOf) · minutes(회의록) → 핵심 줄로 바꿔 보여 줌 (pointsOf)
   흐름: 스치면 한 줄 · 짧은 녹음으로 바로 저장(AI 없음) → 하루 한 번 정리(카드 넘기기: 체크 · 중요 · 나중에 · 버리기, 밤 11시 알림)
         → 중요로 올리면 AI 가 핵심 3줄 + 할 일로 정리 → 할 일을 캘린더 · 목표 · 체크리스트에 적용
   적용하면 실제 데이터로 들어간다: event → 캘린더 일정, todo → 고른 목표의 To do (목표가 없으면 체크리스트 수시 항목),
   check → 체크리스트 반복 항목(매일 · 매주 · 매월), goal → 새 목표(그 카테고리 목표 보드, 없으면 영역 공통), note → 기록만 */
import { AREAS, CATS, iso } from './data.js';
import { EMPTY, boardKey, hasGoals, seedGoals } from './categories/goals.js';
import { stageOf } from './ideaRemind.js';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const TYPES = { event: '캘린더 일정', todo: '목표 To do', check: '반복 체크', goal: '새 목표', note: '기록만' };
export const CYC = { D: '매일', W: '매주', M: '매월' };

/** 글 속 #태그 (한글 · 영문 · 숫자, 20자까지) */
export const tagsIn = text => [...new Set([...String(text).matchAll(/(?:^|\s)#([^\s#.,!?]{1,20})/g)].map(m => m[1]))].slice(0, 6);
/** 새 아이디어 = 스침 (받아 적은 글만, AI 정리는 중요로 올릴 때). 글에 #태그 를 쓰면 태그로 */
export const newIdea = (text, src, area = 'P', sec = 0, status = 'inbox') => ({ id: uid(), at: new Date().toISOString(), src, sec, text, title: text.replace(/(?:^|\s)#[^\s#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30) || text.slice(0, 30), summary: '', area, cat: '', tags: tagsIn(text), ai: false, status, points: [], actions: [] });

/** 스침(from)을 다른 아이디어(to)에 합치기: 글은 덧붙이고, 핵심에 한 줄 추가, 태그 합침 → 스침은 지움 */
export function mergeIdea(s, fromId, toId) {
  const f = (s.ideas || []).find(i => i.id === fromId), t = (s.ideas || []).find(i => i.id === toId);
  if (!f || !t || f.id === t.id) return s;
  const d = new Date(f.at), line = f.text.replace(/(?:^|\s)#[^\s#]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { ...s, ideas: s.ideas.filter(i => i.id !== fromId).map(i => (i.id !== toId ? i : { ...i,
    text: `${i.text}\n\n[덧붙임 ${d.getMonth() + 1}/${d.getDate()}] ${f.text}`, points: [...pointsOf(i), line.length > 120 ? `${line.slice(0, 120)}…` : line].filter(Boolean),
    tags: [...new Set([...(i.tags || []), ...(f.tags || [])])].slice(0, 8), minutes: undefined, merged: [...(i.merged || []), f.id] })) };
}
/** 태그별 개수 (버린 것 빼고), 많은 순 */
export const tagCounts = store => { const m = new Map(); (store.ideas || []).filter(i => stageOf(i) !== 'dropped').forEach(i => (i.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1))); return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };

export { stageOf };
export const STAGES = { inbox: '정리 대기', seen: '확인함', key: '중요', applied: '적용함', archived: '보관', dropped: '버림' };
const dayOf = s => iso(new Date(s));
/** 오늘 정리할 스침 (오늘 "나중에" 누른 것은 빼고, 오래된 것부터) */
export const toTriage = (store, today) => (store.ideas || []).filter(i => stageOf(i) === 'inbox' && i.later !== today).sort((a, b) => a.at.localeCompare(b.at));
/** 숫자: 오늘 스침 · 정리 대기 · 중요 · 할 일 대기 */
export function ideaStats(store, today) {
  const all = store.ideas || [];
  return {
    today: all.filter(i => dayOf(i.at) === today && stageOf(i) !== 'dropped').length,
    inbox: all.filter(i => stageOf(i) === 'inbox').length,
    key: all.filter(i => stageOf(i) === 'key').length,
    todo: all.filter(i => ['key', 'applied'].includes(stageOf(i))).reduce((n, i) => n + i.actions.filter(a => !a.done && a.type !== 'note').length, 0),
  };
}
/** 버린 지 30일 지난 것 지우기 */
export const purgeDropped = (ideas, now = new Date()) => ideas.filter(i => stageOf(i) !== 'dropped' || !i.droppedAt || now - new Date(i.droppedAt) < 30 * 864e5);

/** 핵심 줄 (예전 회의록은 결론 + 안건 내용으로) */
export function pointsOf(idea) {
  if (idea.points?.length) return idea.points;
  const M = idea.minutes;
  if (!M) return idea.summary ? [idea.summary] : [];
  const out = [];
  if (M.conclusion && M.conclusion !== '결정 사항 없음') out.push(M.conclusion);
  (M.agenda || []).forEach(a => a.points.forEach(p => out.push(p)));
  return (out.length ? out : [M.overview].filter(Boolean)).slice(0, 5);
}

/** AI 정리 결과를 아이디어에 넣기 (이미 적용한 행동은 남김) → 중요 */
export const withAi = (idea, r) => ({ ...idea, title: r.title || idea.title, summary: r.summary || '', area: r.area || idea.area, cat: r.cat || '', tags: r.tags || [], ai: true,
  points: r.points?.length ? r.points : pointsOf({ ...idea, points: [], minutes: r.minutes, summary: r.summary }), minutes: undefined,
  status: ['applied', 'archived'].includes(idea.status) ? idea.status : 'key',
  actions: [...idea.actions.filter(x => x.done), ...(r.actions || []).map(x => ({ id: uid(), ...x, done: null }))] });

/** 정리한 내용을 글로 (복사 · 내려받기): 제목 · 핵심 · 할 일 */
export function ideaText(idea, typeName = t => t) {
  const d = new Date(idea.at), when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const P = pointsOf(idea);
  return [idea.title, `${when}${idea.sec ? ` · 녹음 ${Math.max(1, Math.round(idea.sec / 60))}분` : ''}${idea.tags?.length ? ` · ${idea.tags.map(t => `#${t}`).join(' ')}` : ''}`, '',
    '핵심', ...(P.length ? P.map(p => `- ${p}`) : ['- 없음']), '',
    '할 일', ...((idea.actions || []).length ? idea.actions.map(a => `${a.done ? '[v]' : '[ ]'} ${a.title}${a.who ? ` (담당: ${a.who})` : ''}${a.date ? ` · ${a.date}${a.time ? ` ${a.time}` : ''}` : ''} · ${typeName(a.type)}`) : ['- 없음'])].join('\n');
}

/** 영역 · 카테고리 · 목표 목록 (AI 정리에 넘김) */
export function contextOf(store, areas) {
  const boards = store.goals?.v === 2 ? store.goals.boards : {};
  const goals = [];
  Object.entries(boards).forEach(([k, b]) => { const [a, cat] = k.split('|'); if (!areas.includes(a)) return; (b.items || []).filter(i => !i.parent && !i.done).forEach(i => goals.push({ id: i.id, name: i.name, a, cat, end: i.end })); });
  return { areas: areas.map(a => ({ a, n: AREAS[a].n, cats: [...new Set(CATS.filter(r => r.a === a && r.cat !== '목표 관리').map(r => r.cat))] })), goals };
}

/** 목표 찾기: { key(보드), item } */
export function findGoal(store, id) {
  for (const [k, b] of Object.entries(store.goals?.boards || {})) { const it = (b.items || []).find(i => i.id === id); if (it) return { key: k, item: it }; }
  return null;
}

const catOf = (area, cat) => (cat && CATS.some(r => r.a === area && r.cat === cat) ? cat : '아이디어');

/** 행동 하나 적용 → 새 store */
export function applyAction(s, ideaId, actId, now = new Date()) {
  const today = iso(now);
  const idea = (s.ideas || []).find(i => i.id === ideaId), x = idea?.actions.find(a => a.id === actId);
  if (!idea || !x || x.done) return s;
  const area = idea.area || 'P', id = uid();
  let next = s, ref = '';
  const goalsOf = st => (st.goals?.v === 2 ? st.goals : seedGoals(now));
  const addRow = (c, extra = {}) => { const cl = next.checklist || {}, cat = catOf(area, idea.cat); next = { ...next, checklist: { ...cl, custom: [...(cl.custom || []), { id: `u${id}`, a: area, c, cat, item: cat, action: x.title, detail: x.detail || `아이디어: ${idea.title}`, ...extra }] } }; ref = `check:u${id}`; };
  if (x.type === 'event') {
    next = { ...s, events: [...(s.events || []), { id, date: x.date || today, time: x.time || '', end: '', title: x.title, area, memo: `아이디어: ${idea.title}${x.detail ? ` · ${x.detail}` : ''}` }] };
    ref = `event:${id}`;
  } else if (x.type === 'todo') {
    const g = x.goal && findGoal(s, x.goal);
    if (g) {
      const G = goalsOf(s), b = G.boards[g.key];
      const start = today >= g.item.start && today <= g.item.end ? today : g.item.start, end = x.date && x.date >= start && x.date <= g.item.end ? x.date : g.item.end;
      next = { ...s, goals: { ...G, boards: { ...G.boards, [g.key]: { ...b, items: [...b.items, { id, parent: g.item.id, name: x.title, start, end, progress: 0, todo: true, done: false, ...(x.detail ? { note: x.detail } : {}) }] } } } };
      ref = `goal:${g.key}:${id}`;
    } else addRow('S');                                          // 목표를 안 골랐으면 체크리스트 수시 항목
  } else if (x.type === 'check') addRow(['D', 'W', 'M'].includes(x.cycle) ? x.cycle : 'D');
  else if (x.type === 'goal') {
    const G = goalsOf(s), c = idea.cat && hasGoals(area, idea.cat) ? idea.cat : '목표 관리', k = boardKey(area, c), b = G.boards[k] || { ...EMPTY };
    next = { ...s, goals: { ...G, boards: { ...G.boards, [k]: { ...b, items: [...b.items, { id, parent: null, name: x.title, start: today, end: x.date && x.date >= today ? x.date : `${now.getFullYear()}-12-31`, progress: 0, ...(idea.summary ? { detail: idea.summary } : {}) }] } } } };
    ref = `goal:${k}:${id}`;
  }
  const acts = idea.actions.map(a => (a.id === actId ? { ...a, done: { at: now.toISOString(), ref } } : a));
  const status = idea.status === 'archived' ? 'archived' : acts.some(a => a.type !== 'note') && acts.filter(a => a.type !== 'note').every(a => a.done) ? 'applied' : stageOf(idea);
  return { ...next, ideas: next.ideas.map(i => (i.id === ideaId ? { ...i, actions: acts, status } : i)) };
}
