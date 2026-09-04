// v50: 公共留言 API (公开 GET / 玩家 POST / 玩家 my=1 鉴权 / AI 自动回复)
import { ok, err, handleOptions, getSession, readToken, stripHtml, isNonEmpty, ticketFromMessage } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

  if (url.searchParams.get('my') === '1') {
    const sess = await getSession(env, readToken(request));
    if (!sess?.player_id) return err(401, '请先登录玩家账号');
    const rows = await env.DB.prepare(
      'SELECT id, player_id, name, contact, content, status, admin_reply, replied_at, created_at FROM messages WHERE player_id = ? ORDER BY created_at DESC LIMIT 50'
    ).bind(sess.player_id).all();
    return ok({ messages: rows.results || [] });
  }

  const rows = await env.DB.prepare(
    'SELECT id, player_id, name, contact, content, status, admin_reply, replied_at, created_at FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all();
  return ok({ messages: rows.results || [], limit, offset });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录玩家账号');

  const body = await request.json().catch(() => ({}));
  const name = stripHtml(body.name || '').trim() || '匿名市民';
  const contact = stripHtml(body.contact || '').trim();
  const content = stripHtml(body.content || '').trim();
  if (!isNonEmpty(content, 2000)) return err(400, '留言内容不能为空');

  const ins = await env.DB.prepare(
    'INSERT INTO messages (player_id, name, contact, content) VALUES (?, ?, ?, ?)'
  ).bind(sess.player_id, name, contact, content).run();
  const msgId = ins.meta?.last_row_id;

  // 双写 ticket (admin 后台统一管理)
  await ticketFromMessage(env, { player_id: sess.player_id, title: content.slice(0, 30), content }, msgId);

  // AI 自动回复 (如果启用)
  let aiReply = null;
  try {
    const { aiAutoReply } = await import('../_shared/ai.js');
    aiReply = await aiAutoReply({ name, content });
  } catch (e) { /* AI 失败不影响主流程 */ }

  if (aiReply) {
    await env.DB.prepare(
      "UPDATE messages SET admin_reply = ?, replied_at = datetime('now'), status = 'done' WHERE id = ?"
    ).bind(aiReply, msgId).run();
  }

  return ok({ id: msgId, created: true, ai_reply: aiReply });
}
