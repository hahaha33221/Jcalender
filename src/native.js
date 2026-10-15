/* 안드로이드 앱(android-app/, Capacitor) 안에서만 쓰는 기능 — 사이트를 브라우저로 볼 때는 아무것도 안 함
   - 휴대폰 알람(로컬 알림): 앞으로 7일 안에 울릴 알람(notify.js upcomingAlarms)을 기기에 예약 → 앱이 꺼져 있어도 · 인터넷이 없어도 정해진 시각에 울림
     데이터가 바뀌거나 앱으로 돌아올 때마다 다시 예약 (최대 60개)
   - 알림 채널 2개: "루틴 · 알람"(가장 높음 · 소리 · 진동 · 잠금 화면) / "일정 · 마감 알림"(높음) → 휴대폰 설정에서 채널별로 소리 · 진동을 바꿀 수 있음
   - 알림을 누르면 그 화면으로, 뒤로 가기 버튼은 이전 화면 (첫 화면이면 앱을 내림)
   - 플러그인 코드는 앱 안에서만 불러옴 (import 를 나눠 브라우저에서는 받지 않음)
   - 서버 푸시(FCM): Firebase 설정을 넣어 만든 앱(User-Agent 에 JcalFCM)에서만 — 기기 토큰을 서버에 등록하고(server/push.mjs),
     기기에 예약한 알람 목록(제목|시각)을 서버에 알려 같은 알람이 두 번 울리지 않게 한다. 서버는 다른 기기에서 새로 만들거나 바꾼 것만 보냄 */
import { upcomingAlarms } from './notify.js';

export const isNative = () => !!window.Capacitor?.isNativePlatform?.();
const CH = { alarm: 'jcal-alarm', normal: 'jcal-normal' };
let LN = null, ready = null;
/** 플러그인은 { L } 로 감싸서 돌려줌 — 플러그인 자체를 Promise 로 돌려주면 .then 을 플러그인 기능으로 착각해 오류가 남 */
const plugin = async () => { if (!LN) LN = (await import('@capacitor/local-notifications')).LocalNotifications; return { L: LN }; };
const TOKEN_KEY = 'jcalender.fcmToken';
let api = null;                                                  // 서버 요청 (App.jsx 가 sync.request 로 넣어 줌)
export const setNativeApi = fn => { api = fn; };
export const fcmCapable = () => isNative() && /JcalFCM/.test(navigator.userAgent);
export const fcmToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
/** 알람 서명: 제목 | 울릴 시각(ms) — server/push.mjs alarmSig 와 같게 */
const sigOf = a => `${String(a.title).slice(0, 150)}|${+new Date(a.when)}`;
let PN = null, fcmReady = null, lastSigs = '';
const pushPlugin = async () => { if (!PN) PN = (await import('@capacitor/push-notifications')).PushNotifications; return { P: PN }; };
const report = async sigs => {                                   // 예약한 알람 목록을 서버에 (바뀌었을 때만)
  const t = fcmToken(), k = JSON.stringify(sigs);
  if (!api || !t || k === lastSigs) return;
  try { await api('/api/push/fcm/scheduled', { method: 'POST', body: { token: t, sigs } }); lastSigs = k; } catch { /* 다음에 다시 */ }
};

