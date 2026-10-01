import { endpoint, identity, reply } from '../_core/request.js';
import { getOrCreateAiBot } from '../_shared/ai.js';

/**
 * GET /api/ai-bot —— 返回灯灯客服账号的 username。
 *
 * 三步，顺序不能换：
 *
 *   1. identity(c) 先鉴权。这是项目的硬约束：所有路由都必须先确认身份再碰数据，
 *      反过来等于「先把未授权的数据读出来再判断能不能给」。
 *      这里的角色是默认的 'player'，所以会话必须带 player_id。
 *   2. getOrCreateAiBot 取灯灯这个 system 玩家，没有就建一个。
 *      它内部会对查到的行做三项核对（game_id / email / status），
 *      任一不符说明这条记录被人改过或删了，直接 503 停用而不是继续用。
 *   3. reply 只回 username，不回整个 player 行 —— 那行里带 email、salt 等字段，
 *      没有理由出站。
 *
 * endpoint() 负责把身份失败翻成 401/403、把撞 UNIQUE 翻成 409、
 * 其余异常兜底成 500，都不把内部细节漏给前端。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    await identity(c);
    const bot = await getOrCreateAiBot(c.env);
    return reply({ username: bot.username });
  });
