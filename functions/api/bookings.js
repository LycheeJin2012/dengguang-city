// POST /api/bookings  - 房间预订（需登录玩家）
// GET  /api/bookings  - 当前玩家所有酒店预订 (profile 页用)
import { ok, err, stripHtml, readToken, getSession } from '../_shared.js';
import { ticketFromBooking } from '../_shared/tickets.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');
  const rows = await env.DB.prepare(
    'SELECT id, room_id, room_name, in_date, out_date, nights, persons, breakfast, status, created_at FROM bookings WHERE player_id = ? ORDER BY created_at DESC LIMIT 30'
  ).bind(sess.player_id).all();
  return ok({ bookings: rows.results });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess) return err(401, '请先登录玩家账号');

  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }

  const roomId = stripHtml(body.room_id || '').trim();
  const roomName = stripHtml(body.room_name || '').trim();
  const inDate = (body.in_date || '').trim();
  const outDate = (body.out_date || '').trim();
  const persons = parseInt(body.persons || 1, 10);
  const breakfast = body.breakfast ? 1 : 0;
  const name = stripHtml(body.name || '').trim();
  const contact = stripHtml(body.contact || '').trim();
  const note = stripHtml(body.note || '').trim();

  if (!roomId || !inDate || !outDate || !name || !contact) {
    return err(400, '必填字段缺失');
  }
  const inD = new Date(inDate);
  const outD = new Date(outDate);
  if (isNaN(inD) || isNaN(outD) || outD <= inD) return err(400, '日期无效');
  const nights = Math.round((outD - inD) / 86400000);
  if (persons < 1 || persons > 6) return err(400, '入住人数 1-6');

  // v49-fix-12: 服务端拒收草稿酒店 / 草稿房型 — 防止前端绕过直接 POST
  // (主页 hotel 预览 / hotel.html 都已禁用按钮, 但 API 仍要兜底)
  const roomRow = await env.DB.prepare(
    'SELECT r.id AS room_id, r.is_active AS room_active, h.is_active AS hotel_active, h.name AS hotel_name FROM hotel_rooms r JOIN hotels h ON h.id = r.hotel_id WHERE r.id = ?'
  ).bind(roomId).first();
  if (!roomRow) return err(404, '房型不存在');
  if (!roomRow.room_active) return err(400, '此房型暂未上线, 无法预订');
  if (!roomRow.hotel_active) return err(400, '此酒店正在筹建中, 暂不开放预订');

  const ins = await env.DB.prepare(
    `INSERT INTO bookings (player_id, room_id, room_name, in_date, out_date, nights, persons, breakfast, name, contact, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sess.player_id, roomId, roomName, inDate, outDate, nights, persons, breakfast, name, contact, note || null).run();
  const bookingId = ins.meta.last_row_id;

  // v47: 双写 ticket
  await ticketFromBooking(env, {
    player_id: sess.player_id, room_name: roomName, name, contact,
    in_date: inDate, out_date: outDate, nights, persons, breakfast, note,
  }, bookingId);

  return ok({ id: bookingId, nights, in_date: inDate, out_date: outDate });
}
