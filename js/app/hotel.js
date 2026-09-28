/**
 * Hotel page workspace — backward-compatible forwarder.
 *
 * v79-2 起 hotel.js 拆分到 js/app/pages/hotel/：
 *   - pages/hotel/index.js    路由 + render
 *   - pages/hotel/booking.js  book() 预订弹窗
 *   - pages/hotel/rooms.js    roomCards() 房型卡列表
 *
 * v84：entry.js 与 pages/home/ 已改为直连 pages/hotel/* 真实模块，本文件
 * 只作为对外兼容层保留，且每个符号直接来自其真实出处，避免同一模块存在
 * 两条加载路径（间接再导出会让调试栈出现无意义的中转帧）。
 */

export { render } from './pages/hotel/index.js';
export { book } from './pages/hotel/booking.js';
export { roomCards } from './pages/hotel/rooms.js';
