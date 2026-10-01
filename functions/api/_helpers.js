// v45 重写: 后端共享 helper (session 解析 + subject 解析)
// 从 init.js LEGACY 段抽出, 给 actions/passkey / admin-dm / admin-passkey-debug 共用
import { getSession } from '../_shared.js';

// ⚠️ 下面那条正则**故意不加锚点**（既没有 ^ 开头，也没有 ; 分隔符前缀），
// 所以 `xlc_session=xxx` 这种黏在别的 cookie 名后面的写法也会命中。
// 这是既有行为，给它加前缀锚定属于行为变更，不要顺手「修正」。
// 注释里刻意不复写正则原文：两处字面量各改各的，迟早会对不上。
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
  // player_id 优先于 admin_id：合并账号的会话两个字段都有，
  // 这里始终先认玩家身份，admin 侧的合并信息只在没有 player_id 时才生效。
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
    // 管理员绑了玩家且该玩家仍是 active：合并成一个 player subject，
    // 并带上 _via_admin / _admin_username 让调用方知道是从哪条路进来的。
    // 绑定目标被停用或删掉时不动声色地回退成 admin 自己。
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
// 玩家优先：同名时按玩家通道解析，管理员只在玩家查不到时才兜底。
export async function resolveSubjectByUsername(env, username) {
  const p = await env.DB.prepare("SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'").bind(username).first();
  if (p) return p;
  const a = await env.DB.prepare("SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?").bind(username).first();
  return a || null;
}

// WebAuthn 辅助
export function getRpId(req) {
  const u = new URL(req.url);
  // 只剥一层 www.：'www.www.example.com' 剩 'www.example.com'
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
