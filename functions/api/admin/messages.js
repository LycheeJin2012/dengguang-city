// GET  /api/admin/messages - 管理员看所有留言
// PATCH /api/admin/messages?id=X&status=new|read|done
import { ok, err, readToken, getSession } from '../_shared.js';

async function requireAdmin(context) {
  const { env, request } = context;
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return null;
  const admin = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(sess.admin_id).first();
  if (!admin) return null;
  return admin;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  let rows;
  if (status) {
    rows = await env.DB.prepare(
      'SELECT m.*, p.username as player_username FROM messages m LEFT JOIN players p ON p.id = m.player_id WHERE status = ? ORDER BY created_at DESC'
    ).bind(status).all();
  } else {
    rows = await env.DB.prepare(
      'SELECT m.*, p.username as player_username FROM messages m LEFT JOIN players p ON p.id = m.player_id ORDER BY created_at DESC LIMIT 200'
    ).all();
  }
  return ok({ messages: rows.results });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  const status = url.searchParams.get('status');
  if (!id || !['new', 'read', 'done'].includes(status)) return err(400, '参数错误');

  await env.DB.prepare('UPDATE messages SET status = ? WHERE id = ?').bind(status, id).run();
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
  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
