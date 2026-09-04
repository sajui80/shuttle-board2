/* 퇴근 셔틀 V2 — 앱 셸 캐시 + 알림 수신
   앱을 새로 배포한 뒤 갱신이 안 되면 아래 CACHE 이름의 숫자를 v3, v4... 로 올리면 됩니다. */
const CACHE = 'shuttle-v2-shell-v2';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

/* ---------- 알림 수신 ---------- */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBgg9e-IeBU39YalD8t4NCuHd4nAfhROw4",
  authDomain: "shuttle-v2.firebaseapp.com",
  projectId: "shuttle-v2",
  storageBucket: "shuttle-v2.firebasestorage.app",
  messagingSenderId: "1047707378524",
  appId: "1:1047707378524:web:fb4713f0dd467e631f5799"
});

try {
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(function (payload) {
    const d = (payload && payload.data) || {};
    self.registration.showNotification(d.title || '퇴근셔틀', {
      body: d.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: d.tag || 'shuttle',
      renotify: true,
      data: { url: './index.html' }
    });
  });
} catch (e) { /* 알림 미지원 환경 */ }

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});

/* ---------- 앱 셸 캐시 ---------- */
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 네트워크 우선 — 항상 최신 화면, 오프라인일 때만 캐시 */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
