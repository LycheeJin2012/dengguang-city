// POST /api/license - 玩家报名驾照考试（需玩家登录）
// GET  /api/license - 列出自己（或 admin 看全部）的报名
import { ok, err, stripHtml, isNonEmpty, readToken, getSession } from '../_shared.js';
import { ticketFromLicense } from '../_shared/tickets.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess) return err(401, '请先登录玩家账号');

  // admin 看全部，player 看自己
  if (sess.admin_id) {
    const rows = await env.DB.prepare(
      `SELECT l.*, p.username as player_username, p.avatar_emoji, a.username as reviewer
       FROM license_signups l
       LEFT JOIN players p ON p.id = l.player_id
       LEFT JOIN admins a ON a.id = l.result_by
       ORDER BY l.created_at DESC LIMIT 200`
    ).all();
    return ok({ signups: rows.results });
  } else {
    const rows = await env.DB.prepare(
      `SELECT l.*, p.username as player_username
       FROM license_signups l
       LEFT JOIN players p ON p.id = l.player_id
       WHERE l.player_id = ?
       ORDER BY l.created_at DESC LIMIT 50`
    ).bind(sess.player_id).all();
    return ok({ signups: rows.results });
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');

  let body = {};
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }

  const examType   = stripHtml(body.exam_type || '').trim();  // 'written' | 'road' | 'upgrade'
  const examDate   = stripHtml(body.exam_date || '').trim();
  const examSession= stripHtml(body.exam_session || '').trim();
  const contact    = stripHtml(body.contact || '').trim();
  const note       = stripHtml(body.note || '').trim();

  if (!['written', 'road', 'upgrade'].includes(examType)) {
    return err(400, '考试类型必须为 written/road/upgrade');
  }
  if (!isNonEmpty(contact, 200)) return err(400, '请填写联系方式');
  if (note.length > 500) return err(400, '备注太长（500 字以内）');

  // 防止同一玩家同类型重复报名（pending 才算重）
  const dup = await env.DB.prepare(
    "SELECT id FROM license_signups WHERE player_id = ? AND exam_type = ? AND status = 'pending'"
  ).bind(sess.player_id, examType).first();
  if (dup) return err(409, '你已报名同类型的考试，等候结果中');

  const ins = await env.DB.prepare(
    'INSERT INTO license_signups (player_id, exam_type, exam_date, exam_session, contact, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sess.player_id, examType, examDate || null, examSession || null, contact, note || null).run();
  const lsId = ins.meta.last_row_id;

  // v47: 双写 ticket
  await ticketFromLicense(env, {
    player_id: sess.player_id, exam_type: examType, exam_date: examDate,
    exam_session: examSession, contact, name: sess.username, note,
  }, lsId);

  return ok({
    id: lsId,
    exam_type: examType,
    status: 'pending',
    message: '报名已提交，等市政厅审核'
  });
}
