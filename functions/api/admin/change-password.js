/**
 * POST /api/admin/change-password —— 管理员改**自己**的密码。
 *
 * 改别人走 /api/admin/admins。这里不接受任何目标用户参数，
 * 目标一律取当前会话。
 */
import { changePassword } from '../../_core/accounts.js';
import { endpoint } from '../../_core/request.js';

export const onRequestPost = (c) => endpoint(() => changePassword(c, 'admin'));
