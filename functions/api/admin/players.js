/**
 * /api/admin/players —— 玩家账号的审核与管理。
 *
 * 逻辑在 _core/accounts.js 的 players()：审核、封禁、改资料。
 */
import { players } from '../../_core/accounts.js';

export const onRequest = players;
