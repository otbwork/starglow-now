// STARGLOW NOW — Service Worker
// アプリ本体はキャッシュ優先（オフラインでも起動）、データは常に最新を取りに行く。
const CACHE = 'starglow-now-v2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // フィードデータは network-first（最新優先、失敗時はキャッシュ）
  if (url.pathname.endsWith('/data/feed.json') || url.pathname.endsWith('feed.json')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // それ以外（アプリ本体）は cache-first
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
