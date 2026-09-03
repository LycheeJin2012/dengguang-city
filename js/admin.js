// v44 重写: admin 后台总入口 (替代 admin.v2551.js 2240 行单文件)
// 结构: core + dash + 9 个 tab 模块
// 旧 admin.v2551.js / admin-manage-v3601.js 已删除
//
// 模块结构:
//   js/admin/core.js          共享工具 ($, esc, fmt, api, safeRender, ...)
//   js/admin/dash.js          boot, renderDash, tab 路由
//   js/admin/tabs/messages.js  市民留言
//   js/admin/tabs/players.js   玩家管理
//   js/admin/tabs/bookings.js  酒店预订
//   js/admin/tabs/license.js   驾照考试
//   js/admin/tabs/kart.js      赛道 + 国际赛车场 (合并, 类似功能)
//   js/admin/tabs/admins.js    管理员账号
//   js/admin/tabs/announcements.js  公告
//   js/admin/tabs/gallery.js   首页图集
//   js/admin/tabs/dms.js       私信监管 (super)
//   js/admin/tabs/passkey.js   通行密钥引导
//
// HTML 模板不变 (admin-v37.html 仍可用), 通过 inline onclick 调 window.* 全局函数
// 这里导出所有需要的全局函数
import { $, POST, GET, safeRender, fileToDataURLP, cacheClear } from './admin/core.js?v=v46-fix-modules';
import { renderDash, _ensureTabRendered, bindFilterRadios, showView } from './admin/dash.js?v=v46-fix-modules';

// ---------- Boot ----------
async function boot() {
  console.log('[admin] boot() start');
  try {
    const d = await GET('/api/login');
    console.log('[admin] /api/login 返回:', d);
    const _ld = document.getElementById('bootLoading');
    if (_ld) _ld.remove();
    if (d.ok && d.user) {
      if (d.role && d.role !== 'player') {
        window._me = d.user;
        renderDash();
      } else if (d.player && d.player.linked_admin_id) {
        showView('login');
        showAdminEnterModal(d.player, d.player.linked_admin_id);
      } else {
        showView('login');
        const el = $('#loginError');
        if (el) el.textContent = '当前是玩家账号, 但未绑定管理员账号, 无法进入管理后台';
      }
    } else {
      console.log('[admin] 未登录, 显示 login form');
      showView('login');
    }
  } catch (e) {
    console.error('[admin] boot failed:', e);
    const _ld = document.getElementById('bootLoading');
    if (_ld) _ld.remove();
    const el = $('#loginError');
    if (el) el.textContent = '启动失败: ' + e.message;
    showView('login');
  }
}

// ---------- 登录 ----------
async function doLogin() {
  const errEl = $('#loginError');
  if (errEl) errEl.textContent = '';
  const u = $('#loginUser').value.trim();
  const p = $('#loginPass').value;
  if (!u || !p) { if (errEl) errEl.textContent = '请输入账号和密码'; return; }
  try {
    const d = await POST('/api/login', { username: u, password: p });
    if (!d.ok) throw new Error(d.error || '登录失败');
    if (d.role === 'player') throw new Error('这是玩家账号');
    const me = await GET('/api/login');
    window._me = me.user;
    $('#loginUser').value = ''; $('#loginPass').value = '';
    renderDash();
    try {
      const { maybeOfferAdminPasskey } = await import('./admin/tabs/passkey.js');
      await maybeOfferAdminPasskey(me.user && me.user.id);
    } catch (e) { console.warn('[admin] passkey 引导失败', e); }
  } catch (err) { if (errEl) errEl.textContent = '登录失败: ' + err.message; }
}
window.adminDoLogin = doLogin;

