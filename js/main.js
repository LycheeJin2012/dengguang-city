// v45 重写: 公共页入口 (ES module)
// 拆 11 个 home/ 子模块, 启动顺序:
//   1. 视觉 (clouds, reveal, hero) - 立刻挂 scroll/resize
//   2. 数据加载 (announcements, messages, gallery, services)
//   3. 玩家登录态 (header, auth, signin, forms)
// v50-N5: 启动时初始化 i18n (主页 nav data-i18n 由 core.js applyToDOM 自动翻译)
import { bindClouds } from './home/clouds.js';
import { bindReveal } from './home/reveal.js';
import { bindAll as bindHero } from './home/hero.js';
import { loadAnnouncements, loadTopStripNotice } from './home/announcements.js';
import { loadPublicMessages, bindWallSort } from './home/messages.js';
import { loadGallery } from './home/gallery.js';
import { loadHotelRooms, loadKartSpecs, loadLicenseReqs, bindAll as bindForms } from './home/forms.js';
import { bindAll as bindHeader } from './home/header.js';
import { bindAll as bindAuth } from './home/auth.js';
import { loadSigninBadge, openSigninModal } from './home/signin.js';
import { bindKeyboardShortcuts } from './home/keyboard.js?v=n6';
import { initI18n, bindLangSwitcher, renderLangSwitcher, setPageTitle, setMetaDescription } from './i18n/core.js?v=n5';

// 暴露到 window (兼容 HTML inline onclick, e.g. data-stat 触发)
window.openSigninModal = openSigninModal;

(async function boot() {
  // 0. i18n: 立即初始化 (把 <html lang="..."> 设好 + 应用已存在的 data-i18n)
  initI18n();
  setPageTitle('page.title.home');
  setMetaDescription('page.meta.home');

  // 1. 视觉: scroll/resize 不阻塞, 立即挂
  bindClouds();
  bindReveal();
  bindHero();

  // 2. 数据加载: 拉后端数据覆盖 hardcoded 草拟
  loadAnnouncements();
  loadTopStripNotice();
  loadPublicMessages();
  loadGallery();
  loadHotelRooms();
  loadKartSpecs();
  loadLicenseReqs();
  loadSigninBadge();

  // 3. 交互绑定: 表单 + 玩家状态
  bindForms();
  bindHeader();
  bindAuth();
  bindWallSort();

  // 4. v50-N5: 把语言切换器按钮注入到 .nav-links 末尾, 然后绑事件
  const navLinks = document.getElementById('navLinks');
  if (navLinks) {
    // 用 <li> 包一层保持 nav 排版一致
    const wrap = document.createElement('span');
    wrap.className = 'nav-lang-wrap';
    wrap.innerHTML = renderLangSwitcher();
    navLinks.appendChild(wrap);
    bindLangSwitcher(navLinks);
  }

  // 5. v50-N6: 键盘快捷键 (g/h/n/d/s/b/?)
  bindKeyboardShortcuts();
})();
