// v48.5: 暗色模式 — 系统偏好 + 手动覆盖 + 浮动切换按钮
// 优先级: URL ?theme= > localStorage('theme-override') > 系统 prefers-color-scheme
// 手动模式 3 态循环: auto → dark → light → auto

(function() {
  const STORAGE_KEY = 'lc-theme-override';
  const MODES = ['auto', 'dark', 'light'];  // 3 态循环
  const ICONS = { auto: '🌓', dark: '🌙', light: '☀️' };
  const LABELS = { auto: '跟随系统', dark: '深色', light: '浅色' };

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function getUrlTheme() {
    try {
      const t = new URLSearchParams(window.location.search).get('theme');
      if (t === 'dark' || t === 'light') return t;
    } catch (e) {}
    return null;
  }
  function getStoredOverride() {
    try {
      const t = localStorage.getItem(STORAGE_KEY);
      if (t === 'dark' || t === 'light' || t === 'auto') return t;
    } catch (e) {}
    return 'auto';
  }
  function setStoredOverride(mode) {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) {}
  }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
  }
  function resolveCurrentMode() {
    return getUrlTheme() ? 'url' : getStoredOverride();
  }
  function apply() {
    const url = getUrlTheme();
    if (url) {
      applyTheme(url);
      return;
    }
    const override = getStoredOverride();
    if (override === 'auto') {
      applyTheme(getSystemTheme());
    } else {
      applyTheme(override);
    }
  }

  apply();

  // 监听系统偏好变化 (auto 模式或无 override 时)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!getUrlTheme() && getStoredOverride() === 'auto') {
      applyTheme(getSystemTheme());
      updateButton();
    }
  });

  // 创建浮动切换按钮 (右下角, 避开 navbar)
  function createButton() {
    if (document.getElementById('themeToggleBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'themeToggleBtn';
    btn.type = 'button';
    btn.setAttribute('aria-label', '切换主题');
    btn.innerHTML = `<span class="ttb-icon">🌓</span><span class="ttb-label">跟随系统</span>`;
    btn.addEventListener('click', () => {
      const cur = getStoredOverride();
      const idx = MODES.indexOf(cur);
      const next = MODES[(idx + 1) % MODES.length];
      setStoredOverride(next);
      apply();
      updateButton();
    });
    document.body.appendChild(btn);
    updateButton();
  }
  function updateButton() {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    const mode = resolveCurrentMode();
    if (mode === 'url') {
      // URL 强制, 按钮提示当前是 URL 锁定
      btn.innerHTML = `<span class="ttb-icon">🔗</span><span class="ttb-label">URL 锁定</span>`;
      btn.dataset.mode = 'url';
    } else {
      const icon = ICONS[mode] || ICONS.auto;
      const label = LABELS[mode] || LABELS.auto;
      btn.innerHTML = `<span class="ttb-icon">${icon}</span><span class="ttb-label">${label}</span>`;
      btn.dataset.mode = mode;
    }
  }

  // DOM ready 后挂按钮
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createButton);
  } else {
    createButton();
  }
})();
