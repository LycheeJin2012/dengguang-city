// v50: auth helpers — 玩家登录态查询 / 缓存
import { GET } from './util.js?v=20260905-v50-0';

let _playerCache = null;
let _lastFetch = 0;

export async function refreshUserState() {
  const now = Date.now();
  if (_playerCache && now - _lastFetch < 30_000) return _playerCache;
  try {
    const d = await GET('/api/auth/me');
    _playerCache = d.player || d.user || null;
    _lastFetch = now;
    renderUserSlot(_playerCache);
    return _playerCache;
  } catch (e) {
    renderUserSlot(null);
    return null;
  }
}

export function invalidatePlayerCache() {
  _playerCache = null;
  _lastFetch = 0;
}

function renderUserSlot(p) {
  const slot = document.getElementById('navUserSlot');
  if (!slot) return;
  if (p) {
    slot.innerHTML = `<a href="profile.html" class="nav-user">${p.avatar_emoji || '👤'} <span class="nav-user-name">${p.username || ''}</span></a>`;
  } else {
    slot.innerHTML = `<button class="btn btn-ghost btn-sm" data-open-login>登录</button>`;
    slot.querySelector('[data-open-login]')?.addEventListener('click', () => {
      if (window.openSigninModal) window.openSigninModal();
      else {
        const m = document.getElementById('loginMask');
        if (m) m.style.display = '';
      }
    });
  }
}
