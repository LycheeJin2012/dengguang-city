// GET /api/my-bookings - 玩家看自己的酒店预订
// GET /api/admin/bookings - 管理员看所有酒店预订
import { ok, err, readToken, getSession } from '../../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  const url = new URL(request.url);
  const isAdminEndpoint = url.pathname.endsWith('/admin/bookings');

  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess) return err(401, '请先登录');

  let rows;
  if (sess.admin_id) {
    // 管理员：看所有
    rows = await env.DB.prepare(
      `SELECT b.*, p.username as player_username
       FROM bookings b LEFT JOIN players p ON p.id = b.player_id
       ORDER BY b.created_at DESC LIMIT 200`
    ).all();
    return ok({ bookings: rows.results, role: 'admin' });
  } else if (sess.player_id) {
    // 玩家：看自己
    rows = await env.DB.prepare(
      'SELECT * FROM bookings WHERE player_id = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(sess.player_id).all();
    return ok({ bookings: rows.results, role: 'player' });
  }
  return err(401, 'Session 无效');
}
