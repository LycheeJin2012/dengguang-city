/**
 * 客栈页工作区 —— 兼容转发层。
 *
 * v79-2 起 hotel.js 拆到 js/app/pages/hotel/ 下：
 *   pages/hotel/index.js    路由与 render
 *   pages/hotel/booking.js  book() 预订弹窗
 *   pages/hotel/rooms.js    roomCards() 房型卡列表
 *
 * v84：entry.js 与 pages/home/ 已改成直接 import 上面这些真实模块，
 * 本文件只为兼容旧路径而留着。
 *
 * ⚠️ 转发时一律**直接从真实出处**再导出，不要经由别的中转文件 ——
 *    同一个模块出现两条加载路径时，调试栈里会多出一段没有信息量的中转帧。
 */

export { render } from './pages/hotel/index.js';
export { book } from './pages/hotel/booking.js';
export { roomCards } from './pages/hotel/rooms.js';
