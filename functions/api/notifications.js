// v50: 通知 log (玩家鉴权)
import { ok, err, handleOptions, getSession, readToken } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');
  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get('unread') === '1';
  const where = unreadOnly ? 'WHERE player_id = ? AND is_read = 0' : 'WHERE player_id = ?';
  const rows = await env.DB.prepare(`SELECT id, topic, payload, is_read, created_at FROM notification_log ${where} ORDER BY created_at DESC LIMIT 100`).bind(sess.player_id).all();
  return ok({ notifications: rows.results || [] });
}

export async function onRequestPost(context) {
  // 内部用: 推一条通知给 player
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员');
  const body = await request.json().catch(() => ({}));
  if (!body.player_id || !body.topic) return err(400, 'player_id/topic 必填');
  await env.DB.prepare(
    'INSERT INTO notification_log (player_id, topic, payload) VALUES (?, ?, ?)'
  ).bind(body.player_id, body.topic, JSON.stringify(body.payload || {})).run();
  return ok({ sent: true });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');
  await env.DB.prepare('UPDATE notification_log SET is_read = 1 WHERE player_id = ? AND is_read = 0').bind(sess.player_id).run();
  return ok({ marked: true });
}
