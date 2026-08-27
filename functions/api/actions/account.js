// v44 重写: 账号 / 密码 / 合并 / 退出 actions
// 路由: POST /api/init?action=admin-logout | admin-merge-account | admin-unmerge-account |
//                       admin-reset-player-password | admin-enter-password | player-change-password
import { ok, err, readToken, getSession, hashPassword, isNonEmpty, verifyPassword, createSession } from '../../_shared.js';

// 解析 admin session (从 cookie)
async function getAdminSession(env, request) {
  const token = readToken(request);
  if (!token) return { ok: false, reason: '需要管理员登录' };
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return { ok: false, reason: '需要管理员登录' };
  if (new Date(sess.expires_at) <= new Date()) return { ok: false, reason: '会话已过期' };
  const admin = await env.DB.prepare('SELECT id, role, username FROM admins WHERE id = ?').bind(sess.admin_id).first();
  if (!admin) return { ok: false, reason: '管理员不存在' };
  return { ok: true, sess, admin };
}

// 解析 player session
async function getPlayerSession(env, request) {
  const token = readToken(request);
  if (!token) return { ok: false, reason: '需要玩家登录' };
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return { ok: false, reason: '需要玩家登录' };
  if (new Date(sess.expires_at) <= new Date()) return { ok: false, reason: '会话已过期' };
  return { ok: true, sess, player_id: sess.player_id };
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // ============ admin-logout (任何角色都能登出) ============
  if (action === 'admin-logout') {
    const token = readToken(request);
    if (token) {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'lc_session=; Path=/; Max-Age=0' }
    });
  }

  // ============ admin-merge-account (super only) ============
  if (action === 'admin-merge-account') {
    const auth = await getAdminSession(env, request);
    if (!auth.ok) return err(401, auth.reason);
    if (auth.admin.role !== 'super') return err(403, '只有 super 管理员可操作合并');
    const body = await request.json().catch(() => ({}));
    const adminId = parseInt(body.admin_id || 0, 10);
    const playerId = parseInt(body.player_id || 0, 10);
    if (!adminId || !playerId) return err(400, 'admin_id 和 player_id 必填');
    try {
      const { mergeAccount } = await import('../../_shared.js');
      const result = await mergeAccount(env, adminId, playerId);
      return ok({ merged: true, ...result });
    } catch (e) {
      return err(500, e?.message || String(e));
    }
  }

  // ============ admin-unmerge-account (super only) ============
  if (action === 'admin-unmerge-account') {
    const auth = await getAdminSession(env, request);
    if (!auth.ok) return err(401, auth.reason);
    if (auth.admin.role !== 'super') return err(403, '只有 super 管理员可操作合并');
    const body = await request.json().catch(() => ({}));
    const adminId = parseInt(body.admin_id || 0, 10);
    const playerId = parseInt(body.player_id || 0, 10);
    if (!adminId || !playerId) return err(400, 'admin_id 和 player_id 必填');
    try {
      const { unmergeAccount } = await import('../../_shared.js');
      await unmergeAccount(env, adminId, playerId);
      return ok({ unmerged: true, admin_id: adminId, player_id: playerId });
    } catch (e) {
      return err(500, e?.message || String(e));
    }
  }

  // ============ admin-reset-player-password (super only) ============
  if (action === 'admin-reset-player-password') {
    const auth = await getAdminSession(env, request);
    if (!auth.ok) return err(401, auth.reason);
    if (auth.admin.role !== 'super') return err(403, '只有 super 管理员可重置玩家密码');
    const body = await request.json().catch(() => ({}));
    const pid = parseInt(body.player_id || 0, 10);
    const newPw = (body.new_password || '').toString();
    if (!pid || !isNonEmpty(newPw, 128)) return err(400, 'player_id 和 new_password 必填');
    if (newPw.length < 8) return err(400, '新密码至少 8 位');
    const p = await env.DB.prepare('SELECT id, username FROM players WHERE id = ?').bind(pid).first();
    if (!p) return err(404, '玩家不存在');
    const { hash, salt } = await hashPassword(newPw);
    await env.DB.prepare('UPDATE players SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, pid).run();
    return ok({ player_id: pid, username: p.username, message: '玩家密码已重置 (不影响任何已绑定的管理员账号)' });
  }

  // ============ player-change-password (玩家改自己密码) ============
  if (action === 'player-change-password') {
    const auth = await getPlayerSession(env, request);
    if (!auth.ok) return err(401, auth.reason);
    const body = await request.json().catch(() => ({}));
    const oldPw = (body.old_password || '').toString();
    const newPw = (body.new_password || '').toString();
    if (oldPw.length < 8 || newPw.length < 8) return err(400, '新旧密码至少 8 位');
    const p = await env.DB.prepare('SELECT id, password_hash, salt FROM players WHERE id = ?').bind(auth.player_id).first();
    if (!p) return err(404, '玩家不存在');
    const okPw = await verifyPassword(oldPw, p.password_hash, p.salt);
    if (!okPw) return err(401, '旧密码错误');
    const { hash, salt } = await hashPassword(newPw);
    await env.DB.prepare('UPDATE players SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, p.id).run();
    return ok({ id: p.id, message: '密码已更新' });
  }

  // ============ admin-enter-password (玩家 session → 升级 combined) ============
  if (action === 'admin-enter-password') {
    const auth = await getPlayerSession(env, request);
    if (!auth.ok) return err(401, auth.reason);
    const body = await request.json().catch(() => ({}));
    const pw = (body.admin_password || '').toString();
    if (pw.length < 8) return err(400, '管理员密码至少 8 位');
    const link = await env.DB.prepare(
      'SELECT a.id, a.username, a.role, a.password_hash, a.salt FROM players p LEFT JOIN admins a ON a.id = p.linked_admin_id WHERE p.id = ?'
    ).bind(auth.player_id).first();
    if (!link || !link.id) return err(403, '该玩家账号未绑定管理员账号, 无法进入管理后台');
    if (link.role !== 'super' && link.role !== 'admin') return err(403, '关联账号不是管理员');
    const okPw = await verifyPassword(pw, link.password_hash, link.salt);
    if (!okPw) return err(401, '管理员密码错误');
    // 创建 combined session
    const r = await createSession(env, auth.player_id, link.id);
    if (readToken(request)) {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(readToken(request)).run();
    }
    const cookie = `lc_session=${r.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8 * 3600}`;
    return new Response(JSON.stringify({
      ok: true, combined: true,
      admin: { id: link.id, username: link.username, role: link.role },
      player_id: auth.player_id,
    }), {
      status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie }
    });
  }

  return err(404, '未知 account action: ' + action);
}
