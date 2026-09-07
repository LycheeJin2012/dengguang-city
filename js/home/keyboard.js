// v50-N6: 键盘快捷键 (g=留言 h=顶部 s=服务 b=风貌 n=公告 d=数据 ?=帮助)
//
// 设计原则:
// 1. 输入框/textarea 聚焦时不拦截 (避免影响留言输入)
// 2. 不拦截修饰键 (Cmd/Ctrl/Alt 仍给浏览器)
// 3. 帮助 modal Esc 关闭
// 4. 中文页和英文页都显示同一套快捷键 (单键 a-z 触发, 跟 GitHub/Twitter 一致)

import { t } from '../i18n/core.js?v=n5';

// 注入 modal 样式 (避免依赖外部 CSS 文件, 减少 build 复杂度)
(function injectKbdCss() {
  if (document.getElementById('kbdHelpCss')) return;
  const s = document.createElement('style');
  s.id = 'kbdHelpCss';
  s.textContent = `
.kbd-help-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .15s ease-out}
.kbd-help-modal{background:var(--c-bg-1,#f3e9c8);border:3px solid var(--c-border,#2a2a2a);box-shadow:6px 6px 0 var(--c-border,#2a2a2a);padding:0;max-width:420px;width:100%;font-family:inherit}
.kbd-help-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:2px solid var(--c-border,#2a2a2a);background:var(--c-bg-2,#e0d6b1)}
.kbd-help-head h3{margin:0;font-size:15px;font-family:'Press Start 2P',monospace}
.kbd-help-close{background:none;border:2px solid var(--c-border,#2a2a2a);cursor:pointer;width:28px;height:28px;font-size:16px;line-height:1;font-family:inherit}
.kbd-help-close:hover{background:var(--c-bg-2,#e0d6b1)}
.kbd-help-body{padding:12px 16px;display:flex;flex-direction:column;gap:6px}
.kbd-row{display:flex;align-items:center;gap:10px;font-family:'VT323',monospace;font-size:16px}
.kbd-row kbd{font-family:'Press Start 2P',monospace;font-size:10px;padding:4px 8px;background:var(--c-bg-2,#e0d6b1);border:2px solid var(--c-border,#2a2a2a);box-shadow:2px 2px 0 var(--c-border,#2a2a2a);min-width:24px;text-align:center}
.kbd-help-foot{padding:8px 16px;border-top:1px dashed var(--c-stone,#8b8579);color:var(--c-stone-dark,#5a5a6a);font-size:13px}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
`;
  document.head.appendChild(s);
})();

const SHORTCUTS = [
  { key: 'g', sel: '#contact',  descKey: 'kbd.contact' },
  { key: 'h', sel: '#home',     descKey: 'kbd.home' },
  { key: 'n', sel: '#notice',   descKey: 'kbd.notice' },
  { key: 'd', sel: '#data',     descKey: 'kbd.data' },
  { key: 's', sel: '#service',  descKey: 'kbd.service' },
  { key: 'b', sel: '#scenery',  descKey: 'kbd.scenery' },
  { key: '?', desc: '__help__', descKey: 'kbd.help' },
];

function isInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function isHelpOpen() {
  return !!document.getElementById('kbdHelpModal');
}

function closeHelp() {
  const el = document.getElementById('kbdHelpModal');
  if (el) el.remove();
}

function showHelp() {
  closeHelp();
  const rows = SHORTCUTS.map(s => {
    const label = t(s.descKey);
    if (s.sel === '__help__') {
      return `<div class="kbd-row"><kbd>Shift</kbd>+<kbd>/</kbd> <span>${label}</span></div>`;
    }
    return `<div class="kbd-row"><kbd>${s.key.toUpperCase()}</kbd> <span>${label}</span></div>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'kbdHelpModal';
  modal.className = 'kbd-help-backdrop';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="kbd-help-modal">
      <div class="kbd-help-head">
        <h3>⌨️ ${t('kbd.title', '键盘快捷键')}</h3>
        <button class="kbd-help-close" id="kbdHelpClose" aria-label="${t('common.close', '关闭')}">✕</button>
      </div>
      <div class="kbd-help-body">${rows}</div>
      <div class="kbd-help-foot">
        <small>${t('kbd.tip', '在输入框/留言框中按键时, 快捷键不会触发。')}</small>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeHelp(); });
  modal.querySelector('#kbdHelpClose').onclick = closeHelp;
}

function gotoSel(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // 给焦点 (a11y + 让屏幕阅读器知道跳到哪)
  if (el.tabIndex < 0) el.tabIndex = -1;
  try { el.focus({ preventScroll: true }); } catch (e) { /* 旧浏览器 */ }
}

export function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (isInputFocused()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // ? 键在多数键盘是 Shift+/, 统一处理两种
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      if (isHelpOpen()) closeHelp(); else showHelp();
      return;
    }
    // Escape 关闭帮助 / 任何 modal
    if (e.key === 'Escape') {
      if (isHelpOpen()) { e.preventDefault(); closeHelp(); return; }
      // 兼容项目里的 modal (没统一 class, 用 [id$="Backdrop"] 兜底)
      const bd = document.querySelectorAll('.modal-backdrop, [id$="Backdrop"]');
      bd.forEach(el => el.remove());
      return;
    }
    if (e.shiftKey) return; // 其它 shift 组合不接
    const k = e.key.toLowerCase();
    const sc = SHORTCUTS.find(s => s.key === k);
    if (sc && sc.sel !== '__help__') {
      e.preventDefault();
      gotoSel(sc.sel);
    }
  });
  // 切语言时如果帮助开着, 刷新帮助文字
  window.addEventListener('lc:langchange', () => { if (isHelpOpen()) showHelp(); });
}
