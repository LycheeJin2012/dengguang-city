// v45 重写: hotel 子页 entry (ES module)
import { $, injectLangSwitch } from '../util.js?v=v46-fix-modules';
import { loadRooms, bindFilters, bindRoomDetail } from './rooms.js?v=v46-fix-modules';
import { bindBook } from './book.js?v=v46-fix-modules';
import { initI18n, setPageTitle, setMetaDescription } from '../../i18n/core.js?v=n5';

// v50-N6: SEO meta + i18n 初始化
setPageTitle('page.title.hotel', 'Treehouse Hotel | Light City Hall');
setMetaDescription('page.meta.hotel', 'Light City Treehouse Hotel - Room browsing, status filters, and booking.');

(async function boot() {
  // v50-N6: i18n 必须先 init 才能让 data-i18n 生效
  await initI18n();
  // 顶 nav 移动端 toggle
  const navToggle = $('#navToggle');
  const navLinks = $('#navLinks');
  if (navToggle && navLinks) navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
  // v50-N6: 注入语言切换按钮 (共用 util 里的 injectLangSwitch)
  injectLangSwitch(navLinks);
  // 切语言后重拉房型 (状态 label 跟语言走)
  window.addEventListener('lc:langchange', () => loadRooms());
  // 回顶
  $('#backTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  // 业务
  bindRoomDetail();
  bindBook();
  bindFilters();
  await loadRooms();
})();
