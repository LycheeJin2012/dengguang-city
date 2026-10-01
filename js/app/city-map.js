/**
 * 地图页工作区 —— 兼容转发层。
 *
 * v79-5 起 city-map.js 拆到 js/app/pages/map/：
 *   render()        公共视图
 *   renderMapAdmin() 管理视图
 *
 * 本文件只为兼容旧路径而留着：entry.js 的 `import('./city-map.js')` 还要能用。
 */

export { render, renderMapAdmin } from './pages/map/index.js';
