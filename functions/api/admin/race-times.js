import { endpoint, identity, reply } from '../../_core/request.js';

/**
 * 赛道计时记录列表（只读）。
 *
 * 玩家名和赛道名都可能已经被删，所以两个 JOIN 都是 LEFT JOIN ——
 * 用 INNER JOIN 会让「人没了的记录」整条从列表里消失，看起来像记录也没了。
 */
export const onRequestGet = (context) =>
  endpoint(async () => {
    await identity(context, 'admin');

    const rows = await context.env.DB.prepare(
      'SELECT r.*, p.username AS player_username,t.name AS track_name FROM race_times r LEFT JOIN players p ON p.id=r.player_id LEFT JOIN race_tracks t ON t.id=r.track_id ORDER BY r.recorded_at DESC LIMIT 200'
    ).all();

    return reply({ times: rows.results });
  });
