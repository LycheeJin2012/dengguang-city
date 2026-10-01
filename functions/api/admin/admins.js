/**
 * /api/admin/admins —— 管理员账号管理（增删改查、改密、角色调整）。
 *
 * 逻辑在 _core/accounts.js 的 adminAccounts()。
 */
import { adminAccounts } from '../../_core/accounts.js';

export const onRequest = adminAccounts;
