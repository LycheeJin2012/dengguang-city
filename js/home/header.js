// v45 重写: 顶栏 + 玩家状态 + 30s 未读轮询
// 原 main.js L1857-1960 拆出来
import { $, escHtml, GET } from './util.js';
import { openLoginModal } from './auth.js';
import { openSigninModal } from './signin.js';
const _toast = (msg, type) => window._toast && window._toast(msg, type);

const _unreadTimer = { id: null };
let _meCache = null;

export async function getCurrentPlayer() {
  if (_meCache !== null) return _meCache;
  try {
    const d = await GET('/api/login');
    _meCache = (d && d.ok) ? d.player : null;
  } catch (e) { _meCache = null; }
  return _meCache;
}

export function invalidatePlayerCache() {
  _meCache = null;
}

// ============== 移动端菜单 ==============
export function bindMobileMenu() {
  const navToggle = $('#navToggle');
  const navLinks = $('#navLinks');
  if (!navToggle || !navLinks) return;
  navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => navLinks.classList.remove('open'));
  });
}

// ============== 顶栏玩家状态 ==============
function prefillContactForm(player) {
  if (!player) return;
  const nameEl = $('#contactName');
  if (nameEl && !nameEl.value) {
    nameEl.value = player.username;
    nameEl.readOnly = true;
    nameEl.title = '已用你的游戏ID自动填写（市政厅要求：留言姓名 = 注册用户名）';
  }
}

export async function refreshUserState() {
  const slot = $('#navUserSlot');
  if (!slot) return;
  try {
    const d = await GET('/api/login');
    if (d && d.ok && d.player) {
      const p = d.player;
      const adminLink = p.linked_admin_id
        ? `<a href="admin.html" class="nav-logout-link nav-admin-link">🛡️ 管理后台</a>`
        : '';
      slot.innerHTML = `
        <span class="nav-emerald" title="绿宝石余额">💎 <span id="navEmeraldNum">${p.emeralds || 0}</span></span>
        <a href="#" id="navSigninBtn" class="nav-logout-link nav-signin-link" title="每日签到领绿宝石">🎁 签到</a>
        <a href="profile.html" class="nav-user-name nav-profile-link">${escHtml(p.avatar_emoji || '👤')} ${escHtml(p.username)}</a>
        ${adminLink}
        <a href="dm.html" class="nav-logout-link nav-dm-link">📨 私信<span id="dmBadge" class="nav-badge nav-badge-dm">0</span></a>
        <a href="#notice" class="nav-logout-link nav-ann-link" id="navAnn">📢<span id="annBadge" class="nav-badge nav-badge-ann">新</span></a>
        <a href="#" id="navLogout" class="nav-logout-link">登出</a>`;
      prefillContactForm(p);
      // 登出
      $('#navLogout')?.addEventListener('click', async e => {
        e.preventDefault();
        try { await fetch('/api/login', { method: 'DELETE', credentials: 'include' }); } catch (e) {}
        invalidatePlayerCache();
        await refreshUserState();
        // 重渲染留言墙
        try {
          const m = await import('./messages.js');
          m.loadPublicMessages();
        } catch (e) {}
      });
      // 签到按钮
      $('#navSigninBtn')?.addEventListener('click', e => { e.preventDefault(); openSigninModal(); });
      // 公告 lastSeen
      $('#navAnn')?.addEventListener('click', () => {
        try { localStorage.setItem('lc_announcement_last_seen', String(Date.now())); } catch (e) {}
        const ab = $('#annBadge'); if (ab) ab.style.display = 'none';
      });
      // 顺便拉一次签到状态
      try {
        const sigMod = await import('./signin.js');
        const sd = await sigMod.fetchSigninStatus();
        const nsb = $('#navSigninBtn');
        if (nsb) {
          if (sd.signed_today) nsb.textContent = '✓ 已签';
          else if (sd.current_streak > 0) nsb.textContent = `🎁 ${sd.current_streak}天`;
        }
      } catch (e) {}
    } else {
      slot.innerHTML = `<a href="#" id="navLogin" class="nav-login-link">玩家登录</a>`;
      $('#navLogin')?.addEventListener('click', e => { e.preventDefault(); openLoginModal(); });
    }
  } catch (e) {
    slot.innerHTML = '';
  }
}

// ============== 30s 未读轮询 ==============
export async function pollUnread() {
  try {
    const d = await GET('/api/init?action=unread-summary');
    if (!d || !d.logged_in) return;
    const dmB = $('#dmBadge');
    if (dmB) {
      if (d.dm > 0) {
        dmB.style.display = '';
        dmB.textContent = d.dm > 99 ? '99+' : String(d.dm);
      } else {
        dmB.style.display = 'none';
      }
    }
    if (d.announcement) {
      const _seen = parseInt(localStorage.getItem('lc_announcement_last_seen') || '0', 10);
      const ann = $('#navAnn');
      const annB = $('#annBadge');
      if (d.announcement.id > _seen) {
        if (ann) ann.style.display = '';
        if (annB) annB.style.display = '';
      } else {
        if (ann) ann.style.display = 'none';
      }
    }
  } catch (e) { /* 静默 */ }
}

export function startUnreadPolling() {
  if (_unreadTimer.id) clearInterval(_unreadTimer.id);
  _unreadTimer.id = setInterval(pollUnread, 30000);
  pollUnread();
}

// ============== 服务卡按钮绑定 ==============
export function bindServiceButtons() {
  const srvRegister = $('#srvRegister');
  if (srvRegister) {
    srvRegister.addEventListener('click', e => {
      e.preventDefault();
      openLoginModal('新市民注册 · 填写用户名+邮箱+密码即可', 'register');
    });
  }
  const srvSignin = $('#srvSignin');
  if (srvSignin) {
    srvSignin.addEventListener('click', e => {
      e.preventDefault();
      openSigninModal();
    });
  }
}

export function bindAll() {
  bindMobileMenu();
  refreshUserState();
  startUnreadPolling();
  bindServiceButtons();
}
