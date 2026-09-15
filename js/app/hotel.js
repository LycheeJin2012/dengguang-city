/**
 * Hotel page workspace — backward-compatible forwarder.
 *
 * v79-2 起 hotel.js 拆分到 js/app/pages/hotel/：
 *   - pages/hotel/index.js    路由 + render
 *   - pages/hotel/booking.js  book() 预订弹窗
 *   - pages/hotel/rooms.js    roomCards() 房型卡列表
 *
 * 本文件保留为转发层，让 entry.js 的 `import('./hotel.js')` 路径不变，
 * 外部 `import { roomCards } from './hotel.js'` 也能继续工作。
 */

export { render, book, roomCards } from './pages/hotel/index.js';