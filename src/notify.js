/* 알림 (store.notify 설정, store.notifications 보낸 기록)
   - 앱이 열려 있는 동안 1분마다 확인해 때가 된 알림을 보낸다 (브라우저 알림 허용 시 OS 알림, 아니면 화면 오른쪽 위 알림)
   - 대상: 저널링 알림(journal.remind, reminders.js), 시간이 있는 일정(반복 회차 · 루틴 포함, 일정마다 remind 로 바꿀 수 있음), 기획 마감(planDays 일 전 오전 9시),
     목표 마감(notify.goals: all = D-7 · D-1 · 당일 / day = 당일만 / off, 오전 9시, 완료한 목표는 빼고)
   - 서버(server/push.mjs)도 같은 규칙으로 1분마다 계산해 웹 푸시로 보낸다 (앱이 꺼져 있어도)
   - 같은 알림은 key 로 한 번만 보낸다. 기록은 최근 100개
   - 알람 관리 화면(AlarmManager.jsx)은 upcomingAlarms() 로 앞으로 울릴 알람을 미리 보여 준다 */
import { iso, pad } from './data.js';
import { expandEvents } from './recur.js';
import { dueJournal, upcomingJournal } from './reminders.js';

const at = (date, hm) => new Date(`${date}T${hm}:00`);
/** 직접 켠 알람: 루틴 · 알람 관리에서 만든 알람(alarm)에 알림 시점을 정해 두면 "알림 켜기"를 꺼 두어도 울린다 */
export const ownAlarm = e => !!(e.routine || e.alarm) && e.remind !== '' && e.remind != null && e.remind !== 'off';
/** 일정 알림이 몇 분 전인지 (null = 안 울림) */
export const remindMinutes = (e, N = {}) => { if (e.remind === 'off') return null; const r = Number(e.remind === '' || e.remind == null ? N.eventMinutes ?? 10 : e.remind); return Number.isNaN(r) ? null : r; };
export const remindLabel = r => (r == null ? '끔' : r === 0 ? '정각' : r >= 1440 ? `${r / 1440 === 1 ? '하루' : `${r / 1440}일`} 전` : r >= 60 ? `${r / 60}시간 전` : `${r}분 전`);

/** 지금 보내야 할 알림 목록 (이미 보낸 key 제외, 2시간 넘게 지난 것은 건너뜀) */
export function dueNotifications(store, now = new Date()) {
  const N = store.notify || {};
  const sent = new Set((store.notifications || []).map(n => n.key));
  const out = dueJournal(store, now, sent);                 // 저널링 알림은 저널링 화면에서 따로 켠다 (reminders.js)
  // 루틴 · 알람에 직접 켠 알림(예: 시작 5분 전)은 "알림 켜기"를 꺼 두어도 울린다
  const t0 = iso(now), t1 = iso(new Date(now.getTime() + 2 * 864e5));
  for (const e of expandEvents(store.events || [], t0, t1)) {
    if (!e.time || (!N.enabled && !ownAlarm(e))) continue;
    const r = remindMinutes(e, N);
    if (r == null) continue;
    const when = new Date(at(e.date, e.time).getTime() - r * 60000);
    const key = `event:${e.id}`;
    if (when <= now && now - when < 2 * 3600e3 && !sent.has(key)) out.push({ key, alarm: !!(e.routine || e.alarm), title: e.title, body: `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8, 10))} ${e.time}${r ? ` · ${r >= 1440 ? '하루' : `${r}분`} 전` : ''}`, when });
  }
  if (!N.enabled) return out;
  const pd = Number(N.planDays ?? 1);
  if (pd >= 0) for (const p of store.plan?.plans || []) {
    if (!p.due || p.status === '확정' || p.status === '보류') continue;
    const d = new Date(`${p.due}T09:00:00`); d.setDate(d.getDate() - pd);
    const key = `plan:${p.id}:${p.due}`;
    if (d <= now && now - d < 12 * 3600e3 && !sent.has(key)) out.push({ key, title: `기획 마감 ${pd ? `D-${pd}` : '오늘'}`, body: p.title, when: d });
  }
  const gm = N.goals || 'all';
  if (gm !== 'off') for (const [bk, b] of Object.entries(store.goals?.boards || {})) {
    for (const g of b.items || []) {
      if (g.parent || g.done || !g.end) continue;
      for (const n of gm === 'day' ? [0] : [7, 1, 0]) {
        const d = new Date(`${g.end}T09:00:00`); d.setDate(d.getDate() - n);
        const key = `goal:${g.id}:${g.end}:${n}`;
        if (d <= now && now - d < 12 * 3600e3 && !sent.has(key)) out.push({ key, title: `목표 마감 ${n ? `D-${n}` : 'D-day'}`, body: g.name, when: d, url: `/#/${encodeURIComponent(bk.split('|')[0])}/${encodeURIComponent('목표 관리')}` });
      }
    }
  }
  return out;
}

