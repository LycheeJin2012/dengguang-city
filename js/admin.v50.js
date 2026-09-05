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
// HTML 模板 (admin.html — v50 时代主入口, 已统一命名), 通过 inline onclick 调 window.* 全局函数
// 这里导出所有需要的全局函数
import { $, POST, GET, safeRender, fileToDataURLP, cacheClear } from './admin/core.v50.js?v=v50-fix';
import { renderDash, _ensureTabRendered, bindFilterRadios, showView } from './admin/dash.v50.js?v=v50-fix';

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
// v47.7: 弹窗里加 "或" + "用通行密钥登录" 按钮, 玩家可绕过密码直接用 passkey 登 admin
// v47.9: 重写 UI 用统一的 .modal-mask/.modal/.modal-head/.modal-body 样式 (跟 admin 其他 modal 一致)
//         移除内联 style, 加关闭按钮 (×) + ESC 键 + 点背景关闭 + Enter 键提交
function showAdminEnterModal(player, adminId) {
  let bd = document.getElementById('adminEnterBackdrop');
  if (bd) bd.remove();
  bd = document.createElement('div');
  bd.id = 'adminEnterBackdrop';
  bd.className = 'modal-mask';
  bd.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-head">
        <h3>🛡️ 进入管理后台</h3>
        <button class="modal-close" id="aeClose" aria-label="关闭">✕</button>
      </div>
      <div class="modal-body">
        <p style="margin:0 0 16px;font-size:13px;color:var(--c-stone-dark);line-height:1.5">
          玩家 <b style="color:var(--c-dark)">@${player.username}</b> 已绑管理员 <b style="color:var(--c-water)">#${adminId}</b>。
          <br>选择以下任一方式验证身份进入后台:
        </p>
        <div class="modal-form" style="margin-bottom:6px">
          <label>
            <span>🔑 管理员密码</span>
            <input type="password" id="aePw" placeholder="输入管理员密码" autocomplete="current-password" />
          </label>
        </div>
        <div id="aeMsg" class="modal-msg" style="min-height:18px"></div>
        <div class="modal-actions" style="margin-bottom:18px">
          <button class="btn btn-ghost" id="aeCancel">取消</button>
          <button class="btn btn-primary" id="aeSave">▶ 验证进入</button>
        </div>
        <div class="modal-divider"><span>或</span></div>
        <button class="btn btn-ghost btn-block" id="aePasskeyBtn" style="border:2px solid var(--c-black);background:#fff">
          🔑 用通行密钥登录 (Touch ID / Face ID)
        </button>
        <div id="aePkMsg" class="modal-msg" style="min-height:18px"></div>
        <p style="margin:14px 0 0;font-size:11px;color:var(--c-stone);line-height:1.4">
          💡 通行密钥登录需在主页先注册一次 (Touch ID/Face ID), 然后 admin 绑玩家 → 一键登 admin
        </p>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('#aeClose').onclick = close;
  bd.querySelector('#aeCancel').onclick = close;
  // 点背景关闭
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  // ESC 关闭
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  setTimeout(() => bd.querySelector('#aePw').focus(), 50);
  // Enter 提交
  bd.querySelector('#aePw').addEventListener('keydown', e => {
    if (e.key === 'Enter') bd.querySelector('#aeSave').click();
  });
  bd.querySelector('#aeSave').onclick = async () => {
    const btn = bd.querySelector('#aeSave');
    const msg = bd.querySelector('#aeMsg');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ 验证中...';
    try {
      await POST('/api/init?action=admin-enter-password', { admin_password: bd.querySelector('#aePw').value });
      msg.style.color = 'var(--c-emerald)';
      msg.textContent = '✓ 验证成功, 跳转中...';
      setTimeout(() => { location.reload(); }, 500);
    } catch (e) {
      msg.style.color = 'var(--c-redstone)';
      msg.textContent = '✗ ' + (e.message || '密码错误');
      btn.disabled = false; btn.textContent = orig;
      bd.querySelector('#aePw')?.focus();
      bd.querySelector('#aePw')?.select();
    }
  };
  // v47.7: 弹窗里直接用 passkey 登 admin (target='admin'), 玩家可绕过密码
  bd.querySelector('#aePasskeyBtn').onclick = async () => {
    const btn = bd.querySelector('#aePasskeyBtn');
    const msg = bd.querySelector('#aePkMsg');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 准备中...';
    let timer = setTimeout(() => { btn.disabled = false; btn.textContent = orig; msg.style.color = 'var(--c-redstone)'; msg.textContent = '✗ 操作超时, 请重试'; }, 30000);
    try {
      const r1 = await fetch('/api/init?action=passkey-login-start', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const d1 = await r1.json();
      if (!r1.ok || d1.error) throw new Error(d1.error || 'challenge 失败');
      if (!d1.publicKey) throw new Error('服务器未返回 challenge');
      const opts = d1.publicKey;
      opts.challenge = b64urlToBuf(opts.challenge);
      if (opts.allowCredentials) {
        opts.allowCredentials = opts.allowCredentials.map(c => ({ ...c, id: b64urlToBuf(c.id) }));
      }
      btn.textContent = '⏳ 请触摸指纹/Face ID...';
      let cred;
      try {
        cred = await navigator.credentials.get({ publicKey: opts, mediation: 'optional' });
      } catch (we) {
        if (we.name === 'NotAllowedError') throw new Error('已取消');
        throw we;
      }
      if (!cred) throw new Error('未获得凭据');
      btn.textContent = '⏳ 验证中...';
      const r2 = await fetch('/api/init?action=passkey-login-finish', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_token: d1.challenge_token,
          target: 'admin',
          credential: {
            id: cred.id,
            rawId: bufToB64url(cred.rawId),
            type: cred.type,
            response: {
              clientDataJSON: bufToB64url(cred.response.clientDataJSON),
              authenticatorData: bufToB64url(cred.response.authenticatorData),
              signature: bufToB64url(cred.response.signature),
              userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : null,
            },
          },
        }),
      });
      const d2 = await r2.json();
      if (!r2.ok || d2.error) throw new Error(d2.error || '验证失败');
      clearTimeout(timer);
      msg.style.color = 'var(--c-emerald)';
      msg.textContent = '✓ 验证成功, 跳转中...';
      setTimeout(() => { location.reload(); }, 500);
    } catch (e) {
      clearTimeout(timer);
      msg.style.color = 'var(--c-redstone)';
      msg.textContent = '✗ ' + (e.message || String(e));
    } finally {
      clearTimeout(timer);
      btn.disabled = false;
      btn.textContent = orig;
    }
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
    // 切 active class + pane display (HTML tab 按钮没 inline onclick, 必须在这里切)
    document.querySelectorAll('.admin-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
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

// ---------- v47.5: 管理员后台通行密钥登录 ----------
// 玩家先在主页用 Touch ID/Face ID 注册通行密钥, admin 端绑玩家 → 即可用同一密钥登 admin
// (target='admin' 让 finish 创建 admin session 而不是 player session)
function bufToB64url(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBuf(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bindAdminPasskey() {
  const btn = $('#adminPasskeyBtn');
  if (!btn) return;
  if (!window.PublicKeyCredential) {
    btn.disabled = true;
    btn.textContent = '⚠ 当前浏览器不支持通行密钥';
    return;
  }
  if (!window.isSecureContext) {
    btn.disabled = true;
    btn.textContent = '⚠ 需要 HTTPS';
    return;
  }
  btn.addEventListener('click', async () => {
    const errEl = $('#loginError');
    if (errEl) errEl.textContent = '';
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 准备中...';
    const showErr = (m) => { if (errEl) { errEl.textContent = '✗ ' + m; setTimeout(() => { if (errEl) errEl.textContent = ''; }, 5000); } };
    let timer = setTimeout(() => { btn.disabled = false; btn.textContent = orig; showErr('操作超时, 请重试'); }, 30000);
    try {
      // 1) start: username 不填 → 浏览器列所有可用密钥
      const r1 = await fetch('/api/init?action=passkey-login-start', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const d1 = await r1.json();
      if (!r1.ok || d1.error) throw new Error(d1.error || 'challenge 失败');
      if (!d1.publicKey) throw new Error('服务器未返回 challenge');
      const opts = d1.publicKey;
      opts.challenge = b64urlToBuf(opts.challenge);
      if (opts.allowCredentials) {
        opts.allowCredentials = opts.allowCredentials.map(c => ({ ...c, id: b64urlToBuf(c.id) }));
      }
      btn.textContent = '⏳ 请触摸指纹/Face ID...';
      let cred;
      try {
        cred = await navigator.credentials.get({ publicKey: opts, mediation: 'optional' });
      } catch (we) {
        if (we.name === 'NotAllowedError') throw new Error('已取消, 请重试');
        throw we;
      }
      if (!cred) throw new Error('未获得凭据');
      btn.textContent = '⏳ 验证中...';
      // 2) finish: 传 target='admin' 让后端创建 admin session
      const r2 = await fetch('/api/init?action=passkey-login-finish', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_token: d1.challenge_token,
          target: 'admin',
          credential: {
            id: cred.id,
            rawId: bufToB64url(cred.rawId),
            type: cred.type,
            response: {
              clientDataJSON: bufToB64url(cred.response.clientDataJSON),
              authenticatorData: bufToB64url(cred.response.authenticatorData),
              signature: bufToB64url(cred.response.signature),
              userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : null,
            },
          },
        }),
      });
      const d2 = await r2.json();
      if (!r2.ok || d2.error) throw new Error(d2.error || '验证失败');
      clearTimeout(timer);
      // 成功! 后端已通过 Set-Cookie 写 lc_session cookie
      if (errEl) { errEl.style.color = 'var(--c-emerald)'; errEl.textContent = '✓ 登录成功, 跳转中...'; }
      setTimeout(() => { location.reload(); }, 500);
    } catch (e) {
      clearTimeout(timer);
      showErr('通行密钥失败: ' + (e.message || String(e)));
    } finally {
      clearTimeout(timer);
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}

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
bindAdminPasskey();
boot();
