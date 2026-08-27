// v45 重写: 子页 (hotel/profile/dm) 共享工具
import { $, escHtml, GET, POST, PATCH, DEL } from '../home/util.js';
export { $, escHtml, GET, POST, PATCH, DEL };

// 子页通用 nav 渲染 (基于 home/header 的逻辑简化, 但独立文件不依赖 home/header 的循环引用)
export function renderSubpageNav(slot, me, isCombined) {
  if (!slot) return;
  if (!me) {
    slot.innerHTML = `<a href="index.html" class="nav-login-link">返回首页登录</a>`;
    return;
  }
  const adminLink = isCombined
    ? `<a href="admin.html" class="nav-logout-link nav-admin-link">🛡️ 管理后台</a>`
    : '';
  slot.innerHTML = `
    <span class="nav-user-name">👤 ${escHtml(me.username)}</span>
    ${adminLink}
    <a href="dm.html" class="nav-logout-link">📨 私信</a>
    <a href="profile.html" class="nav-logout-link">${isCombined ? '我的主页' : '主页'}</a>
    <a href="#" id="navLogout" class="nav-logout-link">登出</a>
  `;
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

// 短时间 (HH:MM or MM-DD)
export function shortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.includes('Z') ? '' : 'Z'));
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  return d.toISOString().slice(5, 10);
}
