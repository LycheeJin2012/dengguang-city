// v25: 酒店管理 (super only)
// GET    /api/admin/hotels             - 列表 (admin 登录后)
// GET    /api/admin/hotels?id=X        - 单个
// POST   /api/admin/hotels             - 新建 (super only)
// PATCH  /api/admin/hotels?id=X        - 更新 (super only)
// DELETE /api/admin/hotels?id=X        - 删除 (super only, CASCADE 房型)
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

const ALLOWED = ['name', 'address', 'description', 'image_url', 'sort_order', 'is_active'];

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  // GET 公开 — 玩家也能看到酒店列表
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  let sql, params;
  if (id) {
    sql = 'SELECT * FROM hotels WHERE id = ?';
    params = [id];
  } else {
    sql = 'SELECT * FROM hotels ORDER BY sort_order, id';
    params = [];
  }
  const rows = await env.DB.prepare(sql).bind(...params).all();
  return ok({ hotels: rows.results || [] }, { headers: { 'Cache-Control': 'private, max-age=10' } });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  if (!await requireSuper(context)) return err(403, '仅 super 管理员可管理此信息');
  const body = await request.json().catch(() => ({}));
  const vals = ALLOWED.map(f => body[f] !== undefined ? body[f] : null);
  const ph = ALLOWED.map(() => '?').join(',');
  const res = await env.DB.prepare(
    `INSERT INTO hotels (${ALLOWED.join(',')}) VALUES (${ph})`
  ).bind(...vals).run();
  await env.DB.prepare('UPDATE hotels SET updated_at = datetime(\'now\') WHERE id = ?').bind(res.meta.last_row_id).run();
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
  sets.push('updated_at = datetime(\'now\')');
  vals.push(id);
  await env.DB.prepare(`UPDATE hotels SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return ok({ id, updated: sets.length - 1 });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  if (!await requireSuper(context)) return err(403, '仅 super 管理员可管理此信息');
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  // hotel_rooms.hotel_id 有 ON DELETE CASCADE, 房型自动删
  await env.DB.prepare('DELETE FROM hotels WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
