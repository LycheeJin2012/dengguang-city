// v45 重写: 公共页入口 (ES module) — DEBUG 版
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

window.openSigninModal = openSigninModal;

// DEBUG: 把 import 错误暴露到 DOM
window._bootTrace = [];
window._bootError = null;
try {
  window._bootTrace.push('imports OK at ' + new Date().toISOString());
} catch (e) { /* ignore */ }

(async function boot() {
  const _log = (m) => {
    try { window._bootTrace.push(m); } catch (e) {}
    try { console.log('[boot]', m); } catch (e) {}
  };
  try {
    _log('bindClouds start');
    bindClouds();
    _log('bindClouds done');
    bindReveal();
    bindHero();
    _log('bindHero done');

    loadAnnouncements();
    loadPublicMessages();
    loadGallery();
    loadHotelRooms();
    loadKartSpecs();
    loadLicenseReqs();
    loadSigninBadge();
    _log('all loadX issued');

    bindForms();
    bindHeader();
    bindAuth();
    _log('all bindX done — BOOT SUCCESS');
  } catch (e) {
    _log('BOOT FAIL: ' + (e?.message || String(e)) + ' @ ' + (e?.stack || '').split('\n').slice(0, 3).join(' | '));
    window._bootError = e?.message || String(e);
  }
})();
