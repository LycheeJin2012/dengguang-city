// v48: 暗色模式切换 + 通用动效初始化
// 加载即读 localStorage 偏好 + 系统设置, 应用 theme
// 全站右下角加一个圆形切换按钮

(function() {
  const STORAGE_KEY = 'lc_theme_v1';
  // 1. 立即应用主题 (避免页面闪白)
  function getPreferred() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
  }
  applyTheme(getPreferred());

  // 2. 切换函数
  window.toggleTheme = function() {
    const cur = document.documentElement.getAttribute('data-theme') || getPreferred();
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    updateButton(next);
  };
  function updateButton(t) {
    const btn = document.getElementById('v48ThemeToggle');
    if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
  }

  // 3. 监听系统主题变化 (用户没手动选时)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      applyTheme(e.matches ? 'dark' : 'light');
      updateButton(e.matches ? 'dark' : 'light');
    }
  });

  // 4. DOMContentLoaded 后插按钮
  document.addEventListener('DOMContentLoaded', () => {
    // 已经有按钮就跳过
    if (document.getElementById('v48ThemeToggle')) return;
    const btn = document.createElement('button');
    btn.id = 'v48ThemeToggle';
    btn.className = 'v48-theme-toggle';
    btn.setAttribute('aria-label', '切换暗色/亮色模式');
    btn.title = '切换暗色/亮色模式';
    updateButton(getPreferred());
    btn.addEventListener('click', window.toggleTheme);
    document.body.appendChild(btn);
  });
})();
