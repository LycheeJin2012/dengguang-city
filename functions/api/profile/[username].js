// GET /api/profile/[username] - 玩家个人主页（公开基本信息 + ta 发的留言）
// PATCH /api/profile/me - 玩家自己改 bio/avatar
import { ok, err, stripHtml, isNonEmpty, readToken, getSession } from '../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  const url = new URL(request.url);
  const username = decodeURIComponent(url.pathname.split('/').pop() || '').trim();
  if (!username) return err(400, '用户名必填');

  const player = await env.DB.prepare(
    'SELECT id, username, email, game_id, status, bio, avatar_emoji, created_at FROM players WHERE username = ?'
  ).bind(username).first();
  if (!player) return err(404, '玩家不存在');
  // 隐藏被拒玩家的 email
  if (player.status === 'rejected') {
    return err(404, '玩家不存在');
  }
  // 公开字段（不返回 email）
  const public_player = {
    id: player.id,
    username: player.username,
    game_id: player.game_id,
    bio: player.bio,
    avatar_emoji: player.avatar_emoji,
    status: player.status,
    created_at: player.created_at
  };

  // 列出 ta 发的所有留言（仅已激活玩家）
  const msgs = await env.DB.prepare(
    `SELECT id, name, content, status, admin_reply, created_at
     FROM messages
     WHERE player_id = ? AND status IN ('new', 'read', 'done')
     ORDER BY created_at DESC LIMIT 30`
  ).bind(player.id).all();

  // 统计
  const msgCount = msgs.results.length;
  const replyCount = msgs.results.filter(m => m.admin_reply).length;

  return ok({
    player: public_player,
    messages: msgs.results,
    stats: { messages: msgCount, replied: replyCount }
  });
}