/** 서버 푸시 시작 (앱 시작 때 한 번): 권한 → 등록 → 토큰을 서버에. 알림을 누르면 그 화면으로 */
export function initFcm() {
  if (!fcmCapable()) return Promise.resolve(false);
  return (fcmReady ||= (async () => {
    const { P } = await pushPlugin();
    await P.addListener('registration', async t => {
      try { localStorage.setItem(TOKEN_KEY, t.value); } catch { /* 무시 */ }
      lastSigs = '';
      try { await api?.('/api/push/fcm/register', { method: 'POST', body: { token: t.value, device: 'Android 앱' } }); } catch { /* 다음에 다시 */ }
    });
    await P.addListener('pushNotificationActionPerformed', a => { const u = a.notification?.data?.url; if (u) window.location.hash = u.replace(/^\/?#?/, '#'); });
    let st = await P.checkPermissions();
    if (st.receive === 'prompt') st = await P.requestPermissions();
    if (st.receive !== 'granted') return false;
    await P.register();
    return true;
  })().catch(e => { console.warn('[서버 푸시]', e); fcmReady = null; return false; }));
}
/** 이미 받은 토큰을 지금 로그인한 계정으로 서버에 등록 (로그인 · 계정 바꿈) */
export async function fcmRegister() {
  const t = fcmToken(); if (!api || !t) return;
  lastSigs = '';
  try { await api('/api/push/fcm/register', { method: 'POST', body: { token: t, device: 'Android 앱' } }); } catch { /* 다음에 다시 */ }
}
/** 서버 푸시 상태 (설정 화면) */
export async function fcmStatus() {
  if (!fcmCapable()) return { capable: false };
  const { P } = await pushPlugin();
  const p = await P.checkPermissions().catch(() => ({ receive: 'denied' }));
  let srv = null; try { srv = await api?.('/api/push/fcm'); } catch { /* 서버 업데이트 전 */ }
  const t = fcmToken();
  return { capable: true, perm: p.receive, token: !!t, ready: !!srv?.ready, srvKnown: !!srv, registered: !!srv?.devices?.some(d => t && t.endsWith(d.id)) };
}
/** 로그아웃: 이 앱으로는 서버 푸시를 보내지 않게 */
export async function fcmUnregister(request) {
  const t = fcmToken(); if (!t) return;
  try { await request('/api/push/fcm/unregister', { method: 'POST', body: { token: t } }); } catch { /* 무시 */ }
}

/** 알림 id: 알람 key + 시각 → 양수 32비트 */
const idOf = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h & 0x7fffffff) || 1; };

/** 앱 시작 때 한 번: 채널 · 알림 누르기 · 뒤로 가기 */
export function initNative() {
  if (!isNative()) return Promise.resolve(false);
  return (ready ||= (async () => {
    const { L } = await plugin();
    await L.createChannel({ id: CH.alarm, name: '루틴 · 알람', description: '루틴 시작 · 직접 만든 알람 (소리 · 진동은 휴대폰 설정에서 바꿀 수 있음)', importance: 5, visibility: 1, vibration: true, lights: true }).catch(() => {});
    await L.createChannel({ id: CH.normal, name: '일정 · 마감 알림', description: '일정 · 목표 마감 · 기획 마감 · 저널링', importance: 4, visibility: 1, vibration: true }).catch(() => {});
    L.addListener('localNotificationActionPerformed', a => { const u = a.notification?.extra?.url; if (u) window.location.hash = u.replace(/^\/?#?/, '#'); });
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', ({ canGoBack }) => { if (canGoBack && window.location.hash && window.location.hash !== '#/') window.history.back(); else App.minimizeApp(); });
    return true;
  })());
}

/** 앱으로 돌아올 때 (다시 예약하려고) */
export async function onResume(fn) {
  if (!isNative()) return () => {};
  const { App } = await import('@capacitor/app');
  const h = await App.addListener('resume', fn);
  return () => h.remove();
}

/** 알림 · 정확한 알람 권한 상태 */
export async function nativeStatus() {
  if (!isNative()) return null;
  const { L } = await plugin();
  const [p, ex, pend] = await Promise.all([L.checkPermissions(), L.checkExactNotificationSetting?.().catch(() => null), L.getPending().catch(() => ({ notifications: [] }))]);
  return { display: p.display, exact: ex?.exact_alarm || 'granted', pending: pend.notifications.length };
}
/** 알림 허용 묻기 → 정확한 알람이 꺼져 있으면 설정 화면 열기 */
export async function askNativePermission() {
  const { L } = await plugin();
  const p = await L.requestPermissions();
  const ex = await L.checkExactNotificationSetting?.().catch(() => null);
  if (p.display === 'granted' && ex && ex.exact_alarm !== 'granted') await L.changeExactNotificationSetting();
  return nativeStatus();
}

/** 앞으로 7일 알람을 기기에 다시 예약 (전에 예약한 것은 지움) */
export async function scheduleAlarms(store) {
  if (!isNative()) return 0;
  await initNative();
  const { L } = await plugin();
  if ((await L.checkPermissions()).display !== 'granted') { await report([]); return 0; }
  const pend = await L.getPending().catch(() => ({ notifications: [] }));
  if (pend.notifications.length) await L.cancel({ notifications: pend.notifications.map(n => ({ id: n.id })) }).catch(() => {});
  const list = upcomingAlarms(store, new Date(Date.now() + 30e3), 7).slice(0, 60);
  if (!list.length) { await report([]); return 0; }
  await L.schedule({ notifications: list.map(a => ({
    id: idOf(`${a.key}@${+a.when}`), title: a.title, body: a.body || '', channelId: a.alarm ? CH.alarm : CH.normal,
    schedule: { at: a.when, allowWhileIdle: true }, smallIcon: 'ic_stat_jcal', iconColor: '#14212b', autoCancel: true,
    extra: { url: a.kind === 'goal' ? '#/P' : a.kind === 'idea' ? '#/ideas' : a.kind === 'wish' ? '#/wishes' : '#/alarms' },
  })) });
  await report(list.map(sigOf));                                  // 이 알람들은 서버가 FCM 으로 다시 보내지 않음
  return list.length;
}

/** 시험 알람: 5초 뒤 "루틴 · 알람" 채널로 */
export async function testNativeAlarm() {
  await initNative();
  const { L } = await plugin();
  await L.schedule({ notifications: [{ id: idOf(`test@${Date.now()}`), title: 'Jcalender 시험 알람', body: '앱이 꺼져 있어도 이렇게 울립니다', channelId: CH.alarm,
    schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true }, smallIcon: 'ic_stat_jcal', iconColor: '#14212b', extra: { url: '#/alarms' } }] });
}
