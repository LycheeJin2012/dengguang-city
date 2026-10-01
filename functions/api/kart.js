/**
 * /api/kart —— 玩家报名卡丁车。
 *
 * 写库 + 双写工单，逻辑在 _core/submissions.js。
 * 管理端是 /api/admin/kart。
 */
import { submissions } from '../_core/submissions.js';

export const onRequest = submissions('kart');
