// v50-N5 基础设施: i18n (中英双语) 核心模块
// 架构: 三层 — 词典(dictionaries) / 当前语言(currentLang) / 翻译器(translate)
// 策略: localStorage 持久化, 缺省 zh-CN, document.documentElement.lang 同步
//
// 使用方式 (后续 commit 扩展):
//   1. HTML 加 data-i18n="key.path"  (例: <h1 data-i18n="hero.title">)
//   2. JS 调 t('key.path') 取值 (例: t('hero.cta') → '查看公告')
//   3. 切换语言: setLang('en'), 自动重新应用所有 data-i18n
//
// 现状 (N5 Step 1): 仅基础设施 + 主页 nav 翻译. 全站 5+ commit 扩展在后续.

const STORAGE_KEY = 'lc_lang';
const SUPPORTED = ['zh-CN', 'en'];

const DICT = {
  // ===== 主页 nav (最常用, 优先翻) =====
  'nav.home':       { 'zh-CN': '首页',         'en': 'Home' },
  'nav.notice':     { 'zh-CN': '公告',         'en': 'Notice' },
  'nav.data':       { 'zh-CN': '城市数据',     'en': 'Data' },
  'nav.scenery':    { 'zh-CN': '城市风貌',     'en': 'Scenery' },
  'nav.gallery':    { 'zh-CN': '实景图集',     'en': 'Gallery' },
  'nav.wall':       { 'zh-CN': '市民留言墙',   'en': 'Wall' },
  'nav.kart':       { 'zh-CN': '🛞 卡丁车',    'en': '🛞 Kart' },
  'nav.circuit':    { 'zh-CN': '🏎️ 国际赛车场', 'en': '🏎️ Circuit' },
  'nav.hotel':      { 'zh-CN': '树上酒店',     'en': 'Hotel' },
  'nav.service':    { 'zh-CN': '市民服务',     'en': 'Service' },
  'nav.contact':    { 'zh-CN': '联系我们',     'en': 'Contact' },
  'nav.toggle':     { 'zh-CN': '🌐 中文/EN',  'en': '🌐 EN/中' },
  // 通用
  'common.returnHome': { 'zh-CN': '← 返回首页',  'en': '← Home' },
};

let _current = (function () {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch (e) { /* localStorage 不可用 */ }
  return SUPPORTED[0];
})();

export function getLang() { return _current; }
export function getSupported() { return SUPPORTED.slice(); }

// 切换语言 (立即同步到 DOM + localStorage)
export function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return false;
  if (lang === _current) return true;
  _current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  document.documentElement.lang = lang;
  applyToDOM();
  // 触发自定义事件, 让其他模块 (主题/通知) 知道语言变了
  window.dispatchEvent(new CustomEvent('lc:langchange', { detail: { lang } }));
  return true;
}

// 单 key 翻译
export function t(key, fallback) {
  const entry = DICT[key];
  if (!entry) return fallback !== undefined ? fallback : key;
  return entry[_current] || entry[SUPPORTED[0]] || fallback || key;
}

// 批量翻译 (用于渲染列表)
export function tAll(key) {
  const entry = DICT[key];
  return entry || null;
}

// 扫描 DOM 自动应用 data-i18n
function applyToDOM() {
  const els = document.querySelectorAll('[data-i18n]');
  els.forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key, el.textContent);
  });
  // title 属性也支持
  const titleEls = document.querySelectorAll('[data-i18n-title]');
  titleEls.forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key, el.title);
  });
  // placeholder 属性也支持
  const phEls = document.querySelectorAll('[data-i18n-placeholder]');
  phEls.forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key, el.placeholder);
  });
}

// 初始化 (DOMContentLoaded 时由调用方触发, 也可手动)
export function initI18n() {
  document.documentElement.lang = _current;
  // 等 DOM 完后再 apply
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyToDOM);
  } else {
    applyToDOM();
  }
}

// 渲染语言切换按钮 (返回 HTML 字符串, 调用方决定位置)
export function renderLangSwitcher() {
  const other = _current === 'zh-CN' ? 'en' : 'zh-CN';
  return `<button type="button" class="nav-lang-switch" id="navLangSwitch" title="切换语言 / Switch language" data-i18n="nav.toggle">${t('nav.toggle')}</button>`;
}

// 绑定切换按钮事件 (页面加载后调一次)
export function bindLangSwitcher(root = document) {
  const btn = root.querySelector('#navLangSwitch');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const other = _current === 'zh-CN' ? 'en' : 'zh-CN';
    setLang(other);
  });
}
