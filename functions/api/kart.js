// POST /api/kart  - 卡丁车试跑报名（需登录玩家）
// GET  /api/kart  - 当前玩家所有卡丁车试跑 (profile 页用)
import { ok, err, stripHtml, readToken, getSession } from '../_shared.js';
import { ticketFromKart } from '../_shared/tickets.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');
  const rows = await env.DB.prepare(
    'SELECT id, session, car, name, contact, note, created_at FROM kart_signups WHERE player_id = ? ORDER BY created_at DESC LIMIT 30'
  ).bind(sess.player_id).all();
  return ok({ signups: rows.results });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess) return err(401, '请先登录玩家账号');

  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }

  const name = stripHtml(body.name || '').trim();
  const contact = stripHtml(body.contact || '').trim();
  const session = stripHtml(body.session || '').trim();
  const car = stripHtml(body.car || '').trim();
  const note = stripHtml(body.note || '').trim();
  if (!name || !contact) return err(400, '姓名/联系方式必填');

  const ins = await env.DB.prepare(
    'INSERT INTO kart_signups (player_id, session, car, name, contact, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sess.player_id, session || null, car || null, name, contact, note || null).run();
  const ksId = ins.meta.last_row_id;

  // v47: 双写 ticket
  await ticketFromKart(env, {
    player_id: sess.player_id, session, car, name, contact, note,
  }, ksId);

  return ok({ id: ksId });
}
