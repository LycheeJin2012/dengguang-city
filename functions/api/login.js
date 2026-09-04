// v50: 登录 / 登出 / 当前 session
// GET  /api/login         - 返回当前登录态
// POST /api/login         - 登录 (合并 admin/player)
// DELETE /api/login       - 登出
import { ok, err, handleOptions, hashPassword, verifyPassword, createSession, destroySession, getSession, readToken, cookieFor } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess) return err(401, 'Not logged in');

  let admin = null, player = null;
  if (sess.admin_id) {
    admin = await env.DB.prepare('SELECT id, username, role, linked_player_id FROM admins WHERE id = ?').bind(sess.admin_id).first();
  }
  if (sess.player_id) {
    player = await env.DB.prepare('SELECT id, username, email, game_id, status, avatar_emoji, bio, linked_admin_id, emeralds FROM players WHERE id = ?').bind(sess.player_id).first();
  }
  if (admin) return ok({ role: admin.role, user: admin, admin, player, combined: !!player });
  if (player) return ok({ role: 'player', user: player, admin, player, combined: !!admin });
  return err(401, 'Session invalid');
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const body = await request.json().catch(() => ({}));
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!username || !password) return err(400, 'username/password 必填');

  // 先试 player
  const player = await env.DB.prepare('SELECT * FROM players WHERE username = ? OR email = ?').bind(username, username).first();
  if (player && player.status !== 'rejected') {
    const ok2 = await verifyPassword(password, player.salt, player.password_hash);
    if (!ok2) return err(401, '密码错误');
    // 合并 (admin + player) 模式
    let admin = null;
    if (player.linked_admin_id) {
      admin = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(player.linked_admin_id).first();
    }
    const token = admin
      ? await createSession(env, { player_id: player.id, admin_id: admin.id, combined: true })
      : await createSession(env, { player_id: player.id });
    await env.DB.prepare("UPDATE players SET last_login_at = datetime('now') WHERE id = ?").bind(player.id).run();
    return new Response(JSON.stringify({ ok: true, user: player, player, admin, combined: !!admin, kind: admin ? 'combined' : 'player' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookieFor(token) },
    });
  }

  // 试 admin
  const admin = await env.DB.prepare('SELECT * FROM admins WHERE username = ?').bind(username).first();
  if (admin) {
    const ok2 = await verifyPassword(password, admin.salt, admin.password_hash);
    if (!ok2) return err(401, '密码错误');
    let player = null;
    if (admin.linked_player_id) {
      player = await env.DB.prepare('SELECT id, username, status, avatar_emoji FROM players WHERE id = ?').bind(admin.linked_player_id).first();
    }
    const token = player
      ? await createSession(env, { admin_id: admin.id, player_id: player.id, combined: true })
      : await createSession(env, { admin_id: admin.id });
    return new Response(JSON.stringify({ ok: true, user: admin, admin, player, combined: !!player, kind: player ? 'combined' : 'admin' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookieFor(token) },
    });
  }

  return err(401, '账号不存在或密码错误');
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  await destroySession(env, token);
  return new Response(JSON.stringify({ ok: true, logged_out: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': `lc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` },
  });
}
