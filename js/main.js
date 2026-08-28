// v45 重写: 公共页入口 (ES module)
// 拆 11 个 home/ 子模块, 启动顺序:
//   1. 视觉 (clouds, reveal, hero) - 立刻挂 scroll/resize
//   2. 数据加载 (announcements, messages, gallery, services)
//   3. 玩家登录态 (header, auth, signin, forms)
import { bindClouds } from './home/clouds.js';
import { bindReveal } from './home/reveal.js';
import { bindAll as bindHero } from './home/hero.js';
import { loadAnnouncements } from './home/announcements.js';
import { loadPublicMessages } from './home/messages.js';
import { loadGallery } from './home/gallery.js';
import { loadHotelRooms, loadKartSpecs, loadLicenseReqs, bindAll as bindForms } from './home/forms.js';
import { bindAll as bindHeader } from './home/header.js';
import { bindAll as bindAuth } from './home/auth.js';
import { loadSigninBadge, openSigninModal } from './home/signin.js';

// 暴露到 window (兼容 HTML inline onclick, e.g. data-stat 触发)
window.openSigninModal = openSigninModal;

(async function boot() {
  // 1. 视觉: scroll/resize 不阻塞, 立即挂
  bindClouds();
  bindReveal();
  bindHero();

  // 2. 数据加载: 拉后端数据覆盖 hardcoded 草拟
  loadAnnouncements();
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
})();
