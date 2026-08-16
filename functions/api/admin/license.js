// GET    /api/admin/license              - 管理员看所有驾照考试报名
// PATCH  /api/admin/license?id=X          - 改考试结果（pass/fail）+ result_note
// DELETE /api/admin/license?id=X          - 删除报名
import { ok, err, readToken, getSession, stripHtml } from '../../_shared.js';

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

  const rows = await env.DB.prepare(
    `SELECT l.*, p.username as player_username, a.username as reviewer
     FROM license_signups l
     LEFT JOIN players p ON p.id = l.player_id
     LEFT JOIN admins a ON a.id = l.result_by
     ORDER BY
       CASE l.status WHEN 'pending' THEN 0 WHEN 'passed' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
       l.created_at DESC LIMIT 300`
  ).all();
  return ok({ signups: rows.results });
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

  const result  = body.result;  // 'pass' | 'fail'
  const note    = body.result_note;
  if (!['pass', 'fail'].includes(result)) return err(400, 'result 必须为 pass 或 fail');

  const cleanedNote = note ? stripHtml(note) : null;
  const newStatus = result === 'pass' ? 'passed' : 'failed';

  await env.DB.prepare(
    "UPDATE license_signups SET status = ?, result_note = ?, result_at = datetime('now'), result_by = ? WHERE id = ?"
  ).bind(newStatus, cleanedNote, admin.id, id).run();

  return ok({ id, status: newStatus });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM license_signups WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
