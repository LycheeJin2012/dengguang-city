// v49-fix-8: PWA 注册 (manifest + service worker)
// 5 页面引用同一文件 — 避免每页 inline 重复
(function() {
  if (typeof window === 'undefined') return;
  // 1. 动态注入 manifest link (避免 5 页面都加)
  if (!document.querySelector('link[rel="manifest"]')) {
    const m = document.createElement('link');
    m.rel = 'manifest';
    m.href = '/manifest.json';
    document.head.appendChild(m);
  }
  // 2. 动态注入 theme-color meta
  if (!document.querySelector('meta[name="theme-color"]')) {
    const t = document.createElement('meta');
    t.name = 'theme-color';
    t.content = '#70ad34';
    document.head.appendChild(t);
  }
  // 3. 注册 service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
        console.log('[PWA] service worker 已注册, scope =', reg.scope);
      }).catch((e) => {
        console.warn('[PWA] service worker 注册失败', e);
      });
    });
  }
})();
