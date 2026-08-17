// POST /api/admin/change-password - 改自己密码
import { ok, err, hashPassword, verifyPassword, readToken, getSession, isNonEmpty } from '../../_shared.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return err(401, '需要管理员登录');

  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }
  const oldPw = body.old_password || '';
  const newPw = body.new_password || '';
  if (!isNonEmpty(oldPw, 128) || !isNonEmpty(newPw, 128)) return err(400, '旧/新密码必填');
  if (newPw.length < 8) return err(400, '新密码至少 8 位');

  const admin = await env.DB.prepare(
    'SELECT id, password_hash, salt FROM admins WHERE id = ?'
  ).bind(sess.admin_id).first();
  if (!admin) return err(404, '管理员不存在');

  const okPw = await verifyPassword(oldPw, admin.password_hash, admin.salt);
  if (!okPw) return err(401, '旧密码错误');

  const { hash, salt } = await hashPassword(newPw);
  await env.DB.prepare('UPDATE admins SET password_hash = ?, salt = ? WHERE id = ?')
    .bind(hash, salt, admin.id).run();

  // v17.9 修订: 合并账号但两边密码不共享 — admin 改密码不影响绑定的玩家
  // (玩家侧用玩家密码登录, 通行密钥任意一边注册都生效)

  return ok({ id: admin.id, message: '密码已更新' });
}
