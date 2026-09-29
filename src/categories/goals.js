import { iso } from '../data.js';
import { EXTRA_MILES, GOAL_EXAMPLES } from './goalExamples.js';

/* 목표 관리 (WBS + 마일스톤). 카테고리마다 따로 저장하고 연 단위로 본다
   goals = { v: 2, boards: { '영역|카테고리': {
     items: [{ id, parent(null 이면 최상위 목표), name, start, end, progress(0~100, 하위가 없는 작업만 사용) }],
     miles: [{ id, name, date, link(연결된 item id 또는 null), done }],
   } } }
   '영역|목표 관리' 보드는 영역 전체에 걸친 목표를 담는다 */
export const boardKey = (area, cat) => `${area}|${cat}`;
/** 목표 보드를 두지 않는 카테고리 (상세 화면·통합 보기·예시 모두 제외) */
export const NO_GOAL = new Set(['P|기념일 관리']);
export const hasGoals = (area, cat) => !NO_GOAL.has(boardKey(area, cat));
/** 저장된 목표 데이터에서 목표를 두지 않는 카테고리의 보드를 지운다 */
export const dropNoGoal = g => { if (!g?.boards || ![...NO_GOAL].some(k => g.boards[k])) return g; const boards = { ...g.boards }; NO_GOAL.forEach(k => delete boards[k]); return { ...g, boards }; };
export const EMPTY = { items: [], miles: [] };
const uid = () => Math.random().toString(36).slice(2, 10);
export const toDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);

/* ── 이전 버전 예시 목표: 예전 형식 데이터를 옮길 때 이름으로 카테고리를 찾는 데만 쓴다 ── */
const TEMPLATES = {
  P: {
    cats: ['건강 관리', '자기계발/학습'],
    goals: [
      ['건강한 몸 만들기 (예시)', -20, 70, [
        ['운동 습관 만들기', -20, 30, [['주 3회 러닝 4주 유지', -20, 8, 60], ['근력 운동 루틴 정하기', -10, 5, 100], ['5km 기록 30분 이내', 9, 30, 0]]],
        ['식단 관리', 0, 70, [['식단 기록 2주', 0, 14, 20], ['외식 주 2회 이하', 15, 70, 0]]],
      ]],
      ['영어 실력 올리기 (예시)', -30, 60, [
        ['시험 준비', -30, 45, [['교재 1회독', -30, -2, 100], ['모의고사 3회', 0, 30, 30], ['오답 정리', 20, 45, 0]]],
      ]],
    ],
    miles: [['5km 완주', 30, 0], ['영어 시험 응시', 46, 1], ['근력 루틴 확정', 5, 0, true]],
  },
  B: {
    cats: ['매출/매입', '재고/상품'],
    goals: [
      ['4분기 매출 목표 달성 (예시)', -10, 90, [
        ['신규 고객 확보', -10, 50, [['제안서 템플릿 정비', -10, -1, 100], ['잠재 고객 20곳 발굴', 0, 25, 35], ['미팅 8건 진행', 15, 50, 0]]],
        ['기존 고객 재구매', 5, 90, [['재구매 제안 발송', 5, 20, 0], ['분기 리뷰 미팅', 60, 90, 0]]],
      ]],
      ['신규 상품 출시 (예시)', -25, 75, [
        ['기획', -25, -5, [['시장 조사', -25, -15, 100], ['상품 구성 확정', -14, -5, 100]]],
        ['제작·준비', -4, 55, [['샘플 제작', -4, 20, 40], ['상세 페이지 제작', 15, 55, 0]]],
        ['출시', 56, 75, [['출시 홍보', 56, 75, 0]]],
      ]],
    ],
    miles: [['상품 구성 확정', -5, 1, true], ['신규 상품 출시일', 60, 1], ['4분기 마감', 90, 0]],
  },
  W: {
    cats: ['업무 할일/프로젝트', '직무 학습'],
    goals: [
      ['프로젝트 A 완수 (예시)', -35, 55, [
        ['요구사항 정리', -35, -15, [['현업 인터뷰', -35, -25, 100], ['요구사항 문서', -24, -15, 100]]],
        ['개발', -14, 35, [['기능 1차 개발', -14, 10, 70], ['기능 2차 개발', 11, 35, 0]]],
        ['테스트·오픈', 36, 55, [['통합 테스트', 36, 48, 0], ['오픈 준비', 49, 55, 0]]],
      ]],
      ['직무 자격증 취득 (예시)', -5, 80, [
        ['학습', -5, 60, [['이론 강의 수강', -5, 30, 25], ['기출 문제 풀이', 31, 60, 0]]],
      ]],
    ],
    miles: [['요구사항 확정', -15, 0, true], ['1차 개발 완료', 10, 0], ['프로젝트 A 오픈', 55, 0], ['자격증 시험', 80, 1]],
  },
};

