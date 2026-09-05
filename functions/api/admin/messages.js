// v50: admin 留言管理 (老 messages 表专用 — admin tickets tab 也 UNION 了这些)
// API 路径稳定; admin tickets tab 在前端 UNION 了这个老 messages 表
import { ok, err, handleOptions, requireAdmin, stripHtml, parseListParams } from './_helpers.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const p = parseListParams(request);
  const where = []; const binds = [];
  if (p.status) { where.push('m.status = ?'); binds.push(p.status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await env.DB.prepare(
    `SELECT m.*, p.username AS player_username, p.avatar_emoji
     FROM messages m LEFT JOIN players p ON p.id = m.player_id
     ${whereSql} ORDER BY m.created_at DESC LIMIT ?`
  ).bind(...binds, p.limit).all();
  return ok({ messages: rows.results || [] }, { headers: { 'Cache-Control': 'private, max-age=10' } });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  const body = await request.json().catch(() => ({}));
  const sets = []; const binds = [];
  if (body.status && ['unread', 'read', 'done'].includes(body.status)) {
    sets.push('status = ?'); binds.push(body.status);
  }
  if (typeof body.admin_reply === 'string' && body.admin_reply.length > 0) {
    sets.push('admin_reply = ?'); binds.push(stripHtml(body.admin_reply));
    sets.push('replied_at = ?'); binds.push(new Date().toISOString());
    if (!body.status) { sets.push('status = ?'); binds.push('done'); }
  }
  if (!sets.length) return err(400, '没有可更新字段');
  binds.push(id);
  await env.DB.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return ok({ id, updated: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return ok({ id, deleted: true });
}
