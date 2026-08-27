// GET  /api/messages  - 公开留言列表
// GET  /api/messages?my=1  - 当前登录玩家的所有留言 (profile 页用)
// POST /api/messages  - 提交留言（需登录玩家）→ 自动 AI 回复
import { ok, err, stripHtml, isNonEmpty, readToken, getSession, aiAutoReply } from '../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = if (!env.DB) return err(500, 'D1 binding DB not configured');

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

  // v37.7: my=1 拉当前玩家所有留言 (profile 页用, 需登录鉴权)
  if (url.searchParams.get('my') === '1') {
    const token = readToken(request);
    const sess = await getSession(env, token);
    if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');
    const rows = await env.DB.prepare(
      'SELECT id, player_id, name, contact, content, status, admin_reply, replied_at, created_at FROM messages WHERE player_id = ? ORDER BY created_at DESC LIMIT 50'
    ).bind(sess.player_id).all();
    return ok({ messages: rows.results });
  }

  const rows = await env.DB.prepare(
    'SELECT id, player_id, name, contact, content, status, admin_reply, replied_at, created_at FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all();

  return ok({ messages: rows.results, limit, offset });
}

export async function onRequestPost(context) {
  const { env, request } = if (!env.DB) return err(500, 'D1 binding DB not configured');

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
  const msgId = ins.meta.last_row_id;

  // AI 自动回复（失败不阻塞主流程）
  let aiReplied = false;
  try {
    const draft = await aiAutoReply(env, content, 'message');
    if (draft) {
      await env.DB.prepare(
        "UPDATE messages SET admin_reply = ?, replied_at = datetime('now') WHERE id = ?"
      ).bind('🤖 ' + draft, msgId).run();
      aiReplied = true;
    }
  } catch (e) { /* 忽略 AI 失败 */ }

  return ok({ id: msgId, name, content, ai_replied: aiReplied });
}
