// v50: 公告 API (公开 GET / 玩家 POST / admin 鉴权 POST/PATCH/DELETE)
import { ok, err, handleOptions, getSession, readToken, stripHtml, isNonEmpty } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const rows = await env.DB.prepare(
    `SELECT id, title, content, image_url, is_pinned, created_at, updated_at
     FROM announcements ORDER BY is_pinned DESC, created_at DESC LIMIT ?`
  ).bind(limit).all();
  return ok({ announcements: rows.results || [] }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员登录');
  const body = await request.json().catch(() => ({}));
  const title = stripHtml(body.title || '').trim();
  const content = stripHtml(body.content || '').trim();
  if (!isNonEmpty(title, 200) || !isNonEmpty(content, 10000)) return err(400, 'title/content 必填');
  const r = await env.DB.prepare(
    'INSERT INTO announcements (title, content, image_url, is_pinned, created_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(title, content, body.image_url || null, body.is_pinned ? 1 : 0, sess.admin_id).run();
  return ok({ id: r.meta?.last_row_id, created: true });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员登录');
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  const body = await request.json().catch(() => ({}));
  const sets = []; const binds = [];
  if (body.title !== undefined) { sets.push('title = ?'); binds.push(stripHtml(body.title)); }
  if (body.content !== undefined) { sets.push('content = ?'); binds.push(stripHtml(body.content)); }
  if (body.image_url !== undefined) { sets.push('image_url = ?'); binds.push(body.image_url); }
  if (body.is_pinned !== undefined) { sets.push('is_pinned = ?'); binds.push(body.is_pinned ? 1 : 0); }
  if (!sets.length) return err(400, '没有可更新字段');
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  await env.DB.prepare(`UPDATE announcements SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return ok({ id, updated: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员登录');
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
  return ok({ id, deleted: true });
}
