// GET    /api/admin/players            - 管理员看玩家列表（含状态）
// GET    /api/admin/players?status=... - 按状态过滤
// PATCH  /api/admin/players?id=X&action=approve|reject|reset|rename
//        body: { new_password?: string, new_username?: string }
import { ok, err, hashPassword, isNonEmpty, isUsername, readToken, getSession } from '../../_shared.js';

async function requireAdmin(context) {
  const { env, request } = context;
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return null;
  const admin = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(sess.admin_id).first();
  if (!admin) return null;
  return admin;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status'); // 'pending' | 'active' | 'rejected' | null

  let sql = 'SELECT id, username, email, game_id, status, avatar_emoji, bio, created_at FROM players';
  const args = [];
  if (statusFilter && ['pending', 'active', 'rejected'].includes(statusFilter)) {
    sql += ' WHERE status = ?';
    args.push(statusFilter);
  }
  sql += ' ORDER BY created_at DESC LIMIT 500';

  const rows = await env.DB.prepare(sql).bind(...args).all();
  return ok({ players: rows.results, count: rows.results.length });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const me = await requireAdmin(context);
  if (!me) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  const action = url.searchParams.get('action') || '';
  if (!id) return err(400, 'id 必填');

  const target = await env.DB.prepare('SELECT id, username, status FROM players WHERE id = ?').bind(id).first();
  if (!target) return err(404, '玩家不存在');

  let body = {};
  try { body = await request.json(); } catch (e) { /* 可能没有 body */ }

  if (action === 'approve') {
    if (target.status === 'active') return ok({ id, status: 'active', message: '已是激活状态' });
    await env.DB.prepare("UPDATE players SET status = 'active' WHERE id = ?").bind(id).run();
    return ok({ id, status: 'active', message: '已批准' });
  }
  if (action === 'reject') {
    if (target.status === 'rejected') return ok({ id, status: 'rejected', message: '已是拒绝状态' });
    await env.DB.prepare("UPDATE players SET status = 'rejected' WHERE id = ?").bind(id).run();
    return ok({ id, status: 'rejected', message: '已拒绝' });
  }
  if (action === 'reset') {
    const np = (body.new_password || '').trim();
    if (!isNonEmpty(np, 128) || np.length < 8) return err(400, '新密码至少 8 位');
    const { hash, salt } = await hashPassword(np);
    await env.DB.prepare('UPDATE players SET password_hash = ?, salt = ? WHERE id = ?')
      .bind(hash, salt, id).run();
    return ok({ id, message: '密码已重置' });
  }
  if (action === 'rename') {
    // v17.10: super 改玩家 username (玩家真实账号名)
    if (me.role !== 'super') return err(403, '只有 super 管理员可改玩家名字');
    const newName = (body.new_username || '').trim();
    if (!isUsername(newName)) return err(400, '新用户名格式不对 (2-32 字符, 不含 @ 和控制字符)');
    if (newName === target.username) return ok({ id, username: target.username, message: '未变化' });
    // 检查是否已被其他玩家占用
    const exist = await env.DB.prepare('SELECT id FROM players WHERE username = ? AND id != ?')
      .bind(newName, id).first();
    if (exist) return err(409, '用户名已被占用: ' + newName);
    // 只在 game_id 等于旧 username 时同步 (玩家未自定义 game_id)
    const cur = await env.DB.prepare('SELECT username, game_id FROM players WHERE id = ?').bind(id).first();
    if (cur.game_id === cur.username) {
      await env.DB.prepare('UPDATE players SET username = ?, game_id = ? WHERE id = ?')
        .bind(newName, newName, id).run();
    } else {
      await env.DB.prepare('UPDATE players SET username = ? WHERE id = ?')
        .bind(newName, id).run();
    }
    return ok({ id, username: newName, game_id_synced: cur.game_id === cur.username, message: '已修改' });
  }
  return err(400, '未知 action，应为 approve | reject | reset | rename');
}
