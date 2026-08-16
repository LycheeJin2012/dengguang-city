// POST /api/login - 玩家/管理员登录（统一入口）
// DELETE /api/login - 登出
import { ok, err, verifyPassword, createSession, destroySession, readToken, isNonEmpty, getSession } from '../_shared.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return err(400, 'Invalid JSON body');
  }

  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!isNonEmpty(username, 64) || !isNonEmpty(password, 128)) {
    return err(400, '用户名/密码必填');
  }

  // 先试玩家
  const player = await env.DB.prepare(
    'SELECT id, username, password_hash, salt FROM players WHERE username = ?'
  ).bind(username).first();

  let role = 'player';
  let userId = null;
  if (player) {
    const ok = await verifyPassword(password, player.password_hash, player.salt);
    if (!ok) return err(401, '用户名或密码错误');
    userId = player.id;
  } else {
    // 试 admin
    const admin = await env.DB.prepare(
      'SELECT id, username, password_hash, salt, role FROM admins WHERE username = ?'
    ).bind(username).first();
    if (!admin) return err(401, '用户名或密码错误');
    const ok = await verifyPassword(password, admin.password_hash, admin.salt);
    if (!ok) return err(401, '用户名或密码错误');
    role = admin.role;
    userId = admin.id;
  }

  const { token, expires_at } = await createSession(env, role === 'player' ? userId : null, role !== 'player' ? userId : null);

  // Set-Cookie 也写一份方便浏览器调用
  const cookie = `lc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${8*3600}`;
  return new Response(JSON.stringify({ ok: true, token, expires_at, role, user_id: userId }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': cookie
    }
  });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  if (token) await destroySession(env, token);
  return ok({ logged_out: true });
}

export async function onRequestGet(context) {
  // GET /api/login - 返回当前登录信息
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess) return err(401, 'Not logged in');
  if (sess.admin_id) {
    const admin = await env.DB.prepare('SELECT id, username, role FROM admins WHERE id = ?').bind(sess.admin_id).first();
    return ok({ role: admin.role, user: admin });
  }
  if (sess.player_id) {
    const player = await env.DB.prepare('SELECT id, username, email, game_id FROM players WHERE id = ?').bind(sess.player_id).first();
    return ok({ role: 'player', user: player });
  }
  return err(401, 'Session invalid');
}
