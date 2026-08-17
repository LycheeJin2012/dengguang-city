// POST /api/login - 玩家/管理员登录（统一入口）
// DELETE /api/login - 登出
import { ok, err, verifyPassword, createSession, destroySession, readToken, isNonEmpty, getSession } from '../_shared.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  // 支持 JSON (fetch) 和 form-urlencoded (浏览器原生 form POST)
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  let body = {};
  try {
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const form = await request.formData();
      body = Object.fromEntries(form.entries());
    } else if (ct.includes('application/json')) {
      body = await request.json();
    } else {
      // 兜底：尝试 text 再 URL-decode
      const txt = await request.text();
      if (txt) {
        try { body = JSON.parse(txt); }
        catch { body = Object.fromEntries(new URLSearchParams(txt).entries()); }
      }
    }
  } catch (e) {
    return err(400, 'Invalid body: ' + (e.message || e));
  }

  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!isNonEmpty(username, 64) || !isNonEmpty(password, 128)) {
    return err(400, '用户名/密码必填');
  }

  // 先试玩家
  const player = await env.DB.prepare(
    'SELECT id, username, password_hash, salt, status FROM players WHERE username = ?'
  ).bind(username).first();

  let role = 'player';
  let userId = null;
  if (player) {
    const ok = await verifyPassword(password, player.password_hash, player.salt);
    if (!ok) return err(401, '用户名或密码错误');
    // v16: 检查账号状态
    if (player.status === 'pending') {
      return err(403, '注册申请审批中，请等市政厅通过');
    }
    if (player.status === 'rejected') {
      return err(403, '注册申请未通过');
    }
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

  // 如果是浏览器原生 form 提交（无 fetch），用 302 重定向回原页面，避免 in-app browser 不触发 JS
  const accept = request.headers.get('Accept') || '';
  const isFormPost = accept.includes('text/html');
  if (isFormPost) {
    let back = '/admin';
    try {
      const referer = request.headers.get('Referer') || '';
      if (referer) {
        const u = new URL(referer);
        if (!u.pathname.startsWith('/admin')) back = '/';
      }
    } catch (e) { /* ignore */ }
    return new Response(null, {
      status: 302,
      headers: { 'Set-Cookie': cookie, 'Location': back }
    });
  }
  // JSON 调用走到这里就正常返回


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
    const player = await env.DB.prepare('SELECT id, username, email, game_id, status, avatar_emoji, bio FROM players WHERE id = ?').bind(sess.player_id).first();
    return ok({ role: 'player', user: player });
  }
  return err(401, 'Session invalid');
}
