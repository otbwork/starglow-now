// STARGLOW NOW — Service Worker
// オンライン時は常に最新を取りに行き、オフライン時だけキャッシュを使う方針。
// （以前は cache-first で、更新してもアプリ側に反映されにくかったため改良）
const CACHE = 'starglow-now-v9';
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

// ネットワーク優先：取得できたら最新を返しつつキャッシュ更新、ダメならキャッシュ
function networkFirst(request) {
  return fetch(request)
    .then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
      return res;
    })
    .catch(() => caches.match(request));
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // 画面・本体・データすべてオンライン時は最新優先（更新が確実に反映される）
  e.respondWith(networkFirst(e.request));
});
