// v50: 卡丁车试跑报名 API (公开 POST / 玩家 my=1)
import { ok, err, handleOptions, getSession, readToken, stripHtml, ticketFromKart } from '../_shared.js';

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
    'INSERT INTO kart_signups (player_id, name, contact, session, car, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    sess.player_id, name, contact,
    stripHtml(body.session || ''),
    Number(body.car) || null,
    stripHtml(body.note || ''),
  ).run();
  await ticketFromKart(env, { player_id: sess.player_id, name, contact, session: body.session, car: body.car, note: body.note }, r.meta?.last_row_id);
  return ok({ id: r.meta?.last_row_id, created: true });
}
