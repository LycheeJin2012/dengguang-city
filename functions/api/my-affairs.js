/**
 * GET /api/my-affairs —— 「我的事务」聚合。
 *
 * 把散落在各处、且属于当前玩家自己的记录收成一份返回
 * （工单、各类提交与审核结果等），省得前端为每类单独发一次请求。
 * 聚合逻辑在 _core/my-affairs.js，这里只负责取身份再转发。
 */
import { endpoint, identity, reply } from '../_core/request.js';
import { myAffairs } from '../_core/my-affairs.js';

export const onRequestGet = (c) =>
  endpoint(async () => {
    const p = await identity(c);
    return reply(await myAffairs(c.env.DB, p.id));
  });
