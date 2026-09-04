// v50: 驾照考试报名 API
import { ok, err, handleOptions, getSession, readToken, stripHtml, ticketFromLicense } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录玩家账号');

  const body = await request.json().catch(() => ({}));
  const name = stripHtml(body.name || '').trim();
  const contact = stripHtml(body.contact || '').trim();
  if (!name || !contact) return err(400, 'name/contact 必填');

  const r = await env.DB.prepare(
    'INSERT INTO license_signups (player_id, name, contact, exam_type, exam_date, exam_session, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    sess.player_id, name, contact,
    stripHtml(body.exam_type || ''),
    body.exam_date || null,
    stripHtml(body.exam_session || ''),
    stripHtml(body.note || ''),
  ).run();
  await ticketFromLicense(env, { player_id: sess.player_id, name, contact, exam_type: body.exam_type, exam_date: body.exam_date, exam_session: body.exam_session, note: body.note }, r.meta?.last_row_id);
  return ok({ id: r.meta?.last_row_id, created: true });
}
