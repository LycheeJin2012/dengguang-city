import { endpoint, identity, reply } from '../../_core/request.js';

/**
 * 客服回复的差评列表（只读）。
 *
 * 面向玩家，所以 JOIN players 是 INNER —— 反馈必须挂在一个真实存在的玩家上。
 * 排序按 updated_at 再按 id：同一次批量修改会让多行 updated_at 相同，
 * 只按时间排会导致翻页时顺序漂移、重名记录反复出现。
 */
export const onRequestGet = (context) =>
  endpoint(async () => {
    await identity(context, 'super');

    const rows = await context.env.DB.prepare(
      "SELECT f.*,p.username FROM reply_feedback f JOIN players p ON p.id=f.player_id ORDER BY f.updated_at DESC,f.id DESC LIMIT 200"
    ).all();

    return reply({ feedback: rows.results });
  });
