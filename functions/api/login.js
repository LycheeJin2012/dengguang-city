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

  // v17.10 修订: 玩家/管理员登录只创建单身份 session
  // - 玩家密码 → 只创建 player session (登录首页)
  // - 管理员密码 → 只创建 admin session (登录管理后台)
  // 进入合并/管理后台需要另外调 admin-enter-password 或 passkey-admin-enter 升级
  let _adminIdForSession = null;
  let _playerIdForSession = null;
  let _linkedPeer = null;
  if (role === 'player') {
    _playerIdForSession = userId;
    const _link = await env.DB.prepare(
      'SELECT a.id, a.username, a.role FROM players p LEFT JOIN admins a ON a.id = p.linked_admin_id WHERE p.id = ?'
    ).bind(userId).first();
    if (_link && _link.id) {
      _linkedPeer = { kind: 'admin', id: _link.id, username: _link.username, role: _link.role };
    }
  } else {
    _adminIdForSession = userId;
    const _link = await env.DB.prepare(
      'SELECT p.id, p.username FROM admins a LEFT JOIN players p ON p.id = a.linked_player_id WHERE a.id = ?'
    ).bind(userId).first();
    if (_link && _link.id) {
      _linkedPeer = { kind: 'player', id: _link.id, username: _link.username };
    }
  }

  const { token, expires_at } = await createSession(env, _playerIdForSession, _adminIdForSession);

  // Set-Cookie 也写一份方便浏览器调用
  const cookie = `lc_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8*3600}`;

  // 如果是浏览器原生 form 提交（无 fetch），用 302 重定向回原页面，避免 in-app browser 不触发 JS
  const accept = request.headers.get('Accept') || '';
  const isFormPost = accept.includes('text/html');
  if (isFormPost) {
    let back = role === 'player' ? '/' : '/admin';
    try {
      const referer = request.headers.get('Referer') || '';
      if (referer) {
        const u = new URL(referer);
        if (role === 'player' && !u.pathname.startsWith('/admin')) back = '/';
        else if (role !== 'player' && !u.pathname.startsWith('/admin')) back = '/admin';
      }
    } catch (e) { /* ignore */ }
    return new Response(null, {
      status: 302,
      headers: { 'Set-Cookie': cookie, 'Location': back }
    });
  }
  // JSON 调用走到这里就正常返回


  return new Response(JSON.stringify({
    ok: true, token, expires_at, role, user_id: userId,
    combined: !!_linkedPeer,    // 是否合并 session
    linked: _linkedPeer || null,  // 绑定的另一身份
  }), {
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
  // v17.9: 合并 session 时同时返回 admin 和 player 身份
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess) return err(401, 'Not logged in');

  try {
    let admin = null, player = null;
    if (sess.admin_id) {
      try {
        admin = await env.DB.prepare('SELECT id, username, role, linked_player_id FROM admins WHERE id = ?').bind(sess.admin_id).first();
      } catch (e) { return err(500, 'admin select err: ' + e.message); }
    }
    if (sess.player_id) {
      try {
        player = await env.DB.prepare('SELECT id, username, email, game_id, status, avatar_emoji, bio, linked_admin_id, emeralds FROM players WHERE id = ?').bind(sess.player_id).first();
      } catch (e) { return err(500, 'player select err: ' + e.message); }
    }
    // combined session (有两边): 选当前 URL 想看的角色
    // 简化: 有 admin 优先 admin, 否则 player
    if (admin) {
      return ok({ role: admin.role, user: admin, admin, player, combined: !!player });
    }
    if (player) {
      return ok({ role: 'player', user: player, admin, player, combined: !!admin });
    }
    return err(401, 'Session invalid');
  } catch (e) {
    return err(500, 'GET /api/login err: ' + (e?.message || String(e)));
  }
}
