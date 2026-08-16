// 路由：/api/profile + /api/profile/me + /api/profile/<username>
import { ok, err, stripHtml, isNonEmpty, readToken, getSession } from '../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const sessPath = url.pathname; // 可能是 /api/profile 或 /api/profile/me 或 /api/profile/<user>

  // /api/profile/me 单独处理
  if (sessPath === '/api/profile/me' || sessPath === '/api/profile/me/') {
    const token = readToken(request);
    const sess = await getSession(env, token);
    if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');
    const me = await env.DB.prepare(
      'SELECT id, username, email, game_id, status, bio, avatar_emoji, created_at FROM players WHERE id = ?'
    ).bind(sess.player_id).first();
    return ok({ me });
  }

  // /api/profile?u=xxx  或 /api/profile/<user>
  let username = url.searchParams.get('u') || '';
  if (!username) {
    const m = sessPath.match(/^\/api\/profile\/(.+?)\/?$/);
    if (m) username = decodeURIComponent(m[1]).trim();
  }
  if (!username) return err(400, '请提供 username');

  const p = await env.DB.prepare(
    'SELECT id, username, email, game_id, status, bio, avatar_emoji, created_at FROM players WHERE username = ?'
  ).bind(username).first();
  if (!p || p.status === 'rejected') return err(404, '玩家不存在');
  const msgs = await env.DB.prepare(
    `SELECT id, name, content, status, admin_reply, created_at
     FROM messages WHERE player_id = ? AND status IN ('new','read','done')
     ORDER BY created_at DESC LIMIT 30`
  ).bind(p.id).all();
  return ok({
    player: { id: p.id, username: p.username, game_id: p.game_id, bio: p.bio, avatar_emoji: p.avatar_emoji, status: p.status, created_at: p.created_at },
    messages: msgs.results,
    stats: { messages: msgs.results.length, replied: msgs.results.filter(m => m.admin_reply).length }
  });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  if (url.pathname !== '/api/profile/me') return err(404, '未知路径');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');

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
  values.push(sess.player_id);
  await env.DB.prepare(`UPDATE players SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return ok({ id: sess.player_id });
}
