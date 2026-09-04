// v50: admin 酒店预订 (列表 GET / 状态更新 PATCH)
import { ok, err, handleOptions, requireAdmin, parseListParams } from './_helpers.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const p = parseListParams(request);
  const where = []; const binds = [];
  if (p.status) { where.push('b.status = ?'); binds.push(p.status); }
  if (p.q) { where.push('(b.name LIKE ? OR b.contact LIKE ? OR b.room_name LIKE ?)'); binds.push('%' + p.q + '%', '%' + p.q + '%', '%' + p.q + '%'); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await env.DB.prepare(
    `SELECT b.*, p.username AS player_username, p.avatar_emoji
     FROM bookings b LEFT JOIN players p ON p.id = b.player_id
     ${whereSql} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, p.limit, p.offset).all();
  return ok({ bookings: rows.results || [] });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  const body = await request.json().catch(() => ({}));
  if (!body.status) return err(400, 'status 必填');
  await env.DB.prepare('UPDATE bookings SET status = ? WHERE id = ?').bind(body.status, id).run();
  return ok({ id, status: body.status });
}
