// 灯光市 v48 · 共享 toast helper
// 公共页 + admin 都可加载使用
// 特点:
//   - 自动按消息内容判断类型 (失败/错误/无效 → 红, 成功/已 → 绿, 其他 → 灰)
//   - v48 动效: 从右滑入 + 背景模糊 + 进度条收缩 + 滑出退场
//   - 暗色模式自适应 (用 CSS 变量, 自动跟随主题切换)
//   - 覆盖 window.alert, 一次替换所有 alert 调用
(function() {
  'use strict';
  function _toast(msg, type) {
    type = type || (/失败|错误|无效|不能|未|拒绝|fail|error/i.test(String(msg)) ? 'error' : /成功|已|完成|ok/i.test(String(msg)) ? 'success' : 'info');
    let c = document.getElementById('_toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = '_toast-container';
      c.className = 'v48-toast-container';
      document.body.appendChild(c);
    }
    const icons = { error: '✕', success: '✓', info: 'ℹ' };
    const t = document.createElement('div');
    t.className = 'v48-toast v48-toast-' + type;
    t.setAttribute('role', 'status');
    t.innerHTML = `
      <div class="v48-toast-icon">${icons[type] || 'ℹ'}</div>
      <div class="v48-toast-body">${String(msg).replace(/</g, '&lt;')}</div>
      <div class="v48-toast-bar"><div class="v48-toast-bar-fill"></div></div>
    `;
    c.appendChild(t);
    // 触发动画 (v48 slide-in-right)
    requestAnimationFrame(() => t.classList.add('v48-toast-in'));
    // 3 秒后退出
    const ttl = 3000;
    setTimeout(() => {
      t.classList.remove('v48-toast-in');
      t.classList.add('v48-toast-out');
      setTimeout(() => t.remove(), 350);
    }, ttl);
  }
  window._toast = _toast;
  window.alert = _toast;
})();
