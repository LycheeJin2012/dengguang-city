/**
 * /api/license —— 玩家提交驾照考试报名。
 *
 * 写库 + 双写工单，逻辑在 _core/submissions.js。
 * 管理端是 /api/admin/license。
 */
import { submissions } from '../_core/submissions.js';

export const onRequest = submissions('license');
