// v25: 酒店房型管理 (super only)
// GET    /api/admin/hotel-rooms?hotel_id=X  - 某酒店的房型 (公开)
// POST   /api/admin/hotel-rooms              - 新建房型 (super only)
// PATCH  /api/admin/hotel-rooms?id=X         - 更新 (super only)
// DELETE /api/admin/hotel-rooms?id=X         - 删除 (super only)
import { ok, err, readToken, getSession } from '../../_shared.js';

async function requireSuper(context) {
  const { env, request } = context;
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return null;
  const admin = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(sess.admin_id).first();
  if (!admin || admin.role !== 'super') return null;
  return admin;
}

const ALLOWED = ['hotel_id', 'name', 'capacity', 'beds', 'breakfast_included', 'price_per_night', 'description', 'image_url', 'sort_order', 'is_active'];

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const hotelId = url.searchParams.get('hotel_id');
  let sql, params;
  if (hotelId) {
    sql = 'SELECT * FROM hotel_rooms WHERE hotel_id = ? ORDER BY sort_order, id';
    params = [hotelId];
  } else {
    sql = 'SELECT * FROM hotel_rooms ORDER BY sort_order, id';
    params = [];
  }
  const rows = await env.DB.prepare(sql).bind(...params).all();
  return ok({ rooms: rows.results || [] }, { headers: { 'Cache-Control': 'private, max-age=10' } });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  if (!await requireSuper(context)) return err(403, '仅 super 管理员可管理此信息');
  const body = await request.json().catch(() => ({}));
  if (!body.hotel_id) return err(400, 'hotel_id 必填');
  const vals = ALLOWED.map(f => body[f] !== undefined ? body[f] : null);
  const ph = ALLOWED.map(() => '?').join(',');
  const res = await env.DB.prepare(
    `INSERT INTO hotel_rooms (${ALLOWED.join(',')}) VALUES (${ph})`
  ).bind(...vals).run();
  return ok({ id: res.meta.last_row_id, created: true });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  if (!await requireSuper(context)) return err(403, '仅 super 管理员可管理此信息');
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  const body = await request.json().catch(() => ({}));
  const sets = []; const vals = [];
  for (const f of ALLOWED) {
    if (f in body) { sets.push(`${f} = ?`); vals.push(body[f]); }
  }
  if (sets.length === 0) return err(400, '没有可更新字段');
  vals.push(id);
  await env.DB.prepare(`UPDATE hotel_rooms SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return ok({ id, updated: sets.length - 1 });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  if (!await requireSuper(context)) return err(403, '仅 super 管理员可管理此信息');
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM hotel_rooms WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
