// オフライン対応：アプリ本体をキャッシュ。更新したら CACHE の番号と index.html の ?v= を上げる。
const CACHE = 'tuner-v14';
const ASSETS = [
  './', './index.html', './app.js?v=14', './pitch.js?v=14', './manifest.webmanifest',
  './icons/icon-192-v2.png', './icons/icon-512-v2.png', './icons/apple-touch-icon-v2.png', './icons/icon-maskable-512-v2.png', './icons/icon-v2.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネット優先（更新がすぐ反映される）。オフライン時だけキャッシュを使う
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
