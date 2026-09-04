// v50: admin 房型 (公开 GET / super POST/PATCH/DELETE)
import { ok, err, handleOptions, requireAdmin, requireSuper, pickFields } from './_helpers.js';

const ALLOWED = ['hotel_id', 'name', 'capacity', 'beds', 'breakfast_included', 'price_per_night', 'description', 'image_url', 'sort_order', 'is_active'];

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const hotelId = new URL(request.url).searchParams.get('hotel_id');
  const rows = hotelId
    ? (await env.DB.prepare('SELECT * FROM hotel_rooms WHERE hotel_id = ? ORDER BY sort_order, id').bind(hotelId).all()).results
    : (await env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY sort_order, id').all()).results;
  return ok({ rooms: rows || [] }, { headers: { 'Cache-Control': 'private, max-age=10' } });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireSuper(context);
  if (r.error) return r.error;
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
  const r = await requireSuper(context);
  if (r.error) return r.error;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  const body = await request.json().catch(() => ({}));
  const fields = pickFields(body, ALLOWED);
  const sets = Object.keys(fields).map(f => `${f} = ?`);
  const vals = Object.values(fields);
  if (!sets.length) return err(400, '没有可更新字段');
  vals.push(id);
  await env.DB.prepare(`UPDATE hotel_rooms SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return ok({ id, updated: sets.length });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireSuper(context);
  if (r.error) return r.error;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM hotel_rooms WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