/** 처음 시작할 때: 모든 카테고리에 연간 예시 목표를 넣는다 */
export const seedGoals = (today = new Date()) => addExampleGoals({ v: 2, boards: {} }, today);

/** 이전 형식(영역별 한 덩어리)을 카테고리 보드로 옮긴다. 예시 목표는 이름으로 원래 카테고리를 찾고, 나머지는 '목표 관리' 보드로 */
export function migrateGoals(old) {
  if (!old || old.v === 2) return old;
  const boards = {};
  for (const [area, g] of Object.entries(old)) {
    const tpl = TEMPLATES[area];
    if (!tpl || !g?.items) continue;
    const rootOf = id => { let it = g.items.find(i => i.id === id); while (it?.parent) it = g.items.find(i => i.id === it.parent); return it; };
    const catOf = root => { const gi = tpl.goals.findIndex(x => x[0] === root?.name); return gi >= 0 ? tpl.cats[gi] : '목표 관리'; };
    g.items.forEach(it => { const k = boardKey(area, catOf(rootOf(it.id))); (boards[k] ||= { items: [], miles: [] }).items.push(it); });
    g.miles.forEach(m => { const k = boardKey(area, m.link ? catOf(rootOf(m.link)) : '목표 관리'); (boards[k] ||= { items: [], miles: [] }).miles.push(m); });
  }
  return { v: 2, boards };
}

/** 예시 목표 하나를 보드로 만든다. 작업 진행률은 오늘 기준(끝난 작업 100%, 시작 전 0%, 진행 중은 지난 기간 비율)으로 정한다 */
export function buildExample([name, phases, miles], today = new Date()) {
  const y = today.getFullYear(), t = iso(today), at = md => `${y}-${md}`;
  const items = [], root = { id: uid(), parent: null, name, progress: 0 };
  items.push(root);
  phases.forEach(([pn, tasks]) => {
    const ph = { id: uid(), parent: root.id, name: pn, progress: 0 };
    items.push(ph);
    tasks.forEach(([tn, s, e]) => {
      const start = at(s), end = at(e);
      let progress = 0;
      if (end < t) progress = 100;
      else if (start <= t) progress = Math.min(90, Math.round((daysBetween(start, t) + 1) / (daysBetween(start, end) + 1) * 10) * 10);
      items.push({ id: uid(), parent: ph.id, name: tn, start, end, progress });
    });
    const ts = items.filter(i => i.parent === ph.id);
    ph.start = ts.map(i => i.start).sort()[0]; ph.end = ts.map(i => i.end).sort().pop();
  });
  const ps = items.filter(i => i.parent === root.id);
  root.start = ps.map(i => i.start).sort()[0]; root.end = ps.map(i => i.end).sort().pop();
  return { items, miles: miles.map(([mn, d]) => ({ id: uid(), name: mn, date: at(d), link: root.id, done: at(d) < t })) };
}

/** 목표가 없는 카테고리에 예시 목표를 한 번만 채운다 (사용자가 만든 목표는 건드리지 않음) */
export function addExampleGoals(goals, today = new Date()) {
  if (!goals) return goals;
  if (goals.examples) return addExtraMiles(goals, today);
  const boards = { ...goals.boards };
  for (const [k, tpl] of Object.entries(GOAL_EXAMPLES)) {
    if (!boards[k] || !boards[k].items.length) boards[k] = buildExample(tpl, today);
  }
  return addExtraMiles({ ...goals, boards, examples: true }, today);
}

/** 예시 목표에 가까운 달 마일스톤을 한 번만 붙인다 (예시 목표가 남아 있을 때만) */
export function addExtraMiles(goals, today = new Date()) {
  if (!goals || goals.miles2) return goals;
  const y = today.getFullYear(), t = iso(today), boards = { ...goals.boards };
  for (const [k, list] of Object.entries(EXTRA_MILES)) {
    const b = boards[k], name = GOAL_EXAMPLES[k]?.[0];
    const root = b?.items.find(i => !i.parent && i.name === name);
    if (!root) continue;
    const add = list.filter(([n]) => !b.miles.some(m => m.name === n)).map(([n, md]) => ({ id: uid(), name: n, date: `${y}-${md}`, link: root.id, done: `${y}-${md}` < t }));
    if (add.length) boards[k] = { ...b, miles: [...b.miles, ...add] };
  }
  return { ...goals, boards, miles2: true };
}

