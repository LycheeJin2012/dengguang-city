// GET    /api/admin/kart - 管理员看所有 kart 报名
// PATCH  /api/admin/kart?id=X&status=...
// DELETE /api/admin/kart?id=X
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
    `SELECT k.*, p.username as player_username
     FROM kart_signups k LEFT JOIN players p ON p.id = k.player_id
     ORDER BY k.created_at DESC LIMIT 200`
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
  const status = url.searchParams.get('status');
  if (!id || !['pending', 'confirmed', 'cancelled'].includes(status)) return err(400, '参数错误');
  await env.DB.prepare('UPDATE kart_signups SET status = ? WHERE id = ?').bind(status, id).run();
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
  await env.DB.prepare('DELETE FROM kart_signups WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
