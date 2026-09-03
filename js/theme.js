// v48.1: 暗色模式 — 仅跟随系统设置 (prefers-color-scheme)
// 去掉 v48 的手动切换按钮, 简化: 系统是暗色就用暗色, 系统是亮色就用亮色
// (如果未来想重新加手动 toggle, 在 body 末尾 append 按钮 + bindEvent)

(function() {
  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
  }
  // 1. 立即应用 (避免页面闪)
  applyTheme(getSystemTheme());
  // 2. 监听系统设置变化 (用户改 macOS 暗色设置, 页面实时跟随)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    applyTheme(e.matches ? 'dark' : 'light');
  });
})();
