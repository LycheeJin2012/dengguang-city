/**
 * /api/bookings —— 玩家提交客栈预订。
 *
 * 逻辑在 _core/submissions.js 的 submissions()：写库的同时双写一张工单，
 * 让后台在同一个待办里看到，不必再单独对一次账。
 * 管理端是 /api/admin/bookings。
 */
import { submissions } from '../_core/submissions.js';

export const onRequest = submissions('bookings');
