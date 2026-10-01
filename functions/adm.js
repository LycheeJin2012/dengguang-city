/**
 * /adm —— /admin 的短路径。
 *
 * 跳转逻辑在 admin.js，这里只做一层转发，让两个地址等价。
 */
export { onRequest } from './admin.js';
