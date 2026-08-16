// GET    /api/admin/messages              - 管理员看所有留言
// PATCH  /api/admin/messages?id=X         - 修改 status 或 admin_reply
// DELETE /api/admin/messages?id=X         - 删除留言
import { ok, err, readToken, getSession, stripHtml, isNonEmpty } from '../../_shared.js';

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
  const status = url.searchParams.get('status');
  let rows;
  if (status) {
    rows = await env.DB.prepare(
      'SELECT m.*, p.username as player_username FROM messages m LEFT JOIN players p ON p.id = m.player_id WHERE m.status = ? ORDER BY m.created_at DESC'
    ).bind(status).all();
  } else {
    rows = await env.DB.prepare(
      'SELECT m.*, p.username as player_username FROM messages m LEFT JOIN players p ON p.id = m.player_id ORDER BY m.created_at DESC LIMIT 200'
    ).all();
  }
  return ok({ messages: rows.results });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');

  let body = {};
  try { body = await request.json(); } catch (e) { /* no body */ }

  const status = url.searchParams.get('status');
  const reply  = body.admin_reply;

  // 改 status
  if (status && ['new', 'read', 'done'].includes(status)) {
    await env.DB.prepare('UPDATE messages SET status = ? WHERE id = ?').bind(status, id).run();
  }
  // 改 admin_reply（v16：支持 admin 回复玩家留言）
  if (typeof reply === 'string') {
    const cleaned = stripHtml(reply);
    if (cleaned.length > 0) {
      if (cleaned.length > 2000) return err(400, '回复内容不能超过 2000 字符');
      await env.DB.prepare(
        "UPDATE messages SET admin_reply = ?, replied_at = datetime('now'), replied_by = ? WHERE id = ?"
      ).bind(cleaned, admin.id, id).run();
    } else {
      // 空字符串 = 清除回复
      await env.DB.prepare(
        'UPDATE messages SET admin_reply = NULL, replied_at = NULL, replied_by = NULL WHERE id = ?'
      ).bind(id).run();
    }
  }
  if (!status && typeof reply !== 'string') return err(400, '无更新字段');
  return ok({ id });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