// ---------- 二级密码弹窗 (玩家 session 升级 combined) ----------
function showAdminEnterModal(player, adminId) {
  let bd = document.getElementById('adminEnterBackdrop');
  if (bd) bd.remove();
  bd = document.createElement('div');
  bd.id = 'adminEnterBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  bd.innerHTML = `
    <div style="background:#fff;border:3px solid #000;box-shadow:6px 6px 0 #000;padding:24px;max-width:440px;width:100%">
      <h3 style="margin:0 0 6px">🛡️ 进入管理后台</h3>
      <p style="font-size:13px;color:#888;margin:0 0 14px">玩家 <b>@${player.username}</b> 已绑管理员 #${adminId}, 输入管理员密码验证身份。</p>
      <input id="aePw" type="password" placeholder="管理员密码" style="width:100%;padding:8px 10px;border:1px solid #888;font-size:14px">
      <div id="aeMsg" style="font-size:12px;margin-top:6px;min-height:16px;color:#c33"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button id="aeCancel" style="background:#888;color:#fff;border:none;padding:8px 16px;cursor:pointer">取消</button>
        <button id="aeSave" style="background:#6cf;color:#000;border:none;padding:8px 16px;cursor:pointer;font-weight:bold">验证进入</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('#aeCancel').onclick = close;
  setTimeout(() => bd.querySelector('#aePw').focus(), 50);
  bd.querySelector('#aeSave').onclick = async () => {
    try {
      await POST('/api/init?action=admin-enter-password', { admin_password: bd.querySelector('#aePw').value });
      location.reload();
    } catch (e) { bd.querySelector('#aeMsg').textContent = '密码错误'; }
  };
}
window.showAdminEnterModal = showAdminEnterModal;

// ---------- Tab 切换 (供 HTML onclick 调) ----------
window._switchTab = function(tab) {
  // 切换 active class
  document.querySelectorAll('.admin-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
  _ensureTabRendered(tab);
};

// ---------- Filter 切换 ----------
document.addEventListener('change', e => {
  if (e.target.matches('input[type="radio"][name$="Filter"]')) {
    const name = e.target.name.replace('Filter', '');
    const map = {
      msg: 'messages', player: 'players', book: 'bookings',
      lic: 'license', kart: 'kart', circuit: 'circuit'
    };
    const tab = map[name] || name;
    if (['messages', 'players', 'bookings', 'license', 'kart', 'circuit'].includes(tab)) {
      import(`./admin/tabs/${tab}.js`).then(m => safeRender(() => m.renderTab()));
    }
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'msgSearch') {
    clearTimeout(window._msgSearchT);
    window._msgSearchT = setTimeout(() => {
      import('./admin/tabs/messages.js').then(m => m.renderMessages());
    }, 200);
  }
});

// ---------- 全局: tab 切换时也调 _ensureTabRendered ----------
document.addEventListener('click', e => {
  const tab = e.target.closest('.admin-tabs .tab');
  if (tab) {
    const name = tab.dataset.tab;
    setTimeout(() => _ensureTabRendered(name), 0);
  }
  // 刷新按钮
  if (e.target.classList.contains('pane-refresh')) {
    const target = e.target.dataset.target;
    if (target) {
      try {
        const fn = new Function('return ' + target)();
        safeRender(() => fn());
      } catch (e) { console.error('refresh failed', e); }
    }
  }
});

// ---------- Logout (全窗口) ----------
window.adminLogout = async function() {
  await POST('/api/init?action=admin-logout', {});
  location.reload();
};

// ---------- 创建玩家 (super) ----------
document.addEventListener('click', e => {
  if (e.target.id === 'btnPlayerCreate') {
    import('./admin/tabs/players.js').then(m => m.showCreatePlayerModal());
  }
});

// ---------- 编辑公告 (HTML 留了 + 按钮) ----------
document.addEventListener('click', e => {
  if (e.target.id === 'btnAddAnnouncement' || e.target.id === 'btnNewAnn') {
    import('./admin/tabs/announcements.js').then(m => m.annEdit(null));
  }
});

// ---------- 初始化 ----------
bindFilterRadios();
boot();