/** 선택한 해에 걸치는 최상위 목표와 그 하위만 남긴 보드 */
export function boardForYear(g, year) {
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`;
  const roots = new Set(g.items.filter(i => !i.parent && i.start <= y1 && i.end >= y0).map(i => i.id));
  const keep = new Set(roots);
  let grew = true;
  while (grew) { grew = false; g.items.forEach(i => { if (i.parent && keep.has(i.parent) && !keep.has(i.id)) { keep.add(i.id); grew = true; } }); }
  return { items: g.items.filter(i => keep.has(i.id)), miles: g.miles.filter(m => m.date.slice(0, 4) === String(year)) };
}

/* ── 계산 ── */
export const childrenOf = (items, id) => items.filter(i => i.parent === id);

/** 트리 순서로 펼친 목록: [{ item, level, code('1.2.1'), hasKids }] */
export function flatten(items) {
  const out = [];
  const walk = (parent, prefix, level) => childrenOf(items, parent).forEach((it, i) => {
    const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
    const kids = childrenOf(items, it.id);
    out.push({ item: it, level, code, hasKids: kids.length > 0 });
    walk(it.id, code, level + 1);
  });
  walk(null, '', 0);
  return out;
}

/** 진행률: 하위가 없으면 leaf(항목) 값, 있으면 하위 작업들의 기간 가중 평균.
    leaf 는 화면에서 체크리스트 기록으로 계산하는 함수를 넘긴다 (checkProgress) */
export function progressOf(items, id, leaf = it => Number(it.progress) || 0) {
  const it = items.find(i => i.id === id);
  const kids = childrenOf(items, id);
  if (!kids.length) return it ? leaf(it) : 0;
  let w = 0, sum = 0;
  kids.forEach(k => { const d = Math.max(1, daysBetween(k.start, k.end) + 1); w += d; sum += d * progressOf(items, k.id, leaf); });
  return w ? Math.round(sum / w) : 0;
}

/** 체크리스트로 계산하는 작업 진행률 함수를 만든다.
    작업 기간(시작~종료) 동안 해야 할 체크 수 대비 실제 체크 수. 수시체크는 제외.
    rows: 이 보드가 따라가는 체크 항목(카테고리 전체 또는 영역 전체), item.link 가 있으면 그 항목 하나만 */
export function checkProgress(rows, done, periodKeysBetween) {
  const cache = new Map();
  return it => {
    const ck = `${it.start}|${it.end}|${it.link || ''}`;
    if (cache.has(ck)) return cache.get(ck);
    const use = (it.link ? rows.filter(r => r.id === it.link) : rows).filter(r => r.c !== 'S');
    let need = 0, got = 0;
    use.forEach(r => periodKeysBetween(r.c, it.start, it.end).forEach(k => { need++; if (done[`${r.id}@${k}`]) got++; }));
    const p = need ? Math.round(got / need * 100) : 0;
    cache.set(ck, p);
    return p;
  };
}

/** 상태: 완료 / 지연(종료일 지남) / 예정(시작 전) / 진행 */
export function statusOf(it, progress, today) {
  if (progress >= 100) return { k: 'done', t: '완료' };
  if (it.end < today) return { k: 'late', t: '지연' };
  if (it.start > today) return { k: 'plan', t: '예정' };
  return { k: 'run', t: '진행' };
}

/* ── 변경 ── */
/** 항목 추가. 최상위 목표는 선택한 해 안에서 (올해면 오늘부터) 연말까지로 잡는다 */
export const addItem = (g, parent, today, year = Number(today.slice(0, 4))) => {
  const p = g.items.find(i => i.id === parent);
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`;
  const start = p ? p.start : (today >= y0 && today <= y1 ? today : y0), end = p ? p.end : y1;
  const siblings = childrenOf(g.items, parent || null).length;
  return { ...g, items: [...g.items, { id: uid(), parent: parent || null, name: p ? `새 작업 ${siblings + 1}` : `새 목표 ${siblings + 1}`, start, end, progress: 0 }] };
};
export const updItem = (g, id, patch) => ({ ...g, items: g.items.map(i => (i.id === id ? { ...i, ...patch } : i)) });
export function delItem(g, id) {
  const gone = new Set([id]);
  let grew = true;
  while (grew) { grew = false; g.items.forEach(i => { if (i.parent && gone.has(i.parent) && !gone.has(i.id)) { gone.add(i.id); grew = true; } }); }
  return { items: g.items.filter(i => !gone.has(i.id)), miles: g.miles.map(m => (gone.has(m.link) ? { ...m, link: null } : m)) };
}
export const addMile = (g, m) => ({ ...g, miles: [...g.miles, { id: uid(), done: false, ...m }] });
export const updMile = (g, id, patch) => ({ ...g, miles: g.miles.map(m => (m.id === id ? { ...m, ...patch } : m)) });
export const delMile = (g, id) => ({ ...g, miles: g.miles.filter(m => m.id !== id) });
