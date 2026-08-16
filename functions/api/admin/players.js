// GET /api/admin/players - 管理员看玩家列表
import { ok, err, readToken, getSession } from '../../_shared.js';

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

  const rows = await env.DB.prepare(
    'SELECT id, username, email, game_id, created_at FROM players ORDER BY created_at DESC LIMIT 200'
  ).all();
  return ok({ players: rows.results, count: rows.results.length });
}
