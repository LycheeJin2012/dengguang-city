// 灯光市 v35 · 共享 toast helper
// 公共页 (main.js / hotel.js / dm.js / profile.js) + admin 都可加载使用
// 自动按消息内容判断类型: 失败/错误/无效 → 红; 成功/已 → 绿; 其他 → 灰
// 也覆盖 window.alert, 一次替换所有 alert 调用
(function() {
  'use strict';
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
    t.style.cssText = 'background:' + bg + ';color:#fff;padding:12px 18px;border-radius:6px;font-size:14px;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:340px;pointer-events:auto;opacity:0;transform:translateY(-8px);transition:opacity .2s ease,transform .2s ease;white-space:pre-wrap;';
    t.textContent = String(msg);
    c.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(-8px)';
      setTimeout(() => t.remove(), 250);
    }, 3000);
  }
  window._toast = _toast;
  window.alert = _toast;
})();
