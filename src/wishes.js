/* 숙원 사업 데이터 (store.wishes) — 언젠가 하고 싶은 일을 5단계로 키워 목표로 옮긴다
   wish = { id, at, touched(마지막으로 손댄 때), title, area, stage: 1 씨앗 · 2 탐색 · 3 구체화 · 4 준비 · 5 착수,
            q: { what, why, who, need, first, block, when } (구체화 질문 7가지), firstDate(첫 실험 날짜), next(다음 작은 일),
            refs: [{ id, kind: note | link | idea, text, url, ideaId, at }] (자료), log: [{ at, t }] (기록),
            ai: { fill, next, cases, at } (AI 로 구체화 결과), goal: { key, id } (착수하면 만든 목표) }
   단계를 넘어가는 조건: 씨앗 → "왜" 적기 / 탐색 → 자료 3개 / 구체화 → 질문 5개 답 / 준비 → 첫 실험 날짜 / 착수 → 목표 관리로 */
import { iso } from './data.js';
import { EMPTY, boardKey, seedGoals } from './categories/goals.js';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const STAGES = ['', '씨앗', '탐색', '구체화', '준비', '착수'];
export const STAGE_NOTE = ['', '하고 싶다는 마음만 있음', '자료 · 생각 · 사례를 모으는 중', '7가지 질문으로 모양을 잡는 중', '첫 작은 실험과 필요한 것을 정하는 중', '목표 관리로 옮겨 시작함'];
export const QS = [['what', '무엇을', '예: 매년 가족 여행 사진으로 얇은 책 한 권'], ['why', '왜', '왜 하고 싶나요? 이루면 무엇이 달라지나요?'], ['who', '누구를 위해', '나 · 가족 · 손님 · 누구에게 좋은 일인가요?'],
  ['need', '필요한 것 (돈 · 시간 · 사람)', '예: 50만 원 · 주말 4번 · 디자인 도와줄 사람'], ['first', '첫 작은 실험', '예: 작년 여행 하나로 10쪽짜리 시험본 만들기'], ['block', '걸림돌', '무엇 때문에 아직 못 했나요?'], ['when', '언제쯤', '예: 내년 봄 · 아이 생일 전']];
export const answered = w => QS.filter(([k]) => (w.q?.[k] || '').trim()).length;

/** 다음 단계로 넘어갈 수 있는지 → { ok, need(안 될 때 이유) } */
export function gate(w) {
  if (w.stage === 1) return (w.q?.why || '').trim() ? { ok: true } : { ok: false, need: '"왜" 칸을 적으면 탐색으로 넘어갑니다' };
  if (w.stage === 2) return (w.refs || []).length >= 3 ? { ok: true } : { ok: false, need: `자료를 ${3 - (w.refs || []).length}개 더 모으면 구체화로 넘어갑니다` };
  if (w.stage === 3) return answered(w) >= 5 ? { ok: true } : { ok: false, need: `질문에 ${5 - answered(w)}개 더 답하면 준비로 넘어갑니다` };
  if (w.stage === 4) return w.firstDate ? { ok: true } : { ok: false, need: '첫 실험 날짜를 정하면 착수할 수 있습니다' };
  return { ok: false, need: '이미 착수했습니다' };
}
/** 단계에 맞는 기본 "다음 작은 일" (비어 있을 때 보여 줌) */
export const nextHint = w => (w.next || '').trim() || [, '왜 하고 싶은지 적기', '관련 자료 · 사례 하나 찾아 두기', `비어 있는 질문 하나 답하기 (${answered(w)}/7)`, '첫 실험 날짜 정하기', '목표 관리에서 진행'][w.stage];
export const daysIdle = w => Math.max(0, Math.floor((Date.now() - new Date(w.touched || w.at)) / 864e5));
export const idleText = w => { const d = daysIdle(w); return d < 1 ? '오늘 손댐' : `${d}일째 그대로`; };

const logged = (w, t, now = new Date()) => ({ ...w, touched: now.toISOString(), log: [{ at: now.toISOString(), t }, ...(w.log || [])].slice(0, 60) });
export const newWish = (title, area = 'P', extra = {}) => logged({ id: uid(), at: new Date().toISOString(), title: title.trim(), area, stage: 1, q: {}, firstDate: '', next: '', refs: [], log: [], ...extra }, '씨앗으로 추가');

/** 숙원 하나 고치기 (+ 기록 한 줄) */
export const patchWish = (s, id, p, t) => ({ ...s, wishes: (s.wishes || []).map(w => (w.id !== id ? w : t ? logged({ ...w, ...p }, t) : { ...w, ...p, touched: new Date().toISOString() })) });
export const addWish = (s, w) => ({ ...s, wishes: [w, ...(s.wishes || [])] });
export const addRef = (s, id, ref) => { const w = (s.wishes || []).find(x => x.id === id); return w ? patchWish(s, id, { refs: [...(w.refs || []), { id: uid(), at: new Date().toISOString(), ...ref }] }, `자료 추가: ${ref.text.slice(0, 40)}`) : s; };

/** 아이디어 → 숙원 (새 숙원으로 만들거나 있는 숙원의 자료로). 아이디어에 wish 표시, 스침이면 확인함으로 */
export function ideaToWish(s, idea, wishId, area) {
  const ref = { kind: 'idea', ideaId: idea.id, text: idea.title || idea.text.slice(0, 60) };
  let next;
  if (wishId) next = addRef(s, wishId, ref);
  else { const w = newWish(idea.title || idea.text.slice(0, 30), idea.area || area || 'P', { q: { what: (idea.points?.[0] || idea.text).slice(0, 200) } }); wishId = w.id; next = addRef(addWish(s, w), w.id, ref); }
  return { ...next, ideas: (next.ideas || []).map(i => (i.id !== idea.id ? i : { ...i, wish: wishId, status: ['inbox', 'new'].includes(i.status) && !i.ai ? 'seen' : i.status })) };
}

/** 착수: 목표 관리에 목표 + To do (첫 실험 · 다음 작은 일) 를 만들고 5단계로 */
export function launchWish(s, id, end, now = new Date()) {
  const w = (s.wishes || []).find(x => x.id === id);
  if (!w) return s;
  const today = iso(now), G = s.goals?.v === 2 ? s.goals : seedGoals(now), k = boardKey(w.area || 'P', '목표 관리'), b = G.boards[k] || { ...EMPTY };
  const gid = uid(), fin = end && end > today ? end : `${now.getFullYear() + 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todo = (name, d) => ({ id: uid(), parent: gid, name, start: today, end: d && d >= today && d <= fin ? d : fin, progress: 0, todo: true, done: false });
  const items = [{ id: gid, parent: null, name: w.title, start: today, end: fin, progress: 0, detail: [w.q?.what, w.q?.why && `왜: ${w.q.why}`].filter(Boolean).join(' · ') }];
  if ((w.q?.first || '').trim()) items.push(todo(`첫 실험: ${w.q.first.trim()}`, w.firstDate));
  if ((w.next || '').trim() && w.next.trim() !== (w.q?.first || '').trim()) items.push(todo(w.next.trim(), ''));
  const next = { ...s, goals: { ...G, boards: { ...G.boards, [k]: { ...b, items: [...b.items, ...items] } } } };
  return patchWish(next, id, { stage: 5, goal: { key: k, id: gid } }, `착수 — 목표 관리에 "${w.title}" 목표를 만듦`);
}
