import { endpoint, identity, body, reply, fail } from '../_core/request.js';
import { readToken } from '../_shared/session.js';

/**
 * 账号安全页：当前设备的登录会话 + 最近的登录记录。
 *
 * 会话只列没过期的（julianday 比较）—— 已失效的会话对玩家没有意义，
 * 还留着只会让人以为「有人在登录」。current 标记靠 token 相等来判断。
 */
export const onRequestGet = (context) =>
  endpoint(async () => {
    const player = await identity(context);
    const token = readToken(context.request);
    const db = context.env.DB;

    const sessions = (
      await db
        .prepare(
          "SELECT created_at,expires_at,device_label,CASE WHEN token=? THEN 1 ELSE 0 END AS current FROM sessions WHERE player_id=? AND julianday(expires_at)>julianday('now') ORDER BY created_at DESC LIMIT 100"
        )
        .bind(token, player.id)
        .all()
    ).results;

    const history = (
      await db
        .prepare('SELECT id,method,device_label,created_at FROM login_history WHERE player_id=? ORDER BY id DESC LIMIT 50')
        .bind(player.id)
        .all()
    ).results;

    return reply({ sessions, history });
  });

/** 唯一支持的写操作：把除当前设备外的所有会话踢下线 */
export const onRequestPost = (context) =>
  endpoint(async () => {
    const player = await identity(context);
    const input = await body(context.request);
    if (input.action !== 'revoke-others') fail(400, '操作无效');

    // token!=? 保证不会把自己踢掉
    const result = await context.env.DB
      .prepare('DELETE FROM sessions WHERE player_id=? AND token!=?')
      .bind(player.id, readToken(context.request))
      .run();

    return reply({ revoked: result.meta.changes });
  });
