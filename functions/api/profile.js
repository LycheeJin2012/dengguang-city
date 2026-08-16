// 路由：
//   GET    /api/profile/me                          - 玩家自己的信息
//   PATCH  /api/profile/me                          - 改 bio/avatar
//   GET    /api/profile?u=<username>                - 某玩家公开信息 + ta 的留言
//   GET    /api/profile/anything                    - 同上，备用路径
import { ok, err, stripHtml, isNonEmpty, readToken, getSession } from '../_shared.js';

async function getMePlayer(context) {
  const { env, request } = context;
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return null;
  const me = await env.DB.prepare(
    'SELECT id, username, email, game_id, status, bio, avatar_emoji, created_at FROM players WHERE id = ?'
  ).bind(sess.player_id).first();
  return { session: sess, player: me };
}

async function getProfileByUsername(env, username) {
  const p = await env.DB.prepare(
    'SELECT id, username, email, game_id, status, bio, avatar_emoji, created_at FROM players WHERE username = ?'
  ).bind(username).first();
  if (!p) return null;
  if (p.status === 'rejected') return null;
  const msgs = await env.DB.prepare(
    `SELECT id, name, content, status, admin_reply, created_at
     FROM messages WHERE player_id = ? AND status IN ('new','read','done')
     ORDER BY created_at DESC LIMIT 30`
  ).bind(p.id).all();
  return {
    public_player: {
      id: p.id, username: p.username, game_id: p.game_id,
      bio: p.bio, avatar_emoji: p.avatar_emoji, status: p.status, created_at: p.created_at
    },
    messages: msgs.results,
    stats: { messages: msgs.results.length, replied: msgs.results.filter(m => m.admin_reply).length }
  };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);

  // /api/profile/me
  if (url.pathname === '/api/profile/me') {
    const me = await getMePlayer(context);
    if (!me || !me.player) return err(401, '请先登录玩家账号');
    return ok({ me: { id: me.player.id, username: me.player.username, email: me.player.email, bio: me.player.bio, avatar_emoji: me.player.avatar_emoji, game_id: me.player.game_id } });
  }

  // /api/profile?u=username
  let username = url.searchParams.get('u') || '';
  if (!username) {
    // /api/profile/<username> 备用路径（兼容性）
    const m = url.pathname.match(/^\/api\/profile\/(.+)$/);
    if (m) username = decodeURIComponent(m[1]).trim();
  }
  if (!username) return err(400, '请提供 username（?u=xxx 或 /api/profile/xxx）');

  const data = await getProfileByUsername(env, username);
  if (!data) return err(404, '玩家不存在');
  return ok(data);
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  if (url.pathname !== '/api/profile/me') return err(404, '未知路径');

  const me = await getMePlayer(context);
  if (!me || !me.player) return err(401, '请先登录玩家账号');

  let body = {};
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }

  const updates = []; const values = [];
  if (typeof body.bio === 'string') {
    const cleaned = stripHtml(body.bio).trim();
    if (cleaned.length > 200) return err(400, '签名最多 200 字符');
    updates.push('bio = ?'); values.push(cleaned || null);
  }
  if (typeof body.avatar_emoji === 'string') {
    const e = body.avatar_emoji.trim();
    if (e.length > 8) return err(400, 'emoji 太长');
    updates.push('avatar_emoji = ?'); values.push(e || '👤');
  }
  if (updates.length === 0) return err(400, '无可更新字段');
  values.push(me.player.id);
  await env.DB.prepare(`UPDATE players SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return ok({ id: me.player.id });
}
// cache-bust 1786920422
