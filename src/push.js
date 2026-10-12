/* 웹 푸시 (1단계 · PWA): 이 기기를 서버(server/push.mjs)에 등록해 앱이 꺼져 있어도 알림을 받는다
   - 서비스 워커 public/sw.js 가 푸시를 받아 알림을 띄운다
   - 아이폰 · 아이패드: iOS 16.4 이상 + 사파리 "공유 → 홈 화면에 추가"로 설치한 앱에서만 된다
   - 이 기기가 푸시를 받는 중이면(PUSH_KEY) 화면이 열려 있을 때의 OS 알림은 띄우지 않는다 (같은 알림 두 번 방지, App.jsx) */
import { deviceName } from './serverSync.js';

const PUSH_KEY = 'jcalender.push';                            // 이 기기의 구독 endpoint
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushOnHere = () => { try { return !!localStorage.getItem(PUSH_KEY) && Notification.permission === 'granted'; } catch { return false; } };

/** 서비스 워커 등록 (앱 시작 때 한 번) */
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

const b64ToBytes = s => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
const reg = async () => (await navigator.serviceWorker.getRegistration('/')) || navigator.serviceWorker.register('/sw.js');

/** 지금 이 기기의 구독 (없으면 null) */
export async function currentSub() {
  if (!pushSupported()) return null;
  try { return await (await reg()).pushManager.getSubscription(); } catch { return null; }
}

/** 이 기기에서 푸시 받기: 알림 허용 → 구독 → 서버에 등록 */
export async function enablePush(request) {
  if (!pushSupported()) throw new Error(isIos() && !isStandalone() ? '아이폰은 사파리에서 "공유 → 홈 화면에 추가"로 설치한 Jcalender 앱에서 켜 주세요' : '이 브라우저는 푸시 알림을 지원하지 않습니다');
  const cfg = await request('/api/push/config');
  if (!cfg.ready) throw new Error('서버에 푸시 키가 아직 없습니다. VPS 에서 업데이트(update.sh)를 실행해 주세요');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? '알림이 막혀 있습니다. 브라우저(또는 휴대폰) 설정에서 Jcalender 알림을 허용해 주세요' : '알림 허용을 눌러야 푸시를 받을 수 있습니다');
  const r = await reg();
  await navigator.serviceWorker.ready;
  let sub = await r.pushManager.getSubscription();
  const key = b64ToBytes(cfg.publicKey);
  if (sub && sub.options?.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))) !== btoa(String.fromCharCode(...key))) { await sub.unsubscribe(); sub = null; }   // 서버 키가 바뀌었으면 다시
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await request('/api/push/subscribe', { method: 'POST', body: { sub: sub.toJSON(), device: `${deviceName()}${isStandalone() ? ' (앱)' : ''}` } });
  try { localStorage.setItem(PUSH_KEY, sub.endpoint); } catch { /* 저장 불가 */ }
  return sub.endpoint;
}

/** 이 기기 푸시 끄기 */
export async function disablePush(request) {
  const sub = await currentSub();
  const ep = sub?.endpoint || (() => { try { return localStorage.getItem(PUSH_KEY); } catch { return null; } })();
  if (ep) await request('/api/push/unsubscribe', { method: 'POST', body: { endpoint: ep } }).catch(() => {});
  if (sub) await sub.unsubscribe().catch(() => {});
  try { localStorage.removeItem(PUSH_KEY); } catch { /* 무시 */ }
}

