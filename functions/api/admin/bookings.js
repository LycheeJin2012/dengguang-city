// GET    /api/admin/bookings - 管理员看所有酒店预订
// PATCH  /api/admin/bookings?id=X&status=confirmed|cancelled
// DELETE /api/admin/bookings?id=X
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
    `SELECT b.*, p.username as player_username
     FROM bookings b LEFT JOIN players p ON p.id = b.player_id
     ORDER BY b.created_at DESC LIMIT 200`
  ).all();
  return ok({ bookings: rows.results });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  const status = url.searchParams.get('status');
  if (!id || !['pending', 'confirmed', 'cancelled'].includes(status)) return err(400, '参数错误');

  await env.DB.prepare('UPDATE bookings SET status = ? WHERE id = ?').bind(status, id).run();
  return ok({ id, status });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}

