// GET    /api/admin/circuit - 管理员看所有 circuit 试车
// PATCH  /api/admin/circuit?id=X&status=...
// DELETE /api/admin/circuit?id=X
import { ok, err, readToken, getSession } from '../../_shared.js';

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

  const rows = await env.DB.prepare(
    `SELECT c.*, p.username as player_username
     FROM circuit_signups c LEFT JOIN players p ON p.id = c.player_id
     ORDER BY c.created_at DESC LIMIT 200`
  ).all();
  return ok({ signups: rows.results });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');

  // 兼容旧 query-string 状态切换
  const status = url.searchParams.get('status');
  if (status) {
    if (!['pending', 'confirmed', 'cancelled'].includes(status)) return err(400, 'status 非法');
    await env.DB.prepare('UPDATE circuit_signups SET status = ? WHERE id = ?').bind(status, id).run();
    return ok({ id, status });
  }

  // v20: body 完整编辑
  let body = {};
  try { body = await request.json(); } catch (e) { return err(400, 'body 必须是 JSON'); }
  const _allowed = ['name', 'contact', 'session', 'car', 'note', 'status'];
  const _sets = []; const _vals = [];
  for (const k of _allowed) {
    if (k in body) { _sets.push(`${k} = ?`); _vals.push(body[k]); }
  }
  if (_sets.length === 0) return err(400, '没有可更新字段');
  _vals.push(id);
  await env.DB.prepare(`UPDATE circuit_signups SET ${_sets.join(', ')} WHERE id = ?`).bind(..._vals).run();
  return ok({ id, updated: _sets.length });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM circuit_signups WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
