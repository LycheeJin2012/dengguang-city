// POST /api/comments - 玩家评论某条留言
// GET  /api/comments?message_id=X - 列出某条留言的所有评论
// DELETE /api/comments?id=X - 评论作者本人或 admin 可删
import { ok, err, stripHtml, isNonEmpty, readToken, getSession } from '../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const messageId = parseInt(url.searchParams.get('message_id') || '0', 10);
  if (!messageId) return err(400, 'message_id 必填');

  const rows = await env.DB.prepare(
    `SELECT c.id, c.message_id, c.player_id, c.content, c.created_at, p.username, p.avatar_emoji
     FROM message_comments c
     LEFT JOIN players p ON p.id = c.player_id
     WHERE c.message_id = ?
     ORDER BY c.created_at ASC LIMIT 100`
  ).bind(messageId).all();
  return ok({ comments: rows.results });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');

  let body = {};
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }

  const messageId = parseInt(body.message_id || '0', 10);
  const content    = stripHtml(body.content || '').trim();
  if (!messageId) return err(400, 'message_id 必填');
  if (!isNonEmpty(content, 1000)) return err(400, '评论内容不能为空（1-1000 字符）');

  // 确认留言存在
  const exists = await env.DB.prepare('SELECT id FROM messages WHERE id = ?').bind(messageId).first();
  if (!exists) return err(404, '留言不存在');

  const ins = await env.DB.prepare(
    'INSERT INTO message_comments (message_id, player_id, content) VALUES (?, ?, ?)'
  ).bind(messageId, sess.player_id, content).run();

  return ok({ id: ins.meta.last_row_id, message_id: messageId });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess) return err(401, '请先登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');

  const c = await env.DB.prepare('SELECT player_id FROM message_comments WHERE id = ?').bind(id).first();
  if (!c) return err(404, '评论不存在');
  // 仅作者本人或 admin 可删
  if (c.player_id !== sess.player_id && !sess.admin_id) {
    return err(403, '无权删除');
  }
  await env.DB.prepare('DELETE FROM message_comments WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
