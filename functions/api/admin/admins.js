// v50: admin 管理员账号管理 (super only)
import { ok, err, handleOptions, requireAdmin, requireSuper, hashPassword, pickFields } from './_helpers.js';

const ALLOWED = ['username', 'role', 'linked_player_id'];

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const rows = await env.DB.prepare('SELECT id, username, role, linked_player_id, created_at FROM admins ORDER BY id').all();
  return ok({ admins: rows.results || [] });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireSuper(context);
  if (r.error) return r.error;
  const body = await request.json().catch(() => ({}));
  if (!body.username || !body.password) return err(400, 'username/password 必填');
  if (body.password.length < 6) return err(400, '密码至少 6 位');
  const { hash, salt } = await hashPassword(body.password);
  const res = await env.DB.prepare(
    'INSERT INTO admins (username, password_hash, salt, role, linked_player_id) VALUES (?, ?, ?, ?, ?)'
  ).bind(body.username, hash, salt, body.role || 'admin', body.linked_player_id || null).run();
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
  if (body.password && body.password.length >= 6) {
    const { hash, salt } = await hashPassword(body.password);
    fields.password_hash = hash;
    fields.salt = salt;
  }
  const sets = Object.keys(fields).map(f => `${f} = ?`);
  if (!sets.length) return err(400, '没有可更新字段');
  const vals = [...Object.values(fields), id];
  await env.DB.prepare(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return ok({ id, updated: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireSuper(context);
  if (r.error) return r.error;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  if (id === r.admin.id) return err(400, '不能删除自己');
  await env.DB.prepare('DELETE FROM admins WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
