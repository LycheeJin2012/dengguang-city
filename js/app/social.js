/**
 * Messages page workspace — backward-compatible forwarder.
 *
 * v79-3 起，social.js 拆分到 js/app/pages/messages/：
 *   - pages/messages/index.js        render + tab 切换
 *   - pages/messages/notifications.js 通知列表（类别过滤 / 单条 / 全部已读）
 *
 * DM（私信与灯灯）继续走 renderChat()（chat-page.js），没单独文件。
 *
 * 本文件保留为转发层，让 entry.js 的 `import('./social.js')` 路径不变，
 * 外部 `import { render } from './social.js'` 也能继续工作。
 */

export { render } from './pages/messages/index.js';