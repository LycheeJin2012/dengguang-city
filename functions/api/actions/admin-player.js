// v44 重写: 玩家管理 (super only, 给 super 提供额外的字段)
// 路由: POST /api/init?action=admin-player-list | admin-player-create
// 实际转发到 /api/admin/players 端点 (admin.v2551.js v40.4 已统一改用新端点,
// 老 super-only 端点保留兼容, 转发到 /api/admin/players 复用代码)
import { ok, err, readToken, getSession, hashPassword, isUsername, isEmail } from '../../_shared.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // 校验 super 权限
  const token = readToken(request);
  if (!token) return err(401, '需要管理员登录');
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return err(401, '会话已过期或未登录');
  const me = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(sess.admin_id).first();
  if (!me || me.role !== 'super') return err(403, '只有 super 管理员可使用此功能');

  if (action === 'admin-player-list') {
    // 委托给 /api/admin/players (含 last_session 字段, LEFT JOIN + GROUP BY)
    // 这里直接走 D1 保持兼容 (不通过 fetch 调 /api/admin/players, 避免内部 HTTP)
    const q = (url.searchParams.get('q') || '').trim();
    let sql = `
      SELECT
        p.id, p.username, p.email, p.game_id, p.status, p.avatar_emoji, p.bio, p.created_at,
        COALESCE(p.emeralds, 0) AS emeralds,
        MAX(s.expires_at) AS last_session
      FROM players p
      LEFT JOIN sessions s ON s.player_id = p.id
      WHERE 1=1
    `;
    const args = [];
    if (q) {
      sql += ' AND (p.username LIKE ? OR p.email LIKE ? OR p.game_id LIKE ?)';
      args.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
    }
    sql += ' GROUP BY p.id ORDER BY p.created_at DESC LIMIT 200';
    const rows = await env.DB.prepare(sql).bind(...args).all();
    return ok({ players: rows.results || [] });
  }

  if (action === 'admin-player-create') {
    // 超管代注册玩家
    const body = await request.json().catch(() => ({}));
    const username = (body.username || '').trim();
    const email = (body.email || '').trim();
    const gameId = (body.game_id || '').trim();
    const password = (body.password || '').toString();
    if (!isUsername(username)) return err(400, '用户名 2-32 字符, 不含 @/控制字符');
    if (!isEmail(email)) return err(400, '邮箱格式错误');
    if (password.length < 8) return err(400, '密码至少 8 位');
    const exists = await env.DB.prepare('SELECT id FROM players WHERE username = ? OR email = ?').bind(username, email).first();
    if (exists) return err(400, '用户名或邮箱已被注册');
    const { hash, salt } = await hashPassword(password);
    await env.DB.prepare(
      "INSERT INTO players (username, email, password_hash, salt, game_id, status, bio, avatar_emoji) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
    ).bind(username, email, hash, salt, gameId, '由 super 管理员代注册', '👤').run();
    return ok({ username, status: 'active', action: 'created' });
  }

  return err(404, '未知 admin-player action: ' + action);
}
