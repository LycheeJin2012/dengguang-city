// v50: admin 驾照要求管理
import { ok, err, handleOptions, requireAdmin, requireSuper, pickFields } from './_helpers.js';

const ALLOWED = ['grade', 'title', 'description', 'sort_order'];

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const rows = await env.DB.prepare('SELECT * FROM license_requirements ORDER BY sort_order, id').all();
  return ok({ reqs: rows.results || [] });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireSuper(context);
  if (r.error) return r.error;
  const body = await request.json().catch(() => ({}));
  if (!body.grade) return err(400, 'grade 必填');
  const fields = pickFields(body, ALLOWED);
  const cols = Object.keys(fields);
  const ph = cols.map(() => '?').join(',');
  const res = await env.DB.prepare(`INSERT INTO license_requirements (${cols.join(',')}) VALUES (${ph})`).bind(...Object.values(fields)).run();
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
  if (!sets.length) return err(400, '没有可更新字段');
  const vals = [...Object.values(fields), id];
  await env.DB.prepare(`UPDATE license_requirements SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return ok({ id, updated: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireSuper(context);
  if (r.error) return r.error;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM license_requirements WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
