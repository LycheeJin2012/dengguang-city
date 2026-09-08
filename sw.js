// v49-fix-8: PWA Service Worker — 主页 + 4 子页 + 关键 JS 离线缓存
// 策略: cache-first (回退到网络), stale-while-revalidate
// v50-fix-15: 加 /admin-v37.html (实际 admin 页, /admin.html 只是 308 跳转壳)
// v50-fix-17: 加 fonts.css / theme.js / toast.js / 字体 / hero 背景图
//   之前只缓存了 style.css + index.html, 离线时字体 + 主题色全坏
const CACHE_VERSION = 'lc-v50-2026-09-08-v21';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/hotel.html',
  '/profile.html',
  '/dm.html',
  '/admin-v37.html',
  '/leaderboard.html',
  '/notifications.html',
  '/css/style.min.css',
  '/css/fonts.css',
  '/js/theme.js',
  '/js/toast.js',
  '/js/pwa.js',
  '/manifest.json',
  '/assets/icons/icon.svg',
  '/assets/fonts/press-start-2p.woff2',
  '/assets/fonts/vt323.woff2',
  '/assets/backgrounds/bg-pixel-hero.jpg',
  '/assets/track-placeholder.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('lc-') && k !== CACHE_VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Cache only static files; API/session responses always go directly to the network.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/logout') return;

  const cacheResponse = async (response) => {
    if (response?.ok && !/no-store/i.test(response.headers.get('Cache-Control') || '')) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(request, response.clone());
    }
  };
  if (request.mode === 'navigate') {
    const network = fetch(request);
    e.waitUntil(network.then(cacheResponse).catch(() => {}));
    e.respondWith(network.catch(async () =>
      (await caches.match(request)) || (await caches.match('/')) || Response.error()
    ));
    return;
  }
  if (!/^\/(?:assets|css|js)\//.test(url.pathname) && url.pathname !== '/manifest.json') return;
  const network = fetch(request);
  e.waitUntil(network.then(cacheResponse).catch(() => {}));
  e.respondWith(caches.match(request).then(cached => {
    // Attach a rejection handler even when returning a cached response.
    const fallback = network.catch(() => cached || Response.error());
    return cached || fallback;
  }));
});
