/**
 * 工单表单模块的稳定入口（转发层）。
 *
 * 原来 createTicket / viewCitizenTicket / ticketTimeline 三个东西挤在这一个
 * 文件里，最长一行 2200 多字符。现在按职责拆到 features/tickets/ 下：
 *   timeline.js  时间线渲染、回复署名（后台工单页也在用）
 *   create.js    递交工单弹窗、管理员编号名录
 *   view.js      市民侧工单详情弹窗
 *
 * 这个文件只做再导出，**不要在这里加逻辑**。历史 import 路径有五处
 * （features/chat/support.js、features/ticket-center/index.js、
 * pages/profile/index.js、pages/affairs/index.js、admin/tabs/tickets.js）
 * 都指着这里，export 的名字和签名一个字都不能动。
 */

export { replyAuthor, ticketTimeline } from './features/tickets/timeline.js';
export { showAdminDirectory, createTicket } from './features/tickets/create.js';
export { viewCitizenTicket } from './features/tickets/view.js';
