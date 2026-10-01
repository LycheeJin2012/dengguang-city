/**
 * POST /api/actions/account —— 玩家自助操作（改资料 / 改密码 / 注销等）。
 *
 * 具体走哪一条，由 _core/accounts.js 的 accountAction() 按请求体里的字段分派。
 * 新增自助操作请改那边，不要在这里堆分支。
 */
import { accountAction } from '../../_core/accounts.js';

export const onRequestPost = accountAction;
