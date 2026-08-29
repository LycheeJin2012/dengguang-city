// v45 重写: hotel 子页 entry (ES module)
import { $ } from '../util.js?v=v46-fix-modules';
import { loadRooms, bindFilters, bindRoomDetail } from './rooms.js?v=v46-fix-modules';
import { bindBook } from './book.js?v=v46-fix-modules';

(async function boot() {
  // 顶 nav 移动端 toggle
  const navToggle = $('#navToggle');
  const navLinks = $('#navLinks');
  if (navToggle && navLinks) navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
  // 回顶
  $('#backTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  // 业务
  bindRoomDetail();
  bindBook();
  bindFilters();
  await loadRooms();
})();
