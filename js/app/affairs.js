/**
 * 事务页工作区 —— 兼容转发层。
 *
 * v79-5 起 affairs.js 拆到 js/app/pages/affairs/。
 * 本文件只为兼容旧路径而留着：entry.js 的 `import('./affairs.js')` 还要能用。
 */

export { render } from './pages/affairs/index.js';
