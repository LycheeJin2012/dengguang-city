/**
 * /api/admin/license —— 驾照**提交表**的审核。
 *
 * 走 submissions.js 的审核流程，这里只提供资源名。
 * 玩家侧的提交入口是 /api/license。
 */
import { adminSubmissions } from '../../_core/submissions.js';

export const onRequest = adminSubmissions('license');
