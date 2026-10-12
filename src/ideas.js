/* 아이디어 뱅크 데이터 (store.ideas) · 바로 적용
   idea = { id, at, src: voice | text, sec(녹음 길이), text(받아 적은 원문), title, summary, area, cat, tags, ai(정리됨), status: new | applied | archived,
            minutes: { overview, agenda: [{ title, points }], conclusion, etc } (회의록: 1.개요 2.안건 3.안건 별 주요 내용 4.결론 5.향후 진행 사항(= actions) 6.기타),
            actions: [{ id, type: event | todo | check | goal | note, title, who, date, time, cycle, goal, detail, done: { at, ref } | null }] }
   적용하면 실제 데이터로 들어간다: event → 캘린더 일정, todo → 고른 목표의 To do (목표가 없으면 체크리스트 수시 항목),
   check → 체크리스트 반복 항목(매일 · 매주 · 매월), goal → 새 목표(그 카테고리 목표 보드, 없으면 영역 공통), note → 기록만 */
import { AREAS, CATS, iso } from './data.js';
import { EMPTY, boardKey, hasGoals, seedGoals } from './categories/goals.js';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const TYPES = { event: '캘린더 일정', todo: '목표 To do', check: '반복 체크', goal: '새 목표', note: '기록만' };
export const CYC = { D: '매일', W: '매주', M: '매월' };

/** 새 아이디어 (받아 적은 글만, 정리는 나중에) */
export const newIdea = (text, src, area = 'P', sec = 0) => ({ id: uid(), at: new Date().toISOString(), src, sec, text, title: text.replace(/\s+/g, ' ').slice(0, 30), summary: '', area, cat: '', tags: [], ai: false, status: 'new', actions: [] });

/** AI 정리 결과를 아이디어에 넣기 (이미 적용한 행동은 남김) */
export const withAi = (idea, r) => ({ ...idea, title: r.title || idea.title, summary: r.summary || '', area: r.area || idea.area, cat: r.cat || '', tags: r.tags || [], ai: true, minutes: r.minutes || null,
  actions: [...idea.actions.filter(x => x.done), ...(r.actions || []).map(x => ({ id: uid(), ...x, done: null }))] });

/** 회의록을 글로 (복사 · 내려받기) */
export function minutesText(idea, typeName = t => t) {
  const M = idea.minutes || {}, L = [];
  const d = new Date(idea.at), when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  L.push(idea.title, `${when}${idea.sec ? ` · 녹음 ${Math.max(1, Math.round(idea.sec / 60))}분` : ''}${idea.tags?.length ? ` · ${idea.tags.map(t => `#${t}`).join(' ')}` : ''}`, '');
  L.push('1. 개요', M.overview || idea.summary || '', '');
  L.push('2. 안건', ...(M.agenda || []).map((a, i) => `${i + 1}) ${a.title}`), '');
  L.push('3. 안건 별 주요 내용');
  (M.agenda || []).forEach((a, i) => { L.push(`${i + 1}) ${a.title}`, ...a.points.map(p => `  - ${p}`)); });
  L.push('', '4. 결론', M.conclusion || '', '');
  L.push('5. 향후 진행 사항', ...(idea.actions || []).map(a => `- ${a.title}${a.who ? ` (담당: ${a.who})` : ''}${a.date ? ` · ${a.date}${a.time ? ` ${a.time}` : ''}` : ''} [${typeName(a.type)}${a.done ? ' · 적용함' : ''}]`), '');
  L.push('6. 기타', ...((M.etc || []).length ? M.etc.map(p => `- ${p}`) : ['- 없음']));
  return L.join('\n');
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
  const status = idea.status === 'archived' ? 'archived' : acts.some(a => a.type !== 'note') && acts.filter(a => a.type !== 'note').every(a => a.done) ? 'applied' : idea.status;
  return { ...next, ideas: next.ideas.map(i => (i.id === ideaId ? { ...i, actions: acts, status } : i)) };
}
