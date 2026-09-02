/* 퇴근 셔틀 V2 — 앱 셸 캐시
   앱을 새로 배포한 뒤 사용자 휴대폰이 갱신되지 않으면
   아래 CACHE 이름의 숫자를 v5, v6... 으로 올리면 됩니다. */
const CACHE = 'shuttle-v2-shell-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

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

/* 네트워크 우선 — 항상 최신 화면을 보여주고, 오프라인일 때만 캐시 사용 */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;   // Firebase 요청은 그대로 통과
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