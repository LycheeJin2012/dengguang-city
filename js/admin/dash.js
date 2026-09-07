// v44 重写: 后台 dash (boot, tab 路由, filter 路由)
// v50-N6: 启动时拉 dashboard API 一次性更新 4 个 tab 角标 (playerPending / kartPending / circuitPending / ticketTotalBadge)
import { $, POST, GET, safeRender } from './core.js?v=v46-fix-modules';

// Tab 渲染器: 每个 tab 第一次切到时调用对应的 render 函数
// v47: 留言/驾照/酒店 3 个 tab 合并为 tickets (统一工单入口)
const _TAB_RENDER = {
  tickets:    () => import('./tabs/tickets.js').then(m => m.renderTickets()),
  players:    () => import('./tabs/players.js').then(m => m.renderPlayers()),
  kart:       () => import('./tabs/kart.js').then(m => m.renderKarts()),
  circuit:    () => import('./tabs/kart.js').then(m => m.renderCircuits()),
  announcements: () => import('./tabs/announcements.js').then(m => m.renderAnnouncements()),
  gallery:    () => import('./tabs/gallery.js').then(m => m.renderGallery()),
  dms:        () => import('./tabs/dms.js').then(m => m.renderDms()),
  admins:     () => import('./tabs/admins.js').then(m => m.renderAdminList()),
  password:   async () => { /* 修改密码 — 留给 password.js (Stage 3) */ },
};
// v50-N6 fix: pane-refresh 按钮 (admin-v37.html 里的 .pane-refresh data-target="renderXxx")
// 之前用 eval/new Function 找不到 module 导出的 renderDms 等
// 改成 key → dynamic import, 跟 _TAB_RENDER 同 pattern
export const _PANE_REFRESH = {
  renderTickets:       () => import('./tabs/tickets.js').then(m => m.renderTickets()),
  renderAdminList:     () => import('./tabs/admins.js').then(m => m.renderAdminList()),
  renderPlayers:       () => import('./tabs/players.js').then(m => m.renderPlayers()),
  renderKarts:         () => import('./tabs/kart.js').then(m => m.renderKarts()),
  renderAnnouncements: () => import('./tabs/announcements.js').then(m => m.renderAnnouncements()),
  renderDms:           () => import('./tabs/dms.js').then(m => m.renderDms()),
  renderGallery:       () => import('./tabs/gallery.js').then(m => m.renderGallery()),
};
export function _ensureTabRendered(tab) {
  const fn = _TAB_RENDER[tab];
  if (fn) safeRender(fn);
}

// Filter 切换 (v47 简化: 只剩 playerFilter + tickets 自己内部 filter)
const _FILTER_RENDER = {
  players:     () => import('./tabs/players.js').then(m => m.renderPlayers()),
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
  // 搜索框 (debounce 200ms) - v47 只剩 ticketSearch
  document.querySelectorAll('input[type="search"]').forEach(s => {
    let t = null;
    s.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const id = s.id;
        if (id === 'ticketSearch') import('./tabs/tickets.js').then(m => m.renderTickets());
      }, 200);
    });
  });
  // 刷新按钮 (v50-N6 fix: renderDms 等是 module 导出, eval/new Function 找不到 → 改 dynamic import)
  document.querySelectorAll('.pane-refresh').forEach(b => {
    b.addEventListener('click', () => {
      const target = b.dataset.target;
      const fn = _PANE_REFRESH[target];
      if (fn) safeRender(fn);
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
  // v50-N6: 拉 dashboard 数字 (角标), 失败静默
  fetchBadges().catch(() => {});
  // v50-N6: 手动刷新按钮
  document.getElementById('dashRefresh')?.addEventListener('click', () => fetchBadges().catch(() => {}));
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

// v50-N6: 拉 dashboard 数字, 1 次 GET 更新 4 个 tab 角标 + 6 个 stat 卡片 (替代每个 tab 自己 fetch)
async function fetchBadges() {
  const d = await GET('/api/admin/dashboard');
  if (!d || !d.ok) return;
  // playerPending (注册审批)
  const pp = d.player_pending || 0;
  const ppEl = document.getElementById('playerPending');
  if (ppEl) ppEl.textContent = pp > 0 ? `(${pp})` : '';
  // kartPending (赛道报名待审)
  const kp = d.kart_pending || 0;
  const kpEl = document.getElementById('kartPending');
  if (kpEl) kpEl.textContent = kp > 0 ? `(${kp})` : '';
  // circuitPending (国际赛车场待审)
  const cp = d.circuit_pending || 0;
  const cpEl = document.getElementById('circuitPending');
  if (cpEl) cpEl.textContent = cp > 0 ? `(${cp})` : '';
  // ticketTotalBadge (工单总数, tickets.js 也会再更新一次)
  const tt = d.msg_unread || 0;
  const ttEl = document.getElementById('ticketTotalBadge');
  if (ttEl) ttEl.textContent = tt > 0 ? `(${tt})` : '';
  // v50-N6: 后台概览 6 个 stat 卡片
  // data-key → 从 dashboard 响应里找对应数字
  const keyMap = {
    playerPending:   d.players?.pending || 0,
    playerActive:    d.players?.active || 0,
    msgUnread:       d.messages?.unread || 0,
    bookPending:     d.bookings?.pending || 0,
    licensePending:  d.license?.pending || 0,
    kartPending:     (d.kart?.pending || 0) + (d.circuit?.pending || 0),  // 赛道+国际赛车合并显示
  };
  document.querySelectorAll('.dash-stat').forEach(btn => {
    const key = btn.dataset.key;
    const n = keyMap[key] || 0;
    const numEl = btn.querySelector('.dash-stat-num');
    if (numEl) {
      numEl.textContent = n;
      numEl.classList.toggle('zero', n === 0);
    }
    // 点击 stat 卡 → 跳对应 tab
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) {
        const tabEl = document.querySelector(`.tab[data-tab="${tab}"]`);
        if (tabEl) tabEl.click();
      }
    });
  });
  // v50-N6: 写入"上次刷新"时间戳
  const upd = document.getElementById('dashLastUpdate');
  if (upd) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    upd.textContent = t('admin.dash.lastUpdate', '数据更新于') + ` ${hh}:${mm}:${ss}`;
  }
}
