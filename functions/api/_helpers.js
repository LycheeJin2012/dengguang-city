// v45 重写: 后端共享 helper (session 解析 + subject 解析)
// 从 init.js LEGACY 段抽出, 给 actions/passkey / admin-dm / admin-passkey-debug 共用
import { getSession } from '../_shared.js';

// 解析 cookie 拿 session token, 查 admin 身份
export async function parseSession(env, request) {
  const ck = request.headers.get('Cookie') || '';
  const m = ck.match(/lc_session=([^;]+)/);
  const tok = m ? m[1] : null;
  const sess = tok ? await getSession(env, tok) : null;
  let me = null;
  if (sess && sess.admin_id) {
    me = await env.DB.prepare('SELECT id, role, username FROM admins WHERE id = ?').bind(sess.admin_id).first();
  }
  return { sess, me };
}

// 由 session 拿 subject (player 或 admin)
export async function resolveSubjectFromSession(env, sess) {
  if (!sess) return null;
  if (sess.player_id) {
    const p = await env.DB.prepare(
      "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'"
    ).bind(sess.player_id).first();
    return p || null;
  }
  if (sess.admin_id) {
    const a = await env.DB.prepare(
      "SELECT a.id, a.username, a.role, a.linked_player_id, 'admin' AS kind FROM admins a WHERE a.id = ?"
    ).bind(sess.admin_id).first();
    if (!a) return null;
    if (a.linked_player_id) {
      const p = await env.DB.prepare(
        "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'"
      ).bind(a.linked_player_id).first();
      if (p) return { ...p, _via_admin: a.id, _admin_username: a.username };
    }
    return a;
  }
  return null;
}

// 由 username 查 subject (用于 passkey-login-start, 公开)
export async function resolveSubjectByUsername(env, username) {
  const p = await env.DB.prepare("SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'").bind(username).first();
  if (p) return p;
  const a = await env.DB.prepare("SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?").bind(username).first();
  return a || null;
}

// WebAuthn 辅助
export function getRpId(req) {
  const u = new URL(req.url);
  return u.hostname.replace(/^www\./, '');
}
export function getOrigin(req) {
  const u = new URL(req.url);
  return u.origin;
}

// 通用 ok / err 响应
export function ok(data) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
export function err(status, message) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
