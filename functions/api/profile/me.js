// PATCH /api/profile/me - 玩家自己改 bio/avatar_emoji
import { ok, err, stripHtml, isNonEmpty, readToken, getSession } from '../_shared.js';

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');

  let body = {};
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }

  const updates = [];
  const values  = [];

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
