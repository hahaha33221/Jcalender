import { iso } from '../data.js';

/* 목표 관리 (WBS + 마일스톤). 영역(P·B·W)마다 따로 저장한다
   goals[area] = {
     items: [{ id, parent(null 이면 최상위 목표), name, start, end, progress(0~100, 하위가 없는 작업만 사용) }],
     miles: [{ id, name, date, link(연결된 item id 또는 null), done }],
   } */
const uid = () => Math.random().toString(36).slice(2, 10);
export const toDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);

/* ── 예시 데이터 (오늘 기준 날짜) ── */
const TEMPLATES = {
  P: {
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

export function seedGoals(today = new Date()) {
  const t = iso(today), out = {};
  for (const [area, tpl] of Object.entries(TEMPLATES)) {
    const items = [];
    const walk = (list, parent) => list.forEach(([name, s, e, sub]) => {
      const id = uid();
      const leaf = typeof sub === 'number';
      items.push({ id, parent, name, start: addDays(t, s), end: addDays(t, e), progress: leaf ? sub : 0 });
      if (!leaf) walk(sub, id);
    });
    walk(tpl.goals, null);
    const roots = items.filter(i => !i.parent);
    const miles = tpl.miles.map(([name, d, root, done]) => ({ id: uid(), name, date: addDays(t, d), link: roots[root]?.id || null, done: !!done }));
    out[area] = { items, miles };
  }
  return out;
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

/** 진행률: 하위가 없으면 입력값, 있으면 하위 작업들의 기간 가중 평균 */
export function progressOf(items, id) {
  const it = items.find(i => i.id === id);
  const kids = childrenOf(items, id);
  if (!kids.length) return it ? Number(it.progress) || 0 : 0;
  let w = 0, sum = 0;
  kids.forEach(k => { const d = Math.max(1, daysBetween(k.start, k.end) + 1); w += d; sum += d * progressOf(items, k.id); });
  return w ? Math.round(sum / w) : 0;
}

/** 상태: 완료 / 지연(종료일 지남) / 예정(시작 전) / 진행 */
export function statusOf(it, progress, today) {
  if (progress >= 100) return { k: 'done', t: '완료' };
  if (it.end < today) return { k: 'late', t: '지연' };
  if (it.start > today) return { k: 'plan', t: '예정' };
  return { k: 'run', t: '진행' };
}

/* ── 변경 ── */
export const addItem = (g, parent, today) => {
  const p = g.items.find(i => i.id === parent);
  const start = p ? p.start : today, end = p ? p.end : addDays(today, 30);
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
