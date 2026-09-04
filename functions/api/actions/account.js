// v50: 玩家账号操作 (修改密码 / 修改资料)
import { ok, err, hashPassword, verifyPassword, getSession, readToken, stripHtml, isNonEmpty, isEmail, isUsername } from '../_helpers.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');

  if (action === 'change-password') {
    const body = await request.json().catch(() => ({}));
    const oldPw = body.old_password || '';
    const newPw = body.new_password || '';
    if (!isNonEmpty(newPw, 6) || newPw.length < 6) return err(400, '新密码至少 6 位');
    const player = await env.DB.prepare('SELECT password_hash, salt FROM players WHERE id = ?').bind(sess.player_id).first();
    if (!player) return err(404, '玩家不存在');
    const ok2 = await verifyPassword(oldPw, player.salt, player.password_hash);
    if (!ok2) return err(401, '旧密码错');
    const { hash, salt } = await hashPassword(newPw);
    await env.DB.prepare('UPDATE players SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, sess.player_id).run();
    return ok({ changed: true });
  }

  if (action === 'update-profile') {
    const body = await request.json().catch(() => ({}));
    const sets = []; const binds = [];
    if (body.bio !== undefined) { sets.push('bio = ?'); binds.push(stripHtml(body.bio).slice(0, 500)); }
    if (body.avatar_emoji !== undefined) { sets.push('avatar_emoji = ?'); binds.push(stripHtml(body.avatar_emoji).slice(0, 8)); }
    if (body.email && isEmail(body.email)) { sets.push('email = ?'); binds.push(body.email); }
    if (body.game_id) { sets.push('game_id = ?'); binds.push(stripHtml(body.game_id).slice(0, 50)); }
    if (!sets.length) return err(400, '没有可更新字段');
    binds.push(sess.player_id);
    await env.DB.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return ok({ updated: true });
  }

  return err(400, '未知 action');
}
