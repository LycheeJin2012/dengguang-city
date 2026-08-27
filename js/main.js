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
    try {
      let el = document.getElementById('_bootTrace');
      if (!el) {
        el = document.createElement('pre');
        el.id = '_bootTrace';
        el.style.cssText = 'position:fixed;left:0;top:0;background:#000;color:#0f0;font:12px monospace;padding:8px;z-index:99999;max-width:90vw;max-height:50vh;overflow:auto;border:2px solid #0f0;white-space:pre-wrap';
        document.body && document.body.appendChild(el);
      }
      el.textContent = (window._bootTrace || []).join('\n');
    } catch (e) {}
  };
  try {
    _log('[1/8] imports done, starting boot...');
    _log('[2/8] bindClouds()');
    bindClouds();
    _log('[3/8] bindReveal()');
    bindReveal();
    _log('[4/8] bindHero()');
    bindHero();
    _log('[5/8] loadX (fire-and-forget)...');
    loadAnnouncements();
    loadPublicMessages();
    loadGallery();
    loadHotelRooms();
    loadKartSpecs();
    loadLicenseReqs();
    loadSigninBadge();
    _log('[6/8] bindForms()');
    bindForms();
    _log('[7/8] bindHeader()');
    bindHeader();
    _log('[8/8] bindAuth()');
    bindAuth();
    _log('✅ BOOT SUCCESS');
  } catch (e) {
    _log('❌ BOOT FAIL: ' + (e?.message || String(e)));
    _log('   @ ' + (e?.stack || '').split('\n').slice(0, 5).join('\n   '));
    window._bootError = e?.message || String(e);
  }
})();
