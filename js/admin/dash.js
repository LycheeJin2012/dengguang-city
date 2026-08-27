// v44 重写: 后台 dash (boot, tab 路由, filter 路由)
import { $, POST, safeRender } from './core.js';

// Tab 渲染器: 每个 tab 第一次切到时调用对应的 render 函数
const _TAB_RENDER = {
  messages: () => import('./tabs/messages.js').then(m => m.renderMessages()),
  players:  () => import('./tabs/players.js').then(m => m.renderPlayers()),
  bookings:  () => import('./tabs/bookings.js').then(m => m.renderBookings()),
  license:  () => import('./tabs/license.js').then(m => m.renderLicense()),
  kart:     () => import('./tabs/kart.js').then(m => m.renderKarts()),
  circuit:  () => import('./tabs/kart.js').then(m => m.renderCircuits()),
  announcements: () => import('./tabs/announcements.js').then(m => m.renderAnnouncements()),
  gallery:  () => import('./tabs/gallery.js').then(m => m.renderGallery()),
  dms:      () => import('./tabs/dms.js').then(m => m.renderDms()),
  admins:   () => import('./tabs/admins.js').then(m => m.renderAdminList()),
  password: async () => { /* 修改密码 — 留给 password.js (Stage 3) */ },
};
export function _ensureTabRendered(tab) {
  const fn = _TAB_RENDER[tab];
  if (fn) safeRender(fn);
}

// Filter 切换 (用于 msgFilter / bookFilter / licenseFilter 等)
const _FILTER_RENDER = {
  messages:    () => import('./tabs/messages.js').then(m => m.renderMessages()),
  players:     () => import('./tabs/players.js').then(m => m.renderPlayers()),
  bookings:     () => import('./tabs/bookings.js').then(m => m.renderBookings()),
  license:     () => import('./tabs/license.js').then(m => m.renderLicense()),
  circuit_kart: () => import('./tabs/kart.js').then(m => m.renderKarts()),
  kart_circuit: () => import('./tabs/kart.js').then(m => m.renderCircuits()),
};
export function bindFilterRadios() {
  document.querySelectorAll('input[type="radio"][name$="Filter"]').forEach(r => {
    r.addEventListener('change', () => {
      const name = r.name;  // msgFilter, playerFilter, ...
      const fn = _FILTER_RENDER[name.replace('Filter', '')];
      if (fn) safeRender(fn);
    });
  });
  // 搜索框 (debounce 200ms)
  document.querySelectorAll('input[type="search"]').forEach(s => {
    let t = null;
    s.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const id = s.id;
        if (id === 'msgSearch') import('./tabs/messages.js').then(m => m.renderMessages());
      }, 200);
    });
  });
  // 刷新按钮
  document.querySelectorAll('.pane-refresh').forEach(b => {
    b.addEventListener('click', () => {
      const target = b.dataset.target;
      if (target) safeRender(() => eval(target + '()'));  // 注意: 仅 trusted source
    });
  });
}

export function renderDash() {
  try {
    const a = window._me;
    $('#userName').textContent = a.username;
    const r = $('#userRole');
    r.textContent = a.role === 'super' ? 'SUPER' : 'ADMIN';
    r.className = 'role-tag role-' + a.role;
    const ba = $('#btnAddAdmin');
    if (ba) ba.style.display = a.role === 'super' ? '' : 'none';
  } catch (e) { throw e; }
  showView('dash');
  // v34: 只 render 默认 active tab (HTML 默认 .tab-pane.active = bookings)
  _ensureTabRendered('bookings');
  // 仅 super 可见 DM 监管 tab
  try {
    if (window._me && window._me.role === 'super') {
      const td = document.getElementById('tabDms');
      if (td) td.style.display = '';
      const ta = document.getElementById('tabAnnouncements');
      if (ta) ta.style.display = '';
      // 首次拉 AI 转人工数
      POST('/api/init?action=admin-dm-ai-struggle', {})
        .then(d => {
          if (d.ok) {
            const c = (d.struggles || []).length;
            const e = document.getElementById('dmsAiStruggle');
            if (e) e.textContent = String(c);
          }
        }).catch(() => {});
    }
  } catch (e) {}
}

export function showView(name) {
  const views = ['login', 'dash'];
  for (const v of views) {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = v === name ? '' : 'none';
  }
}
