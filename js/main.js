// v50: 公共页入口 (ES module)
// 启动顺序:
//   1. 视觉 (theme 已在 <head> 后挂浮动按钮 / navbar toggle 立即挂)
//   2. 数据加载 (announcements, public messages, gallery, services, kart, license, hotel)
//   3. 玩家登录态 (header, auth, signin, forms)
//   4. 通用 modal (form mask / lightbox / login mask)

import { bindClouds } from './home/clouds.js?v=20260905-v50-0';
import { bindReveal } from './home/reveal.js?v=20260905-v50-0';
import { bindAll as bindHero } from './home/hero.js?v=20260905-v50-0';
import { loadAnnouncements } from './home/announcements.js?v=20260905-v50-0';
import { loadPublicMessages } from './home/messages.js?v=20260905-v50-0';
import { loadGallery } from './home/gallery.js?v=20260905-v50-0';
import { bindAll as bindForms, loadHotelRooms, loadKartSpecs, loadLicenseReqs, loadScenery } from './home/forms.js?v=20260905-v50-0';
import { bindAll as bindHeader } from './home/header.js?v=20260905-v50-0';
import { bindAll as bindAuth } from './home/auth.js?v=20260905-v50-0';
import { loadSigninBadge, openSigninModal } from './home/signin.js?v=20260905-v50-0';
import { bindLightbox, bindGenericForm, bindLogin } from './home/ui.js?v=20260905-v50-0';

window.openSigninModal = openSigninModal;
window.openForm = (kind) => {
  // 通用报名 modal: kind = 'kartSignup' | 'license' | 'hotelBook'
  if (window._openGenericForm) window._openGenericForm(kind);
};

(async function boot() {
  // 1. 视觉
  bindClouds();
  bindReveal();
  bindHero();
  bindLightbox();

  // 2. 数据加载
  loadAnnouncements();
  loadPublicMessages();
  loadGallery();
  loadScenery();
  loadHotelRooms();
  loadKartSpecs();
  loadLicenseReqs();
  loadSigninBadge();

  // 3. 交互绑定
  bindForms();
  bindHeader();
  bindAuth();
  bindGenericForm();
  bindLogin();
})();
