// v44 重写: 后台 dash (boot, tab 路由, filter 路由)
import { $, POST, safeRender } from './core.js?v=v46-fix-modules';

// Tab 渲染器: 每个 tab 第一次切到时调用对应的 render 函数
// v47: 留言/驾照/酒店 3 个 tab 合并为 tickets (统一工单入口)
const _TAB_RENDER = {
  tickets:    () => import('./tabs/tickets.v50.js').then(m => m.renderTickets()),
  players:    () => import('./tabs/players.v50.js').then(m => m.renderPlayers()),
  kart:       () => import('./tabs/kart.v50.js').then(m => m.renderKarts()),
  circuit:    () => import('./tabs/kart.v50.js').then(m => m.renderCircuits()),
  announcements: () => import('./tabs/announcements.v50.js').then(m => m.renderAnnouncements()),
  gallery:    () => import('./tabs/gallery.v50.js').then(m => m.renderGallery()),
  dms:        () => import('./tabs/dms.v50.js').then(m => m.renderDms()),
  admins:     () => import('./tabs/admins.v50.js').then(m => m.renderAdminList()),
  password:   async () => { /* 修改密码 — 留给 password.js (Stage 3) */ },
};
export function _ensureTabRendered(tab) {
  const fn = _TAB_RENDER[tab];
  if (fn) safeRender(fn);
}

// Filter 切换 (v47 简化: 只剩 playerFilter + tickets 自己内部 filter)
const _FILTER_RENDER = {
  players:     () => import('./tabs/players.v50.js').then(m => m.renderPlayers()),
  circuit_kart: () => import('./tabs/kart.v50.js').then(m => m.renderKarts()),
  kart_circuit: () => import('./tabs/kart.v50.js').then(m => m.renderCircuits()),
};
export function bindFilterRadios() {
  document.querySelectorAll('input[type="radio"][name$="Filter"]').forEach(r => {
    r.addEventListener('change', () => {
      const name = r.name;  // msgFilter, playerFilter, ...
      const fn = _FILTER_RENDER[name.replace('Filter', '')];
      if (fn) safeRender(fn);
    });
  });
  // 搜索框 (debounce 200ms) - v47 只剩 ticketSearch
  document.querySelectorAll('input[type="search"]').forEach(s => {
    let t = null;
    s.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const id = s.id;
        if (id === 'ticketSearch') import('./tabs/tickets.v50.js').then(m => m.renderTickets());
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
  // v47: 默认 active tab 改为 tickets (替换原 bookings)
  _ensureTabRendered('tickets');
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
  } catch (e) { console.warn('[admin/dash] tab 渲染失败', e); }
}

export function showView(name) {
  const views = ['login', 'dash'];
  for (const v of views) {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = v === name ? '' : 'none';
  }
}
