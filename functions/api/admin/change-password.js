// v50: admin 改自己密码
import { ok, err, handleOptions, requireAdmin, hashPassword, verifyPassword } from './_helpers.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const body = await request.json().catch(() => ({}));
  const oldPw = body.old_password || '';
  const newPw = body.new_password || '';
  if (newPw.length < 6) return err(400, '新密码至少 6 位');
  const row = await env.DB.prepare('SELECT password_hash, salt FROM admins WHERE id = ?').bind(r.admin.id).first();
  if (!row) return err(404, '管理员不存在');
  const ok2 = await verifyPassword(oldPw, row.salt, row.password_hash);
  if (!ok2) return err(401, '旧密码错');
  const { hash, salt } = await hashPassword(newPw);
  await env.DB.prepare('UPDATE admins SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, r.admin.id).run();
  return ok({ changed: true });
}
