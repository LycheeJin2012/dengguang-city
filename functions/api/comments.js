// v50: 留言评论 (公开 GET / 玩家 POST)
import { ok, err, handleOptions, getSession, readToken, stripHtml, isNonEmpty } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const messageId = new URL(request.url).searchParams.get('message_id');
  if (!messageId) return err(400, 'message_id 必填');
  const rows = await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, c.player_id, p.username, p.avatar_emoji
     FROM message_comments c LEFT JOIN players p ON p.id = c.player_id
     WHERE c.message_id = ? ORDER BY c.created_at ASC`
  ).bind(messageId).all();
  return ok({ comments: rows.results || [] });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');
  const body = await request.json().catch(() => ({}));
  const text = stripHtml(body.body || '');
  if (!isNonEmpty(text, 1000)) return err(400, '评论内容 1-1000 字');
  if (!body.message_id) return err(400, 'message_id 必填');
  const r = await env.DB.prepare(
    'INSERT INTO message_comments (message_id, player_id, body) VALUES (?, ?, ?)'
  ).bind(body.message_id, sess.player_id, text).run();
  return ok({ id: r.meta?.last_row_id, created: true });
}
