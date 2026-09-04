// v50: hotel 子页 entry
import { $ } from '../util.js?v=20260905-v50-0';
import { loadRooms, bindFilters, bindRoomDetail } from './rooms.js?v=20260905-v50-0';
import { bindBook } from './book.js?v=20260905-v50-0';
import { renderSubpageUserSlot } from '../util.js?v=20260905-v50-0';

(async function boot() {
  // 顶 nav 移动端 toggle
  const navToggle = $('#navToggle');
  const navLinks = $('#navLinks');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.addEventListener('click', e => {
      if (e.target.tagName === 'A' && window.innerWidth <= 768) navLinks.classList.remove('open');
    });
  }
  // 回顶
  const backTop = $('#backTop');
  if (backTop) {
    backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.addEventListener('scroll', () => {
      backTop.classList.toggle('show', window.scrollY > 400);
    }, { passive: true });
  }
  // 登录 modal close / esc
  const loginMask = $('#loginMask');
  if (loginMask) {
    $('#loginClose')?.addEventListener('click', () => { loginMask.style.display = 'none'; document.body.style.overflow = ''; });
    loginMask.addEventListener('click', e => { if (e.target === loginMask) { loginMask.style.display = 'none'; document.body.style.overflow = ''; } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && loginMask.style.display !== 'none') { loginMask.style.display = 'none'; document.body.style.overflow = ''; } });
  }
  // 业务
  await renderSubpageUserSlot();
  bindRoomDetail();
  bindBook();
  bindFilters();
  await loadRooms();
})();
