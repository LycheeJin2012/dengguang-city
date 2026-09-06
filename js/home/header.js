// v45 重写: 顶栏 + 玩家状态 + 30s 未读轮询
// 原 main.js L1857-1960 拆出来
import { $, escHtml, GET } from './util.js?v=v46-fix-modules';
import { openLoginModal } from './auth.js?v=v46-fix-modules';
import { openSigninModal } from './signin.js?v=v46-fix-modules';
const _toast = (msg, type) => window._toast && window._toast(msg, type);

const _unreadTimer = { id: null };

export function invalidatePlayerCache() {
  // 占位: 保留 export, 未来如需缓存可在此实现
  // (v46: 删除 getCurrentPlayer 死代码, 此函数暂无消费者, 保留兼容 auth.js import)
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
        <a href="profile.html#myMessagesCard" id="navBell" class="nav-logout-link nav-bell" title="通知">🔔<span class="nav-bell-badge" id="navBellBadge" hidden>0</span></a>
        <a href="dm.html" class="nav-logout-link nav-dm-link">📨 私信<span id="dmBadge" class="nav-badge nav-badge-dm">0</span></a>
        <a href="#notice" class="nav-logout-link nav-ann-link" id="navAnn">📢<span id="annBadge" class="nav-badge nav-badge-ann">新</span></a>
        <a href="#" id="navLogout" class="nav-logout-link">登出</a>`;
      prefillContactForm(p);
      // v50-N4: 主页 nav 同步拉未读通知数, 显示铃铛红点
      fetchHomeUnreadBadge().catch(() => {});
      // 登出
      $('#navLogout')?.addEventListener('click', async e => {
        e.preventDefault();
        try { await fetch('/api/login', { method: 'DELETE', credentials: 'include' }); } catch (e) {}
        invalidatePlayerCache();
        await refreshUserState();
        // 重渲染留言墙
        try {
          const m = await import('./messages.js?v=v46-fix-modules');
          m.loadPublicMessages();
        } catch (e) { console.warn('[header] 登出后重渲染留言墙失败', e); }
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
        const sigMod = await import('./signin.js?v=v46-fix-modules');
        const sd = await sigMod.fetchSigninStatus();
        const nsb = $('#navSigninBtn');
        if (nsb) {
          if (sd.signed_today) nsb.textContent = '✓ 已签';
          else if (sd.current_streak > 0) nsb.textContent = `🎁 ${sd.current_streak}天`;
        }
      } catch (e) { console.warn('[header] 刷新签到状态失败', e); }
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
    // v50-N4: 30s 轮询顺便刷一下铃铛 (玩家在首页停留时也能看到新通知)
    fetchHomeUnreadBadge().catch(() => {});
  } catch (e) { /* 静默 */ }
}

export function startUnreadPolling() {
  if (_unreadTimer.id) clearInterval(_unreadTimer.id);
  _unreadTimer.id = setInterval(pollUnread, 30000);
  pollUnread();
}

// v50-N4: 主页 nav 拉未读通知数, 更新铃铛红点
async function fetchHomeUnreadBadge() {
  const badge = $('#navBellBadge');
  if (!badge) return;
  try {
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

// ============== 服务卡按钮绑定 ==============
// v50-N6: 5 个 dead-link 服务卡 → 跳留言板 + 预填 type + focus textarea
function gotoContactForm(presetType) {
  const section = document.getElementById('contact');
  const form = document.getElementById('contactForm');
  if (!section || !form) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (presetType) {
    const sel = form.querySelector('#contactType');
    if (sel) {
      const opt = [...sel.options].find(o => o.value === presetType || o.textContent === presetType);
      if (opt) sel.value = opt.value;
    }
  }
  setTimeout(() => {
    const ta = form.querySelector('textarea');
    if (ta) ta.focus();
  }, 400);
}

export function bindServiceButtons() {
  const srvRegister = $('#srvRegister');
  if (srvRegister) {
    srvRegister.addEventListener('click', e => {
      e.preventDefault();
      openLoginModal('新市民注册 · 填写用户名+邮箱+密码即可', 'register');
    });
  }
  // v50-N6: 其余 5 个服务卡 → 跳到留言板, 预填类型
  const serviceMap = [
    { id: 'srvLand',     type: '合作' },  // 地块认领 → 合作/咨询
    { id: 'srvBuild',    type: '咨询' },  // 建筑报建 → 咨询
    { id: 'srvPower',    type: '投诉' },  // 用电报装 → 投诉/咨询
    { id: 'srvMarket',   type: '合作' },  // 市集摊位 → 合作
    { id: 'srvFeedback', type: '建议' },  // 建议与投诉 → 建议
  ];
  serviceMap.forEach(({ id, type }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', e => {
      e.preventDefault();
      gotoContactForm(type);
    });
  });
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
