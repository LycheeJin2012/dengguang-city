// POST /api/circuit  - 国际赛车场试车报名（需登录玩家）
// GET  /api/circuit  - 当前玩家所有国际赛车场试车 (profile 页用)
import { ok, err, stripHtml, readToken, getSession } from '../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');
  const rows = await env.DB.prepare(
    'SELECT id, name, contact, note, created_at FROM circuit_signups WHERE player_id = ? ORDER BY created_at DESC LIMIT 30'
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
  const note = stripHtml(body.note || '').trim();
  if (!name || !contact) return err(400, '姓名/联系方式必填');

  const ins = await env.DB.prepare(
    'INSERT INTO circuit_signups (player_id, name, contact, note) VALUES (?, ?, ?, ?)'
  ).bind(sess.player_id, name, contact, note || null).run();

  return ok({ id: ins.meta.last_row_id });
}
