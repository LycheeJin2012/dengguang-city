import { endpoint, identity, reply } from '../_core/request.js';

/**
 * 工单办结奖励流水。
 *
 * 只有绑定了的玩家才有奖励行，所以这里只按 player_id 查；
 * 排序用 created_at DESC，让最近一笔排在最前面。
 */
export const onRequestGet = (context) =>
  endpoint(async () => {
    const player = await identity(context);
    const rows = await context.env.DB
      .prepare(
        'SELECT ticket_ref,admin_id,amount,paid,paid_at,created_at FROM ticket_rewards WHERE player_id=? ORDER BY created_at DESC'
      )
      .bind(player.id)
      .all();

    return reply({ rewards: rows.results });
  });
