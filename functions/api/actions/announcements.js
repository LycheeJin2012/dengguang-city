// v44 重写: 公告管理 (super only)
// 路由: POST /api/init?action=announcement-create | announcement-update | announcement-delete
import { ok, err, readToken, getSession, stripHtml } from '../../_shared.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // 所有公告 action 都需要 super 权限
  const token = readToken(request);
  if (!token) return err(401, '需要管理员登录');
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return err(403, '需要管理员权限');
  if (new Date(sess.expires_at) <= new Date()) return err(401, '会话已过期');
  const me = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(sess.admin_id).first();
  if (!me || me.role !== 'super') return err(403, '只有 super 管理员可操作公告');

  if (action === 'announcement-delete') {
    const id = parseInt(url.searchParams.get('id') || '0', 10);
    if (!id) return err(400, 'id 必填');
    try {
      await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
      return ok({ id, deleted: true });
    } catch (e) { return err(500, '删除失败: ' + e.message); }
  }

  // create / update 共用字段验证
  const body = await request.json().catch(() => ({}));
  const title = stripHtml((body.title || '').toString()).trim();
  const content = stripHtml((body.content || '').toString()).trim();
  const image_url = (body.image_url || '').toString().trim();
  if (title.length < 2 || title.length > 80) return err(400, '标题 2-80 字');
  if (content.length < 2 || content.length > 2000) return err(400, '内容 2-2000 字');
  if (image_url && !/^https?:\/\//i.test(image_url) && !/^data:image\//i.test(image_url)) {
    return err(400, '封面图必须是 https:// 或 data:image/ 开头');
  }

  if (action === 'announcement-create') {
    try {
      const r = await env.DB.prepare(
        "INSERT INTO announcements (title, content, image_url, created_by) VALUES (?, ?, ?, ?)"
      ).bind(title, content, image_url || null, me.id).run();
      return ok({ id: r.meta.last_row_id, ok: true });
    } catch (e) { return err(500, '发布失败: ' + e.message); }
  }

  if (action === 'announcement-update') {
    const id = parseInt(url.searchParams.get('id') || '0', 10);
    if (!id) return err(400, 'id 必填');
    try {
      await env.DB.prepare(
        "UPDATE announcements SET title = ?, content = ?, image_url = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(title, content, image_url || null, id).run();
      return ok({ id, ok: true });
    } catch (e) { return err(500, '更新失败: ' + e.message); }
  }

  return err(404, '未知 announcement action: ' + action);
}
