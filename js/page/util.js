// v50: 子页 (hotel/profile/dm) 共享工具 — 复用 home/util 的所有 export + 子页专用 helper
export { $, esc as escHtml, GET, POST, PATCH, DELETE as DEL, safeRender } from '../home/util.js?v=20260905-v50-0';

// 子页通用: 短时间格式
export function shortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.includes('Z') ? '' : 'Z'));
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  return d.toISOString().slice(5, 10);
}

// 子页通用: render user slot (subpage navbar)
export async function renderSubpageUserSlot() {
  const slot = document.getElementById('navUserSlot');
  if (!slot) return null;
  let me = null;
  try { const d = await GET('/api/auth/me'); me = d.player || d.user || null; } catch (e) { me = null; }
  if (!me) {
    slot.innerHTML = `<button class="btn btn-ghost btn-sm" data-open-login>登录</button>`;
    slot.querySelector('[data-open-login]')?.addEventListener('click', () => {
      const m = document.getElementById('loginMask');
      if (m) { m.style.display = ''; document.body.style.overflow = 'hidden'; }
    });
    return null;
  }
  slot.innerHTML = `<a href="profile.html" class="nav-user">${me.avatar_emoji || '👤'} ${me.username}</a>`;
  return me;
}
