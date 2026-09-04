// v50: 国际赛车场试车报名 API
import { ok, err, handleOptions, getSession, readToken, stripHtml, ticketFromCircuit } from '../_shared.js';

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
    'INSERT INTO circuit_signups (player_id, name, contact, license, track_id, session, car, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    sess.player_id, name, contact,
    stripHtml(body.license || ''),
    Number(body.track_id) || null,
    stripHtml(body.session || ''),
    Number(body.car) || null,
    stripHtml(body.note || ''),
  ).run();
  await ticketFromCircuit(env, { player_id: sess.player_id, name, contact, session: body.session, car: body.car, license: body.license, note: body.note }, r.meta?.last_row_id);
  return ok({ id: r.meta?.last_row_id, created: true });
}
