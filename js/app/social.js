/**
 * 消息页工作区 —— 兼容转发层。
 *
 * v79-3 起 social.js 拆到 js/app/pages/messages/ 下：
 *   pages/messages/index.js          render 与 tab 切换
 *   pages/messages/notifications.js  通知列表（按类别过滤 / 单条已读 / 全部已读）
 *
 * 私信（含与灯灯的对话）没有单独文件，继续走 chat-page.js 的 renderChat()。
 *
 * 本文件只为兼容旧路径而留着：entry.js 的 `import('./social.js')` 和外部的
 * `import { render } from './social.js'` 都还要能用。
 */

export { render } from './pages/messages/index.js';
