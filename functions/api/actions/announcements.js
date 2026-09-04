// v50: 公告 (admin 鉴权 POST/PATCH/DELETE)
import { ok, err, getSession, readToken, stripHtml, isNonEmpty } from '../_helpers.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员登录');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'create';
  const body = await request.json().catch(() => ({}));
  if (action === 'create') {
    const title = stripHtml(body.title || '').trim();
    const content = stripHtml(body.content || '').trim();
    if (!isNonEmpty(title) || !isNonEmpty(content)) return err(400, 'title/content 必填');
    const r = await env.DB.prepare(
      'INSERT INTO announcements (title, content, image_url, is_pinned, created_by) VALUES (?, ?, ?, ?, ?)'
    ).bind(title, content, body.image_url || null, body.is_pinned ? 1 : 0, sess.admin_id).run();
    return ok({ id: r.meta?.last_row_id, created: true });
  }
  return err(400, '未知 action');
}
