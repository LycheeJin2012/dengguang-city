// GET    /api/admin/admins  - 列出所有管理员
// POST   /api/admin/admins  - 新建管理员 (super only)
// PATCH  /api/admin/admins?id=X - 改密码/角色
// DELETE /api/admin/admins?id=X - 删除管理员
import { ok, err, hashPassword, readToken, getSession, isUsername, isNonEmpty } from '../../_shared.js';

async function requireAdmin(context) {
  const { env, request } = context;
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return null;
  const admin = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(sess.admin_id).first();
  return admin;
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const rows = await env.DB.prepare(`
    SELECT a.id, a.username, a.role, a.created_at, a.linked_player_id,
      lp.username AS linked_player_username, lp.game_id AS linked_player_game_id
    FROM admins a
    LEFT JOIN players lp ON lp.id = a.linked_player_id
    ORDER BY a.id ASC
  `).all();
  return ok({ admins: rows.results });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const me = await requireAdmin(context);
  if (!me) return err(401, '需要管理员登录');
  if (me.role !== 'super') return err(403, '只有 super 可新建管理员');

  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }
  const username = (body.username || '').trim();
  const password = body.password || '';
  const role = (body.role || 'admin').trim();
  if (!isUsername(username)) return err(400, '用户名需 3-32 字符 [a-zA-Z0-9_-]');
  if (!isNonEmpty(password, 128) || password.length < 8) return err(400, '密码至少 8 位');
  if (!['admin', 'super'].includes(role)) return err(400, '角色必须是 admin 或 super');

  const exist = await env.DB.prepare('SELECT id FROM admins WHERE username = ?').bind(username).first();
  if (exist) return err(409, '用户名已存在');

  const { hash, salt } = await hashPassword(password);
  const ins = await env.DB.prepare(
    'INSERT INTO admins (username, password_hash, salt, role) VALUES (?, ?, ?, ?)'
  ).bind(username, hash, salt, role).run();
  return ok({ id: ins.meta.last_row_id, username, role });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const me = await requireAdmin(context);
  if (!me) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');

  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }

  const target = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(id).first();
  if (!target) return err(404, '管理员不存在');

  // 改密码
  if (body.new_password) {
    const pw = body.new_password;
    if (!isNonEmpty(pw, 128) || pw.length < 8) return err(400, '密码至少 8 位');
    const { hash, salt } = await hashPassword(pw);
    await env.DB.prepare('UPDATE admins SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, id).run();
  }
  // 改角色（仅 super）
  if (body.role && body.role !== target.role) {
    if (me.role !== 'super') return err(403, '只有 super 可改角色');
    if (!['admin', 'super'].includes(body.role)) return err(400, '角色非法');
    if (target.id === me.id && body.role !== 'super') return err(400, '不能把自己降级');
    await env.DB.prepare('UPDATE admins SET role = ? WHERE id = ?').bind(body.role, id).run();
  }
  // v17.8: 绑定/解绑 玩家账号 (linked_player_id) - 仅 super
  if (body.hasOwnProperty('linked_player_id')) {
    if (me.role !== 'super') return err(403, '只有 super 可绑定玩家');
    const _lpid = body.linked_player_id === null || body.linked_player_id === '' || body.linked_player_id === 0
      ? null
      : parseInt(body.linked_player_id, 10);
    if (_lpid !== null) {
      const _p = await env.DB.prepare("SELECT id, username FROM players WHERE id = ? AND status = 'active'").bind(_lpid).first();
      if (!_p) return err(400, '玩家不存在或未激活');
    }
    await env.DB.prepare('UPDATE admins SET linked_player_id = ? WHERE id = ?').bind(_lpid, id).run();
  }
  return ok({ id });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const me = await requireAdmin(context);
  if (!me) return err(401, '需要管理员登录');
  if (me.role !== 'super') return err(403, '只有 super 可删除');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  if (id === me.id) return err(400, '不能删除自己');

  const target = await env.DB.prepare('SELECT role FROM admins WHERE id = ?').bind(id).first();
  if (!target) return err(404, '管理员不存在');
  if (target.role === 'super') {
    const { count } = await env.DB.prepare('SELECT COUNT(*) as count FROM admins WHERE role = ?').bind('super').first();
    if (count <= 1) return err(400, '不能删除最后一个 super');
  }
  await env.DB.prepare('DELETE FROM admins WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
