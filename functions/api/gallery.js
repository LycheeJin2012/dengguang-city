// v18: 首页图集管理 API
// GET    /api/gallery                    - 公开: 列出所有 (首页用)
// GET    /api/gallery?cat=city&featured=1 - 公开: 分类过滤
// GET    /api/gallery?all=1              - 管理员: 含草稿
// POST   /api/gallery                    - 管理员: 新增
// PATCH  /api/gallery?id=X               - 管理员: 编辑
// DELETE /api/gallery?id=X               - 管理员: 删除
import { ok, err, stripHtml, isNonEmpty, readToken, getSession } from '../_shared.js';

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
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const cat = url.searchParams.get('cat') || '';
  const featured = url.searchParams.get('featured') || '';
  const all = url.searchParams.get('all') || '';
  // all=1 仅 super 可用 (含草稿)
  if (all === '1') {
    const me = await requireSuper(context);
    if (!me) return err(403, '需要 super 权限');
  }
  let where = 'WHERE 1=1';
  const params = [];
  if (cat) { where += ' AND cat = ?'; params.push(cat); }
  if (featured === '1') { where += ' AND is_featured = 1'; }
  if (all !== '1') { where += ' AND is_published = 1'; }
  const rows = await env.DB.prepare(
    `SELECT id, num, cat, label, file_url, sort_order, is_featured, is_published, created_at, updated_at
     FROM gallery_items ${where} ORDER BY cat, sort_order, num`
  ).bind(...params).all();
  return ok({ items: rows.results || [] });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const me = await requireSuper(context);
  if (!me) return err(403, '需要 super 权限');
  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }
  const num = parseInt(body.num || 0, 10);
  const cat = stripHtml(body.cat || '').trim();
  const label = stripHtml(body.label || '').trim();
  const fileUrl = (body.file_url || '').toString().trim();
  const sortOrder = parseInt(body.sort_order || 0, 10);
  const isFeatured = body.is_featured ? 1 : 0;
  const isPublished = body.is_published === false ? 0 : 1;
  if (!num || num < 1 || num > 999) return err(400, 'num 必须是 1-999 数字 (图片显示顺序)');
  if (!['city', 'road', 'kart', 'nature', 'announcement'].includes(cat)) return err(400, 'cat 必须是 city/road/kart/nature/announcement');
  if (!isNonEmpty(label, 80)) return err(400, 'label 必填, 80 字内');
  if (!isNonEmpty(fileUrl, 2000)) return err(400, 'file_url 必填 (https:// 开头)');
  // 简单 URL 格式校验
  if (!/^https?:\/\//i.test(fileUrl) && !/^data:image\//i.test(fileUrl)) {
    return err(400, 'file_url 必须是 https:// 或 data:image/ 开头');
  }
  try {
    const ins = await env.DB.prepare(
      `INSERT INTO gallery_items (num, cat, label, file_url, sort_order, is_featured, is_published, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(num, cat, label, fileUrl, sortOrder, isFeatured, isPublished, me.id).run();
    return ok({ id: ins.meta.last_row_id });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return err(409, '编号 ' + num + ' 已存在, 请换一个');
    return err(500, '写入失败: ' + e.message);
  }
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const me = await requireSuper(context);
  if (!me) return err(403, '需要 super 权限');
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }
  const sets = [];
  const params = [];
  const allowed = ['label', 'file_url', 'cat', 'sort_order', 'is_featured', 'is_published', 'num'];
  for (const k of allowed) {
    if (body[k] !== undefined) {
      if (k === 'num') {
        const n = parseInt(body[k], 10);
        if (!n || n < 1) return err(400, 'num 必须是正整数');
        sets.push('num = ?'); params.push(n);
      } else if (k === 'sort_order') {
        sets.push('sort_order = ?'); params.push(parseInt(body[k], 10) || 0);
      } else if (k === 'is_featured' || k === 'is_published') {
        sets.push(k + ' = ?'); params.push(body[k] ? 1 : 0);
      } else {
        sets.push(k + ' = ?'); params.push(stripHtml(String(body[k])).trim());
      }
    }
  }
  if (sets.length === 0) return err(400, '无字段更新');
  sets.push('updated_at = datetime(\'now\')');
  params.push(id);
  try {
    await env.DB.prepare('UPDATE gallery_items SET ' + sets.join(', ') + ' WHERE id = ?').bind(...params).run();
    return ok({ id });
  } catch (e) {
    return err(500, '更新失败: ' + e.message);
  }
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const me = await requireSuper(context);
  if (!me) return err(403, '需要 super 权限');
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM gallery_items WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
