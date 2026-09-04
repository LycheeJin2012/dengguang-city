// v50: navbar — 玩家登录态 / 头像 / 菜单 / nav toggle
import { $ } from './util.js?v=20260905-v50-0';
import { refreshUserState } from './auth-helpers.js?v=20260905-v50-0';

export function bindAll() {
  const toggle = $('#navToggle');
  const links = $('#navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
    links.addEventListener('click', e => {
      if (e.target.tagName === 'A' && window.innerWidth <= 768) links.classList.remove('open');
    });
  }
  refreshUserState();
}
