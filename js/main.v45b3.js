// v45 debug 2: 不 import, 立刻改 title 测 module 加载
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

// 同步 trace
function _trace(msg) {
  console.log('[boot]', msg);
  try {
    let el = document.getElementById('_bootTrace');
    if (!el) {
      el = document.createElement('pre');
      el.id = '_bootTrace';
      el.style.cssText = 'position:fixed;left:0;top:0;background:#000;color:#0f0;font:12px monospace;padding:8px;z-index:99999;max-width:90vw;max-height:50vh;overflow:auto;border:2px solid #0f0;white-space:pre-wrap';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = (el.textContent || '') + msg + '\n';
  } catch (e) {}
}

window._bootTrace = [];
window._bootError = null;
_trace('=== module loaded, imports OK ===');

window.openSigninModal = openSigninModal;

(async function boot() {
  try {
    _trace('[1/8] boot start');
    bindClouds();
    _trace('[2/8] bindClouds done');
    bindReveal();
    bindHero();
    _trace('[3/8] bindHero done');

    _trace('[4/8] loadX (fire)...');
    loadAnnouncements();
    loadPublicMessages();
    loadGallery();
    loadHotelRooms();
    loadKartSpecs();
    loadLicenseReqs();
    loadSigninBadge();
    _trace('[5/8] all loadX issued');

    bindForms();
    _trace('[6/8] bindForms done');
    bindHeader();
    _trace('[7/8] bindHeader done');
    bindAuth();
    _trace('[8/8] bindAuth done — BOOT SUCCESS');
  } catch (e) {
    _trace('❌ FAIL: ' + (e?.message || String(e)));
    _trace('   stack: ' + (e?.stack || '').split('\n').slice(0, 8).join('\n   '));
    window._bootError = e?.message || String(e);
  }
})();