/** 앞으로 울릴 알람 (알람 관리 화면): 지금부터 days 일 안, 시간순
    kind: routine(루틴) · alarm(알람) · event(일정) · goal(목표 마감) · plan(기획 마감) · journal(저널링) */
export function upcomingAlarms(store, now = new Date(), days = 7) {
  const N = store.notify || {}, out = [], end = new Date(now.getTime() + days * 864e5);
  for (const e of expandEvents(store.events || [], iso(now), iso(new Date(end.getTime() + 864e5)))) {
    if (!e.time || (!N.enabled && !ownAlarm(e))) continue;
    const r = remindMinutes(e, N);
    if (r == null) continue;
    const when = new Date(at(e.date, e.time).getTime() - r * 60000);
    if (when < now || when > end) continue;
    out.push({ key: `event:${e.id}`, kind: e.routine ? 'routine' : e.alarm ? 'alarm' : 'event', alarm: !!(e.routine || e.alarm), title: e.title, body: `${e.time} 시작${r ? ` · ${remindLabel(r)}` : ''}`, when, eventId: e.sid || e.id });
  }
  if (N.enabled) {
    const gm = N.goals || 'all';
    if (gm !== 'off') for (const b of Object.values(store.goals?.boards || {})) for (const g of b.items || []) {
      if (g.parent || g.done || !g.end) continue;
      for (const n of gm === 'day' ? [0] : [7, 1, 0]) { const d = new Date(`${g.end}T09:00:00`); d.setDate(d.getDate() - n); if (d >= now && d <= end) out.push({ key: `goal:${g.id}:${n}`, kind: 'goal', title: `목표 마감 ${n ? `D-${n}` : 'D-day'}`, body: g.name, when: d }); }
    }
    const pd = Number(N.planDays ?? 1);
    if (pd >= 0) for (const p of store.plan?.plans || []) {
      if (!p.due || p.status === '확정' || p.status === '보류') continue;
      const d = new Date(`${p.due}T09:00:00`); d.setDate(d.getDate() - pd);
      if (d >= now && d <= end) out.push({ key: `plan:${p.id}`, kind: 'plan', title: `기획 마감 ${pd ? `D-${pd}` : '오늘'}`, body: p.title, when: d });
    }
  }
  upcomingJournal(store, now, days).filter(n => n.when >= now && n.when <= end).forEach(n => out.push({ key: n.key, kind: 'journal', title: n.title, body: n.body, when: n.when }));
  return out.sort((a, b) => a.when - b.when);
}

/** 보낸 알림을 기록에 남긴다 */
export const recordSent = (s, list) => ({ ...s, notifications: [...list.map(n => ({ id: n.key, key: n.key, title: n.title, body: n.body, at: `${iso(n.when)} ${pad(n.when.getHours())}:${pad(n.when.getMinutes())}`, sentAt: new Date().toISOString() })), ...(s.notifications || [])].slice(0, 100) });

/** OS 알림 (허용됐을 때만). 루틴 알람(alarm)은 누를 때까지 화면에 남김 */
export function showOsNotification(n) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(n.title, { body: n.body, tag: n.key, requireInteraction: !!n.alarm, icon: '/icon-192.png' }); } catch { /* 지원 안 함 */ }
}

/** 앱 화면이 열려 있을 때 알림음 (Web Audio 로 짧게 — 파일 없음). alarm 이면 세 번 + 휴대폰 진동 */
let audioCtx = null;
export function playChime(alarm = false) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime, notes = alarm ? [880, 1175, 880, 1175, 880, 1175] : [880, 1175];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = t0 + i * 0.18 + (alarm ? Math.floor(i / 2) * 0.25 : 0);
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.18);
    });
  } catch { /* 소리 못 냄 (브라우저가 막음) */ }
  try { if (alarm) navigator.vibrate?.([500, 250, 500, 250, 500]); } catch { /* 진동 없음 */ }
}
