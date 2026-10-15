/* 숙원 사업 돌아보기 알림 — 서버 푸시(server/push.mjs → notify.js)에서도 쓰므로 data.js 만 불러온다
   store.notify.wish = { on, time } (기본 켜짐 · 매월 첫 일요일 저녁 8시). 착수 전 숙원이 있을 때만, 가장 오래 멈춘 숙원을 알려 준다 */
import { iso } from './data.js';

export const WISH_REMIND = { on: true, time: '20:00' };
export const wishRemindOf = store => ({ ...WISH_REMIND, ...(store.notify?.wish || {}) });
/** 착수 전 숙원 중 가장 오래 손대지 않은 것 */
export const stalestWish = store => (store.wishes || []).filter(w => w.stage < 5).sort((a, b) => (a.touched || a.at).localeCompare(b.touched || b.at))[0] || null;
const atHm = (date, hm) => new Date(`${date}T${hm}:00`);

/** from 부터 days 일 동안 울릴 돌아보기 알림 (매월 첫 일요일) */
export function upcomingWish(store, from = new Date(), days = 7) {
  const R = wishRemindOf(store), w = stalestWish(store), out = [];
  if (!R.on || !w || !/^\d\d:\d\d$/.test(R.time)) return out;
  for (let i = 0; i <= days; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i);
    if (d.getDay() !== 0 || d.getDate() > 7) continue;
    const k = iso(d), when = atHm(k, R.time);
    if (when >= from) out.push({ key: `wish:${k.slice(0, 7)}`, kind: 'wish', title: '이번 달 숙원 돌아보기', body: `"${w.title}" 다음 작은 일을 정해 보세요`, when, url: '/#/wishes' });
  }
  return out;
}
/** 지금 보낼 돌아보기 알림 (이미 보낸 것 · 2시간 넘게 지난 것 빼고) */
export const dueWish = (store, now = new Date(), sent = new Set()) => upcomingWish(store, new Date(now.getTime() - 864e5), 1).filter(n => n.when <= now && now - n.when < 2 * 3600e3 && !sent.has(n.key));
