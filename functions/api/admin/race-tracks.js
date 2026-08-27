// v25: 赛车场管理 (super only)
// GET    /api/admin/race-tracks  - 列表 (公开)
// POST   /api/admin/race-tracks  - 新建 (super only)
// PATCH  /api/admin/race-tracks?id=X  - 更新 (super only)
// DELETE /api/admin/race-tracks?id=X  - 删除 (super only)
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

const ALLOWED = ['name', 'length_km', 'laps', 'difficulty', 'description', 'image_url', 'trial_price', 'sort_order', 'is_active'];

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const rows = await env.DB.prepare('SELECT * FROM race_tracks ORDER BY sort_order, id').all();
  return ok({ tracks: rows.results || [] }, { headers: { 'Cache-Control': 'private, max-age=10' } });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  if (!await requireSuper(context)) return err(403, '仅 super 管理员可管理此信息');
  const body = await request.json().catch(() => ({}));
  const vals = ALLOWED.map(f => body[f] !== undefined ? body[f] : null);
  const ph = ALLOWED.map(() => '?').join(',');
  const res = await env.DB.prepare(
    `INSERT INTO race_tracks (${ALLOWED.join(',')}) VALUES (${ph})`
  ).bind(...vals).run();
  await env.DB.prepare('UPDATE race_tracks SET updated_at = datetime(\'now\') WHERE id = ?').bind(res.meta.last_row_id).run();
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
  await env.DB.prepare(`UPDATE race_tracks SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return ok({ id, updated: sets.length - 1 });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  if (!await requireSuper(context)) return err(403, '仅 super 管理员可管理此信息');
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM race_tracks WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
