// v50: 酒店预订 API (公开 POST / 玩家 my=1 鉴权)
import { ok, err, handleOptions, getSession, readToken, stripHtml, isNonEmpty, ticketFromBooking } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录玩家账号');

  const body = await request.json().catch(() => ({}));
  const name = stripHtml(body.name || '').trim();
  const contact = stripHtml(body.contact || '').trim();
  if (!isNonEmpty(name, 50) || !isNonEmpty(contact, 100)) return err(400, 'name/contact 必填');
  if (!body.in_date || !body.out_date) return err(400, 'in_date/out_date 必填');
  const inD = new Date(body.in_date);
  const outD = new Date(body.out_date);
  if (isNaN(inD) || isNaN(outD) || outD <= inD) return err(400, '日期格式错或退房日期需晚于入住');
  const nights = Math.max(1, Math.round((outD - inD) / 86400000));

  const r = await env.DB.prepare(
    `INSERT INTO bookings (player_id, room_id, room_name, in_date, out_date, nights, persons, breakfast, name, contact, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    sess.player_id,
    String(body.room_id || ''),
    stripHtml(body.room_name || ''),
    body.in_date, body.out_date, nights,
    Number(body.persons) || 1,
    body.breakfast ? 1 : 0,
    name, contact,
    stripHtml(body.note || ''),
  ).run();
  const bookingId = r.meta?.last_row_id;

  // 双写 ticket
  await ticketFromBooking(env, { player_id: sess.player_id, room_name: body.room_name, name, contact, in_date: body.in_date, out_date: body.out_date, nights, persons: body.persons, breakfast: body.breakfast, note: body.note }, bookingId);

  return ok({ id: bookingId, nights, created: true });
}
