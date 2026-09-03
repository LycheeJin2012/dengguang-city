// v48.1: 暗色模式 — 跟随系统设置 (prefers-color-scheme)
// v48.3: 临时加 ?theme=dark / ?theme=light URL 参数强制覆盖 (debug 用, 之后可删)

(function() {
  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function getOverrideTheme() {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('theme');
      if (t === 'dark' || t === 'light') return t;
    } catch (e) {}
    return null;
  }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
  }
  // 1. URL 参数 > 系统偏好
  const override = getOverrideTheme();
  applyTheme(override || getSystemTheme());
  // 2. 监听系统变化 (URL 没 override 时才生效)
  if (!override) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      applyTheme(e.matches ? 'dark' : 'light');
    });
  }
})();
