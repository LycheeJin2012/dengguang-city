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
  'common.loading':    { 'zh-CN': '载入中…',     'en': 'Loading…' },
  'common.back':       { 'zh-CN': '← 返回',       'en': '← Back' },
  // hotel 页
  'hotel.status':   { 'zh-CN': '状态：',       'en': 'Status:' },
  'hotel.guests':   { 'zh-CN': '入住人数：',   'en': 'Guests:' },
  'hotel.view':     { 'zh-CN': '景观：',       'en': 'View:' },
  'hotel.filter.reset': { 'zh-CN': '重置筛选',  'en': 'Reset' },
  'hotel.filter.all':   { 'zh-CN': '全部',      'en': 'All' },
  'hotel.filter.open':  { 'zh-CN': '开放',      'en': 'Open' },
  'hotel.filter.draft': { 'zh-CN': '草拟',      'en': 'Draft' },
  'hotel.filter.building': { 'zh-CN': '筹建',   'en': 'Building' },
  'hotel.filter.planned':  { 'zh-CN': '拟建',   'en': 'Planned' },
  'hotel.modal.detail': { 'zh-CN': '房型详情',  'en': 'Room Detail' },
  'hotel.modal.book':   { 'zh-CN': '预订房间',  'en': 'Book Room' },
  'hotel.count':        { 'zh-CN': '共 ${n} 间 / 总 ${total} 间', 'en': '${n} / ${total} rooms' },
  'hotel.empty':        { 'zh-CN': '酒店正在筹建中, 上线后会在这里显示。', 'en': 'Hotel under construction. Will be available soon.' },
  // profile 页
  'profile.passkey.head':  { 'zh-CN': '🔑 账号安全 · 通行密钥 (Passkey)',  'en': '🔑 Account Security · Passkey' },
  'profile.race.head':     { 'zh-CN': '🏁 赛道成绩',                       'en': '🏁 Race Records' },
  'profile.exam.head':     { 'zh-CN': '📝 驾照模拟题库',                   'en': '📝 License Practice' },
  'profile.sub.head':      { 'zh-CN': '🔔 通知订阅',                       'en': '🔔 Notification Subscriptions' },
  'profile.citizen.head':  { 'zh-CN': '🪪 我的市民身份卡',                 'en': '🪪 My Citizen Card' },
  // dm 页
  'dm.verifyLogin':    { 'zh-CN': '正在验证登录态…',     'en': 'Verifying login…' },
  'dm.newBtn':         { 'zh-CN': '+ 写新私信',         'en': '+ New DM' },
  'dm.loading':        { 'zh-CN': '载入中…',             'en': 'Loading…' },
  'dm.empty.title':    { 'zh-CN': '还没有私信',         'en': 'No messages yet' },
  'dm.empty.hint':     { 'zh-CN': '点右上角"写新私信"开始', 'en': 'Click "+ New DM" to start' },
  'dm.empty.thread':   { 'zh-CN': '← 选择左侧会话查看<br>或点击右上"写新私信"', 'en': '← Pick a thread on the left<br>or click "+ New DM"' },
  'dm.empty.loadFail': { 'zh-CN': '载入失败',            'en': 'Load failed' },
  'dm.empty.noMsgs':   { 'zh-CN': '还没有消息，发起对话吧！', 'en': 'No messages yet. Start a conversation!' },
  'dm.slow':           { 'zh-CN': '网络好像有点慢',     'en': 'Network seems slow' },
  'dm.needLogin':      { 'zh-CN': '请先登录玩家账号',   'en': 'Please log in to a player account' },
  // admin-v37 tab 标签
  'admin.tab.tickets':      { 'zh-CN': '工单中心',         'en': 'Tickets' },
  'admin.tab.players':      { 'zh-CN': '玩家管理',         'en': 'Players' },
  'admin.tab.kart':         { 'zh-CN': '赛道 / 国际试车',  'en': 'Kart / Circuit' },
  'admin.tab.announcements': { 'zh-CN': '公告管理',         'en': 'Announcements' },
  'admin.tab.gallery':      { 'zh-CN': '首页图集',         'en': 'Gallery' },
  'admin.tab.dms':          { 'zh-CN': '私信监管',         'en': 'DM Monitor' },
  'admin.tab.admins':       { 'zh-CN': '管理员账号',       'en': 'Admins' },
  'admin.tab.password':     { 'zh-CN': '修改我的密码',     'en': 'Change Password' },
  // 页面 title
  'page.title.home':    { 'zh-CN': '灯光市人民政府 | Light City Hall of MC', 'en': 'Light City Hall | MC Government' },
  'page.title.hotel':   { 'zh-CN': '树上酒店 · 预订 | 灯光市人民政府',         'en': 'Treehouse Hotel | Light City Hall' },
  'page.title.profile': { 'zh-CN': '玩家主页 · 灯光市',                       'en': 'Player Profile | Light City' },
  'page.title.dm':      { 'zh-CN': '私信 · 灯光市',                           'en': 'DM | Light City' },
  'page.title.admin':   { 'zh-CN': '管理后台 | 灯光市人民政府',                 'en': 'Admin Panel | Light City Hall' },
  // 表单 placeholder
  'ph.gameId':         { 'zh-CN': '你的游戏 ID',         'en': 'Your game ID' },
  'ph.gameIdShort':    { 'zh-CN': '你的游戏ID',         'en': 'Game ID' },
  'ph.contact':         { 'zh-CN': '邮箱 / 游戏内编号',   'en': 'Email / In-game ID' },
  'ph.contactShort':    { 'zh-CN': '邮箱或游戏内编号',   'en': 'Email or In-game ID' },
  'ph.adminUser':       { 'zh-CN': '管理员账号',         'en': 'Admin Username' },
  'ph.message':         { 'zh-CN': '请输入你的留言...',   'en': 'Type your message...' },
  'ph.note':            { 'zh-CN': '是否需要教学、组队信息等', 'en': 'Need teaching or team info?' },
  'ph.noteSpecial':     { 'zh-CN': '特殊要求、纪念日等',  'en': 'Special requests, anniversaries, etc.' },
  'ph.carNo':           { 'zh-CN': '留空随机分配',       'en': 'Empty for random' },
  'ph.ticketSearch':    { 'zh-CN': '🔍 搜索标题/内容',   'en': '🔍 Search title/content' },
  // meta description (SEO)
  'page.meta.home':    { 'zh-CN': '灯光市人民政府官方网站 - 由市民共建的像素城市，提供政务公告、城市数据与市民服务。',
                         'en': 'Light City Hall - A pixel city built by citizens, offering government notices, city data, and public services.' },
  'page.meta.hotel':   { 'zh-CN': '灯光市树上酒店 - 房型浏览、状态筛选、预订。',
                         'en': 'Light City Treehouse Hotel - Room browsing, status filters, and booking.' },
  'page.meta.profile': { 'zh-CN': '灯光市玩家主页 - 我的留言、报名、订阅、通知。',
                         'en': 'Light City Player Profile - My messages, signups, subscriptions, and notifications.' },
  'page.meta.dm':      { 'zh-CN': '灯光市私信 - AI 灯灯客服 / 玩家私信。',
                         'en': 'Light City DM - AI assistant DengDeng & player direct messages.' },
  'page.meta.admin':   { 'zh-CN': '灯光市管理后台 - 工单 / 玩家 / 赛车场 / 公告 / 图集 / 私信监管。',
                         'en': 'Light City Admin Panel - Tickets / players / kart / announcements / gallery / DM monitor.' },
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

