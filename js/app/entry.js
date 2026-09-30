/**
 * 应用入口：装错误边界 → 画外壳 → 认登录态 → 按页面路由 → 挂浮动助手。
 *
 * v84 起所有路由直连 pages/ 下的真实模块，不再经过 home.js / hotel.js /
 * social.js / admin.js 这些 v79 兼容转发层 —— 同一个模块存在两条加载路径时，
 * 改了一处另一处不生效，是很难查的一类问题。
 */

import './press-motion.js';
import { installErrorBoundary } from './error-boundary.js';
import { shell, session, renderAccount, toast, region, state } from './core.js';

// 错误边界必须装在所有业务逻辑之前：未捕获异常统一走 toast，而不是白屏。
installErrorBoundary();

/** data-page → 页面模块。三个别名（dm / notifications / messages）共用私信页。 */
const PAGES = {
  home: () => import('./pages/home/index.js'),
  hotel: () => import('./pages/hotel/index.js'),
  'hotel-owner': () => import('./pages/hotel-owner/index.js'),
  map: () => import('./pages/map/index.js'),
  affairs: () => import('./pages/affairs/index.js'),
  messages: () => import('./pages/messages/index.js'),
  dm: () => import('./pages/messages/index.js'),
  notifications: () => import('./pages/messages/index.js'),
  knowledge: () => import('./pages/knowledge/public.js'),
  profile: () => import('./pages/profile/index.js'),
  admin: () => import('./admin/index.js'),
};

shell();

// 登录态先起跑，不阻塞首页和酒店页的首屏（这两个页面对未登录也有内容可看）
const auth = session().then(renderAccount).catch(e => toast(e.message, true));
// 挂上去是为了让 requirePlayer() 能 await 到同一次请求，避免并发拉两遍
state.authPending = auth;

const page = document.body.dataset.page;

if (!['home', 'hotel'].includes(page)) await auth;

await region(
  document.querySelector('main'),
  () => PAGES[page](),
  async (m, el) => m.render(el, page)
);

// 浮动助手复用私信控制器，但它是独立 DOM 分支，所以放最后再挂
const { mountAssistantWindow } = await import('../ui/assistant-window.js');
mountAssistantWindow();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Back/forward cache must not restore stale elevated account UI.
// 浏览器前进/后退恢复 bfcache 时，页面里的登录态可能已经变了
// （比如刚才用管理员身份打开过页面），直接 reload 让状态重新来过。
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});
