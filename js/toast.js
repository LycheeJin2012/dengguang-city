// 灯光市 v41 · 共享 toast helper (Apple-style motion: decel 入场, accel 出场)
// 公共页 (main.js / hotel.js / dm.js / profile.js) + admin 都可加载使用
// 自动按消息内容判断类型: 失败/错误/无效 → 红; 成功/已 → 绿; 其他 → 灰
// 也覆盖 window.alert, 一次替换所有 alert 调用
(function() {
  'use strict';
  // 时长/曲线用 CSS 变量, fallback 硬编码值兼容单独加载 toast.js 的场景
  const DUR_BASE = 'var(--dur-base, 260ms)';
  const DUR_FAST = 'var(--dur-fast, 180ms)';
  const EASE_DECEL = 'var(--ease-decel, cubic-bezier(0, 0, 0.2, 1))';
  const EASE_ACCEL = 'var(--ease-accel, cubic-bezier(0.4, 0, 1, 1))';
  function _toast(msg, type) {
    type = type || (/失败|错误|无效|不能|未|拒绝|fail|error/i.test(String(msg)) ? 'error' : /成功|已|完成|ok/i.test(String(msg)) ? 'success' : 'info');
    let c = document.getElementById('_toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = '_toast-container';
      c.style.cssText = 'position:fixed;top:80px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:90vw;';
      document.body.appendChild(c);
    }
    const bg = type === 'error' ? '#c33' : type === 'success' ? '#3a3' : '#333';
    const t = document.createElement('div');
    // 入场用 decel (减速到位), 出场用 accel (加速离开)
    t.style.cssText = 'background:' + bg + ';color:#fff;padding:12px 18px;border-radius:6px;font-size:14px;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:340px;pointer-events:auto;opacity:0;transform:translateY(-12px) scale(0.96);transition:opacity ' + DUR_BASE + ' ' + EASE_DECEL + ',transform ' + DUR_BASE + ' ' + EASE_DECEL + ';white-space:pre-wrap;';
    t.textContent = String(msg);
    c.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0) scale(1)'; });
    setTimeout(() => {
      t.style.transition = 'opacity ' + DUR_FAST + ' ' + EASE_ACCEL + ',transform ' + DUR_FAST + ' ' + EASE_ACCEL;
      t.style.opacity = '0';
      t.style.transform = 'translateY(-8px) scale(0.98)';
      setTimeout(() => t.remove(), 220);
    }, 3000);
  }
  window._toast = _toast;
  window.alert = _toast;
})();
