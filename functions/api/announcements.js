// v17.8: 市政公告 API
// GET    /api/announcements            - 公开(首页展示,所有人可读)
// POST   /api/announcements            - 仅 super 管理员
// PATCH  /api/announcements?id=X       - 仅 super 管理员
// DELETE /api/announcements?id=X       - 仅 super 管理员
import { ok, err, readToken, getSession, stripHtml, isNonEmpty } from '../_shared.js';

async function requireSuper(context) {
  const { env, request } = context;
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return null;
  const admin = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(sess.admin_id).first();
  if (!admin || admin.role !== 'super') return null;
  return admin;
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  try {
    // 公开:按 created_at desc 倒序,前 30 条
    const rows = await env.DB.prepare(
      'SELECT a.*, ad.username as admin_username FROM announcements a LEFT JOIN admins ad ON ad.id = a.created_by ORDER BY a.created_at DESC LIMIT 30'
    ).all();
    return ok({ announcements: rows.results || [] });
  } catch (e) {
    return err(500, '查询失败: ' + e.message);
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireSuper(context);
  if (!admin) return err(403, '只有 super 管理员可发布公告');

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const title = stripHtml((body.title || '').toString()).trim();
  const content = stripHtml((body.content || '').toString()).trim();

  if (!title || title.length < 2) return err(400, '标题至少 2 字');
  if (title.length > 80) return err(400, '标题不超过 80 字');
  if (!content || content.length < 2) return err(400, '内容至少 2 字');
  if (content.length > 2000) return err(400, '内容不超过 2000 字');

  try {
    const result = await env.DB.prepare(
      "INSERT INTO announcements (title, content, created_by) VALUES (?, ?, ?)"
    ).bind(title, content, admin.id).run();
    return ok({ id: result.meta.last_row_id, ok: true });
  } catch (e) {
    return err(500, '发布失败: ' + e.message);
  }
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireSuper(context);
  if (!admin) return err(403, '只有 super 管理员可编辑公告');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const updates = [];
  const vals = [];
  if (typeof body.title === 'string') {
    const t = stripHtml(body.title).trim();
    if (t.length < 2 || t.length > 80) return err(400, '标题 2-80 字');
    updates.push('title = ?'); vals.push(t);
  }
  if (typeof body.content === 'string') {
    const c = stripHtml(body.content).trim();
    if (c.length < 2 || c.length > 2000) return err(400, '内容 2-2000 字');
    updates.push('content = ?'); vals.push(c);
  }
  if (!updates.length) return err(400, '无更新字段');
  updates.push("updated_at = datetime('now')");
  vals.push(id);

  try {
    await env.DB.prepare(`UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
    return ok({ id, ok: true });
  } catch (e) {
    return err(500, '更新失败: ' + e.message);
  }
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireSuper(context);
  if (!admin) return err(403, '只有 super 管理员可删除公告');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');

  try {
    await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
    return ok({ id, deleted: true });
  } catch (e) {
    return err(500, '删除失败: ' + e.message);
  }
}
