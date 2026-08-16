// GET  /api/messages  - 公开留言列表
// POST /api/messages  - 提交留言（需登录玩家）
import { ok, err, stripHtml, isNonEmpty, readToken, getSession } from '../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

  const rows = await env.DB.prepare(
    'SELECT id, player_id, name, contact, content, status, admin_reply, replied_at, created_at FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all();

  return ok({ messages: rows.results, limit, offset });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  // 玩家登录后才能留言（可改成匿名，但反垃圾更难）
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess) return err(401, '请先登录玩家账号');

  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }
  const name = stripHtml(body.name || '').trim() || '匿名市民';
  const contact = stripHtml(body.contact || '').trim();
  const content = stripHtml(body.content || '').trim();
  if (!isNonEmpty(content, 2000)) return err(400, '留言内容不能为空');

  const ins = await env.DB.prepare(
    'INSERT INTO messages (player_id, name, contact, content) VALUES (?, ?, ?, ?)'
  ).bind(sess.player_id, name, contact || null, content).run();

  return ok({ id: ins.meta.last_row_id, name, content });
}
