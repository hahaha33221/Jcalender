/* 아이디어 정리 알림 — 서버 푸시(server/push.mjs → notify.js)에서도 쓰므로 data.js 만 불러온다
   store.notify.idea = { on, time } (기본 켜짐 · 밤 11시). 정리할 스침이 있을 때만 울린다. "알림 켜기"와 따로 */
import { iso } from './data.js';

/** 단계 (예전 status new 도 읽음) */
export const stageOf = i => (i.status === 'new' ? (i.ai ? 'key' : 'inbox') : i.status || 'inbox');

export const IDEA_REMIND = { on: true, time: '23:00' };
export const ideaRemindOf = store => ({ ...IDEA_REMIND, ...(store.notify?.idea || {}) });
const atHm = (date, hm) => new Date(`${date}T${hm}:00`);
/** from 부터 days 일 동안 울릴 정리 알림 */
export function upcomingIdea(store, from = new Date(), days = 7) {
  const R = ideaRemindOf(store), n = (store.ideas || []).filter(i => stageOf(i) === 'inbox').length, out = [];
  if (!R.on || !n || !/^\d\d:\d\d$/.test(R.time)) return out;
  for (let i = 0; i <= days; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i);
    const k = iso(d), when = atHm(k, R.time);
    if (when >= from) out.push({ key: `idea:${k}`, kind: 'idea', title: '오늘 스친 생각을 정리할 시간이에요', body: `정리할 스침 ${n}개 · 체크 · 중요 · 버리기`, when, url: '/#/ideas' });
  }
  return out;
}
/** 지금 보낼 정리 알림 (이미 보낸 것 · 2시간 넘게 지난 것 빼고) */
export const dueIdea = (store, now = new Date(), sent = new Set()) => upcomingIdea(store, new Date(now.getTime() - 864e5), 1).filter(n => n.when <= now && now - n.when < 2 * 3600e3 && !sent.has(n.key));
