// v50: admin 玩家管理
import { ok, err, handleOptions, requireAdmin, parseListParams } from './_helpers.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const p = parseListParams(request);
  const where = []; const binds = [];
  if (p.status) { where.push('p.status = ?'); binds.push(p.status); }
  if (p.q) { where.push('(p.username LIKE ? OR p.email LIKE ? OR p.game_id LIKE ?)'); binds.push('%' + p.q + '%', '%' + p.q + '%', '%' + p.q + '%'); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await env.DB.prepare(
    `SELECT p.id, p.username, p.email, p.game_id, p.status, p.avatar_emoji, p.emeralds, p.last_login_at, p.created_at, p.linked_admin_id
     FROM players p ${whereSql} ORDER BY p.created_at DESC LIMIT ?`
  ).bind(...binds, p.limit).all();
  return ok({ players: rows.results || [] });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  const body = await request.json().catch(() => ({}));
  const sets = []; const binds = [];
  if (body.status) { sets.push('status = ?'); binds.push(body.status); }
  if (body.emeralds !== undefined) { sets.push('emeralds = ?'); binds.push(Number(body.emeralds) || 0); }
  if (body.linked_admin_id !== undefined) { sets.push('linked_admin_id = ?'); binds.push(body.linked_admin_id || null); }
  if (!sets.length) return err(400, '没有可更新字段');
  binds.push(id);
  await env.DB.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return ok({ id, updated: true });
}
