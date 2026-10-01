/**
 * /api/circuit —— 玩家报名国际试车。
 *
 * 写库 + 双写工单，逻辑在 _core/submissions.js。
 * 管理端是 /api/admin/circuit。
 */
import { submissions } from '../_core/submissions.js';

export const onRequest = submissions('circuit');