// 格式化翻译 (支持 {var} 占位符)
// 用法: tf('hotel.count', {n: 3, total: 3})
export function tf(key, vars) {
  let s = t(key);
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp('\\$\\{' + k + '\\}', 'g'), String(vars[k]));
    }
  }
  return s;
}

// 翻译并设置 document.title (页面 title 标签)
// 用法: setPageTitle('page.title.home') 或 '灯光市人民政府 | Light City Hall of MC' (传 zh 直接)
export function setPageTitle(keyOrZh, en) {
  if (!keyOrZh) return;
  if (_current === 'en' && en) {
    document.title = en;
  } else if (keyOrZh.includes('.') && DICT[keyOrZh]) {
    document.title = t(keyOrZh);
  } else {
    document.title = keyOrZh;
  }
  // 订阅 langchange 自动重设
  window.addEventListener('lc:langchange', () => {
    if (en && _current === 'en') document.title = en;
    else if (keyOrZh.includes('.') && DICT[keyOrZh]) document.title = t(keyOrZh);
    else document.title = keyOrZh;
  }, { once: false });
}

// 翻译并设置 <meta name="description"> 标签
// 用法: setMetaDescription('page.meta.home') 或 '灯光市...' (直接传中文)
export function setMetaDescription(keyOrZh, en) {
  if (!keyOrZh) return;
  const el = document.querySelector('meta[name="description"]');
  if (!el) return;
  const apply = () => {
    if (_current === 'en' && en) el.setAttribute('content', en);
    else if (keyOrZh.includes('.') && DICT[keyOrZh]) el.setAttribute('content', t(keyOrZh));
    else el.setAttribute('content', keyOrZh);
  };
  apply();
  window.addEventListener('lc:langchange', apply, { once: false });
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
