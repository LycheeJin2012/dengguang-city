/**
 * /api/admin/kart —— 卡丁车报名的审核。
 *
 * 走 submissions.js 的审核流程，这里只提供资源名。
 * 玩家侧的提交入口是 /api/kart。
 */
import { adminSubmissions } from '../../_core/submissions.js';

export const onRequest = adminSubmissions('kart');
