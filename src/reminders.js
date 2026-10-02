/* 저널링 알림 (journal.remind) — 일정을 계산하는 부분과 보내는 부분을 나눠 두어
   지금은 앱이 열려 있을 때 notify.js 가 1분마다 보내고(브라우저 알림 · 화면 알림),
   나중에 설치 앱(Capacitor 등)에서는 upcomingJournal() 결과를 기기의 "예약 알림(Local Notifications)"에 그대로 넘기면
   앱이 꺼져 있어도 정해진 시각에 울린다 (docs/notifications.md)
   journal.remind = { on, time: 'HH:MM', days: [0~6 (일~토)], skip(오늘 이미 썼으면 안 보냄),
                      weekly: { on, day: 0~6, time: 'HH:MM' } (주간 회고) } */
import { iso, pad, periodKey } from './data.js';

export const DEFAULT_REMIND = { on: false, time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], skip: true, weekly: { on: false, day: 0, time: '20:00' } };
export const remindOf = store => {
  const r = store.journal?.remind || {};
  return { ...DEFAULT_REMIND, ...r, weekly: { ...DEFAULT_REMIND.weekly, ...(r.weekly || {}) } };
};
const at = (date, hm) => new Date(`${date}T${hm}:00`);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** from 부터 days 일 동안 울릴 저널링 알림 (설치 앱의 예약 알림 · 화면의 "다음 알림" 표시에 사용) */
export function upcomingJournal(store, from = new Date(), days = 7) {
  const R = remindOf(store), out = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(from, i), k = iso(d), w = d.getDay();
    if (R.on && R.days.includes(w)) out.push({ key: `journal:${k}`, kind: 'daily', title: '오늘 하루 기록할 시간이에요', body: '저널링 › 오늘의 일기를 적어 보세요', when: at(k, R.time), date: k });
    if (R.weekly.on && Number(R.weekly.day) === w) out.push({ key: `review:${periodKey('W', d)}`, kind: 'weekly', title: '이번 주 회고를 적어 보세요', body: '잘한 것 · 아쉬운 것 · 다음 주에 해 볼 것', when: at(k, R.weekly.time), date: k });
  }
  return out.filter(n => n.when > from || iso(n.when) === iso(from)).sort((a, b) => a.when - b.when);
}

/** 지금 보낼 저널링 알림 (이미 보낸 것 · 2시간 넘게 지난 것 · 이미 쓴 것은 빼고) */
export function dueJournal(store, now = new Date(), sent = new Set()) {
  const R = remindOf(store);
  if (!R.on && !R.weekly.on) return [];
  const J = store.journal || {};
  const wrote = d => (J.entries || []).some(e => e.date === d && (e.text || '').trim());
  const reviewed = w => (J.reviews || []).some(r => r.week === w);
  return upcomingJournal(store, addDays(now, -1), 1).filter(n => {
    if (n.when > now || now - n.when >= 2 * 3600e3 || sent.has(n.key)) return false;
    if (n.kind === 'daily' && R.skip && wrote(n.date)) return false;
    if (n.kind === 'weekly' && reviewed(n.key.slice(7))) return false;
    return true;
  });
}

export const whenText = (d, WEEK) => `${d.getMonth() + 1}/${d.getDate()} (${WEEK[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
