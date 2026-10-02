/* 알림 (store.notify 설정, store.notifications 보낸 기록)
   - 앱이 열려 있는 동안 1분마다 확인해 때가 된 알림을 보낸다 (브라우저 알림 허용 시 OS 알림, 아니면 화면 오른쪽 위 알림)
   - 대상: 저널링 알림(journal.remind, reminders.js), 시간이 있는 일정(반복 회차 포함, 일정마다 remind 로 바꿀 수 있음), 기획 마감(planDays 일 전 오전 9시)
   - 같은 알림은 key 로 한 번만 보낸다. 기록은 최근 100개 */
import { iso, pad } from './data.js';
import { expandEvents } from './recur.js';
import { dueJournal } from './reminders.js';

const at = (date, hm) => new Date(`${date}T${hm}:00`);

/** 지금 보내야 할 알림 목록 (이미 보낸 key 제외, 2시간 넘게 지난 것은 건너뜀) */
export function dueNotifications(store, now = new Date()) {
  const N = store.notify || {};
  const sent = new Set((store.notifications || []).map(n => n.key));
  const out = dueJournal(store, now, sent);                 // 저널링 알림은 저널링 화면에서 따로 켠다 (reminders.js)
  if (!N.enabled) return out;
  const t0 = iso(now), t1 = iso(new Date(now.getTime() + 2 * 864e5));
  for (const e of expandEvents(store.events || [], t0, t1)) {
    if (!e.time) continue;
    const r = e.remind === 'off' ? null : Number(e.remind === '' || e.remind == null ? N.eventMinutes ?? 10 : e.remind);
    if (r == null || Number.isNaN(r)) continue;
    const when = new Date(at(e.date, e.time).getTime() - r * 60000);
    const key = `event:${e.id}`;
    if (when <= now && now - when < 2 * 3600e3 && !sent.has(key)) out.push({ key, title: e.title, body: `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8, 10))} ${e.time}${r ? ` · ${r >= 1440 ? '하루' : `${r}분`} 전` : ''}`, when });
  }
  const pd = Number(N.planDays ?? 1);
  if (pd >= 0) for (const p of store.plan?.plans || []) {
    if (!p.due || p.status === '확정' || p.status === '보류') continue;
    const d = new Date(`${p.due}T09:00:00`); d.setDate(d.getDate() - pd);
    const key = `plan:${p.id}:${p.due}`;
    if (d <= now && now - d < 12 * 3600e3 && !sent.has(key)) out.push({ key, title: `기획 마감 ${pd ? `D-${pd}` : '오늘'}`, body: p.title, when: d });
  }
  return out;
}

/** 보낸 알림을 기록에 남긴다 */
export const recordSent = (s, list) => ({ ...s, notifications: [...list.map(n => ({ id: n.key, key: n.key, title: n.title, body: n.body, at: `${iso(n.when)} ${pad(n.when.getHours())}:${pad(n.when.getMinutes())}`, sentAt: new Date().toISOString() })), ...(s.notifications || [])].slice(0, 100) });

/** OS 알림 (허용됐을 때만) */
export function showOsNotification(n) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(n.title, { body: n.body, tag: n.key }); } catch { /* 지원 안 함 */ }
}
