// v50: 图集 API (公开 GET / admin POST/PATCH/DELETE)
import { ok, err, handleOptions, getSession, readToken, stripHtml } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '60', 10), 200);
  const category = url.searchParams.get('category') || '';
  let rows;
  if (category) {
    rows = await env.DB.prepare(
      `SELECT id, title, category, url, thumb, sort_order, created_at FROM gallery_items
       WHERE category = ? AND is_published = 1 ORDER BY sort_order, id DESC LIMIT ?`
    ).bind(category, limit).all();
  } else {
    rows = await env.DB.prepare(
      `SELECT id, title, category, url, thumb, sort_order, created_at FROM gallery_items
       WHERE is_published = 1 ORDER BY sort_order, id DESC LIMIT ?`
    ).bind(limit).all();
  }
  return ok({ gallery: rows.results || [] }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员登录');
  const body = await request.json().catch(() => ({}));
  if (!body.url) return err(400, 'url 必填');
  const r = await env.DB.prepare(
    'INSERT INTO gallery_items (title, category, url, thumb, is_published, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(stripHtml(body.title || ''), stripHtml(body.category || ''), body.url, body.thumb || null, body.is_published === false ? 0 : 1, body.sort_order || 0).run();
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
  for (const f of ['title', 'category']) if (body[f] !== undefined) { sets.push(`${f} = ?`); binds.push(stripHtml(body[f])); }
  for (const f of ['url', 'thumb']) if (body[f] !== undefined) { sets.push(`${f} = ?`); binds.push(body[f]); }
  if (body.is_published !== undefined) { sets.push('is_published = ?'); binds.push(body.is_published ? 1 : 0); }
  if (body.sort_order !== undefined) { sets.push('sort_order = ?'); binds.push(body.sort_order); }
  if (!sets.length) return err(400, '没有可更新字段');
  binds.push(id);
  await env.DB.prepare(`UPDATE gallery_items SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return ok({ id, updated: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员登录');
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM gallery_items WHERE id = ?').bind(id).run();
  return ok({ id, deleted: true });
}
