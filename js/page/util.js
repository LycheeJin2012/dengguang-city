// v45 重写: 子页 (hotel/profile/dm) 共享工具
import { $, escHtml, GET, POST, PATCH, DEL } from '../home/util.js?v=v46-fix-modules';
import { t } from '../i18n/core.js?v=n5';
export { $, escHtml, GET, POST, PATCH, DEL };
// v49-fix-2: 加 'esc' 别名 export — 4 个 profile 业务文件 (race-times / exam-practice /
// citizen-card / subscriptions) import 'esc', 改 import 不如在 util.js 加别名, 1 处改完
export { escHtml as esc };

// 子页通用 nav 渲染 (基于 home/header 的逻辑简化, 但独立文件不依赖 home/header 的循环引用)
// v50-N4: 加通知铃铛 + 未读红点 (admin 回复玩家留言后, 玩家在 profile/dm 看到红点)
export function renderSubpageNav(slot, me, isCombined) {
  if (!slot) return;
  if (!me) {
    slot.innerHTML = `<a href="index.html" class="nav-login-link">${t('subnav.loginFirst', '返回首页登录')}</a>`;
    return;
  }
  const adminLink = isCombined
    ? `<a href="admin.html" class="nav-logout-link nav-admin-link">🛡️ ${t('subnav.adminPanel', '管理后台')}</a>`
    : '';
  // 铃铛 + 红点: 默认 0, 异步 fetch /api/notifications?my=1&unread=1 拿真实未读数
  //   profile/dm 顶 nav 是同一份代码, 都共用红点
  slot.innerHTML = `
    <span class="nav-user-name">👤 ${escHtml(me.username)}</span>
    <a href="profile.html#myMessagesCard" id="navBell" class="nav-logout-link nav-bell" title="${t('subnav.notif', '通知')}">
      🔔<span class="nav-bell-badge" id="navBellBadge" hidden>0</span>
    </a>
    ${adminLink}
    <a href="dm.html" class="nav-logout-link">📨 ${t('subnav.dm', '私信')}</a>
    <a href="profile.html" class="nav-logout-link">${isCombined ? t('subnav.myProfile', '我的主页') : t('subnav.profile', '主页')}</a>
    <a href="#" id="navLogout" class="nav-logout-link">${t('subnav.logout', '登出')}</a>
  `;
  // 异步拉未读数 (失败静默)
  fetchUnreadBadge(slot).catch(() => {});
  slot.querySelector('#navLogout')?.addEventListener('click', async e => {
    e.preventDefault();
    if (isCombined) {
      try { await POST('/api/init?action=admin-logout', {}); } catch (e2) {}
      location.href = 'index.html';
    } else {
      try { await DEL('/api/login'); } catch (e2) {}
      location.href = 'index.html';
    }
  });
}

// 拉未读通知数, 更新红点
async function fetchUnreadBadge(slot) {
  const badge = slot.querySelector('#navBellBadge');
  if (!badge) return;
  try {
    // API 已直接返 unread_count 字段, limit=1 只为节省 payload
    const r = await fetch('/api/notifications?my=1&unread=1&limit=1', { credentials: 'include' });
    if (!r.ok) return;
    const d = await r.json();
    const n = Number(d.unread_count || 0);
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch (e) { /* 静默 */ }
}

// 短时间 (HH:MM or MM-DD)
export function shortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.includes('Z') ? '' : 'Z'));
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  return d.toISOString().slice(5, 10);
}
