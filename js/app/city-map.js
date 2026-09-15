/**
 * Map page workspace — backward-compatible forwarder.
 *
 * v79-5 起，city-map.js 拆分到 js/app/pages/map/。
 * 公共视图走 render()，管理视图走 renderMapAdmin()。
 * 本文件保留为转发层，让 entry.js 的 `import('./city-map.js')` 路径不变。
 */

export { render, renderMapAdmin } from './pages/map/index.js';