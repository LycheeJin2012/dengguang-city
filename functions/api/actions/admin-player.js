// v50: admin 操作玩家 (禁用 / 启用 / 重置密码 / 关联)
import { ok, err, getSession, readToken, hashPassword } from '../_helpers.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  const body = await request.json().catch(() => ({}));
  const id = parseInt(body.id || body.player_id || '0', 10);
  if (!id) return err(400, 'id 必填');

  if (action === 'disable') {
    await env.DB.prepare("UPDATE players SET status = 'rejected' WHERE id = ?").bind(id).run();
    return ok({ id, status: 'rejected' });
  }
  if (action === 'enable') {
    await env.DB.prepare("UPDATE players SET status = 'active' WHERE id = ?").bind(id).run();
    return ok({ id, status: 'active' });
  }
  if (action === 'reset-password') {
    const newPw = body.password || 'changeme123';
    const { hash, salt } = await hashPassword(newPw);
    await env.DB.prepare('UPDATE players SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, id).run();
    return ok({ id, reset: true, password: newPw });
  }
  return err(400, '未知 action');
}
