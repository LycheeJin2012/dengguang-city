/**
 * /api/admin/bookings —— 客栈预订的审核（通过 / 驳回 + 审核留痕）。
 *
 * 走 submissions.js 的审核流程，这里只提供资源名。
 * 玩家侧的提交入口是 /api/bookings。
 */
import { adminSubmissions } from '../../_core/submissions.js';

export const onRequest = adminSubmissions('bookings');
