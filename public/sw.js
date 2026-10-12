/* Jcalender 서비스 워커 — 웹 푸시 받기 (src/push.js 가 등록, 서버 server/push.mjs 가 보냄)
   - 화면 파일은 캐시하지 않는다 (항상 최신 화면). 푸시 · 알림 누르기만 처리
   - 받는 내용: { title, body, tag, url, alarm }
   - alarm(루틴 알람): 긴 진동(안드로이드) · 누를 때까지 화면에 남김(PC · 안드로이드). 소리는 기기의 알림음 설정을 따름
   - 앱 화면이 열려 있으면 화면에도 알려 알림음을 냄 (App.jsx) */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Jcalender', {
      body: d.body || '', tag: d.tag || undefined, data: { url: d.url || '/' },
      icon: '/icon-192.png', badge: '/icon-192.png', renotify: !!d.tag, silent: false,
      vibrate: d.alarm ? [500, 250, 500, 250, 500] : [200, 100, 200], requireInteraction: !!d.alarm,
    });
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach(c => c.postMessage({ type: 'jcal-push', alarm: !!d.alarm, title: d.title, body: d.body }));   // 열려 있는 화면 → 알림음
  })());
});

// 알림을 누르면 열려 있는 Jcalender 창으로 가거나 새로 연다
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = list.find(c => new URL(c.url).origin === self.location.origin);
    if (win) { await win.focus(); if ('navigate' in win) await win.navigate(url).catch(() => {}); return; }
    await self.clients.openWindow(url);
  })());
});
