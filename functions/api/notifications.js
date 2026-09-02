// v47: 站内通知 API
// GET    /api/notifications?my=1&unread=1   - 我的通知
// PATCH  /api/notifications?id=X&action=read   - 标记已读
// PATCH  /api/notifications?action=read-all     - 全部已读

import { ok, err, readToken, getSession } from '../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  if (url.searchParams.get('my') !== '1') return err(400, '仅支持 my=1');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录');

  const unreadOnly = url.searchParams.get('unread') === '1';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const rows = unreadOnly
    ? await env.DB.prepare(
        `SELECT id, type, title, body, link, read_at, created_at FROM notification_log
         WHERE player_id = ? AND read_at IS NULL
         ORDER BY created_at DESC LIMIT ?`
      ).bind(sess.player_id, limit).all()
    : await env.DB.prepare(
        `SELECT id, type, title, body, link, read_at, created_at FROM notification_log
         WHERE player_id = ?
         ORDER BY created_at DESC LIMIT ?`
      ).bind(sess.player_id, limit).all();

  const unreadCount = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notification_log WHERE player_id = ? AND read_at IS NULL'
  ).bind(sess.player_id).first();
  return ok({ notifications: rows.results, unread_count: unreadCount?.n || 0 });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录');
  const url = new URL(request.url);

  if (url.searchParams.get('action') === 'read-all') {
    await env.DB.prepare(
      `UPDATE notification_log SET read_at = datetime('now')
       WHERE player_id = ? AND read_at IS NULL`
    ).bind(sess.player_id).run();
    return ok({ read_all: true });
  }

  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare(
    `UPDATE notification_log SET read_at = datetime('now')
     WHERE id = ? AND player_id = ? AND read_at IS NULL`
  ).bind(id, sess.player_id).run();
  return ok({ id, read: true });
}
