// v49-fix-8: PWA Service Worker — 主页 + 4 子页 + 关键 JS 离线缓存
// 策略: cache-first (回退到网络), stale-while-revalidate
// v50-fix-15: 加 /admin-v37.html (实际 admin 页, /admin.html 只是 308 跳转壳)
// v50-fix-17: 加 fonts.css / theme.js / toast.js / 字体 / hero 背景图
//   之前只缓存了 style.css + index.html, 离线时字体 + 主题色全坏
const CACHE_VERSION = 'lc-v50-2026-09-07-v20';
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
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 跨域不 cache (含 CF Pages Functions)
  // navigation 请求 (HTML): network-first, 回退到 cache, 最后回退到 /
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
        return r;
      }).catch(() => caches.match(request).then((r) => r || caches.match('/')))
    );
    return;
  }
  // 静态资源: cache-first, 后台 stale-while-revalidate
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((r) => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
        }
        return r;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
