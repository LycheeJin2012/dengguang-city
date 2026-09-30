/**
 * 附件模块的稳定入口（转发层）。
 *
 * 原来上传、选择器、陈列三段逻辑全挤在这一个文件里，最长一行 900 多字符。
 * 现在按职责拆到 features/attachments/ 下：
 *   upload.js   分片上传 / 断点续传 / 重试（只管协议，不碰 DOM）
 *   picker.js   拖拽、点选、粘贴三种入口 + 逐个文件的上传状态
 *   gallery.js  只读的附件陈列区
 *
 * 这个文件只做再导出，**不要在这里加逻辑**。历史 import 路径有三处
 * （admin/shared.js、admin/tabs/tickets.js、pages/hotel-owner/index.js）
 * 都指着这里，改名或搬走会让它们一起断。
 */

export { sizeLabel, uploadFile } from './features/attachments/upload.js';
export { attachmentPicker } from './features/attachments/picker.js';
export { renderAttachments } from './features/attachments/gallery.js';
