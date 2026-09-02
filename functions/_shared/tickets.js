// v47: 工单 helper (供 messages/bookings/license/circuit/kart POST 双写调用)
// 双写: 原表写成功后, 再写一张 tickets 记录, admin 后台统一处理
// 失败不回滚原表 (工单是辅助视图, 丢一两条不影响核心功能)

/**
 * 创建工单
 * @param {object} env - Cloudflare env
 * @param {object} opts
 *   - player_id: number | null
 *   - category: 'message'|'comment'|'license'|'hotel'|'race'|'kart'|'service'
 *   - source_table: 原表名
 *   - source_id: 原表 id
 *   - title: 简短标题
 *   - body: 内容快照
 *   - priority: 'low'|'normal'|'high'|'urgent' (默认 normal)
 * @returns {Promise<number|null>} 新工单 id, 失败返回 null
 */
export async function createTicket(env, opts) {
  try {
    if (!env?.DB) return null;
    const { player_id = null, category, source_table = null, source_id = null, title, body = null, priority = 'normal' } = opts;
    if (!category || !title) return null;
    const r = await env.DB.prepare(
      `INSERT INTO tickets (player_id, category, source_table, source_id, title, body, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(player_id, category, source_table, source_id, title, body, priority).run();
    return r.meta?.last_row_id || null;
  } catch (e) {
    console.warn('[tickets] createTicket failed:', e?.message || e);
    return null;
  }
}

// 各业务场景的便捷封装 (统一 title/body 风格)
export async function ticketFromMessage(env, msg, sourceId) {
  return createTicket(env, {
    player_id: msg.player_id || null,
    category: 'message',
    source_table: 'messages',
    source_id: sourceId,
    title: (msg.title || (msg.content || '').slice(0, 30) || '市民留言'),
    body: msg.content || msg.body || '',
    priority: 'normal',
  });
}

export async function ticketFromBooking(env, booking, sourceId) {
  return createTicket(env, {
    player_id: booking.player_id || null,
    category: 'hotel',
    source_table: 'bookings',
    source_id: sourceId,
    title: `酒店预订 · ${booking.room_name || booking.hotel_name || '房型'}`,
    body: JSON.stringify({
      name: booking.name, contact: booking.contact,
      in_date: booking.in_date, out_date: booking.out_date,
      nights: booking.nights, persons: booking.persons,
      breakfast: booking.breakfast, note: booking.note,
    }),
    priority: 'normal',
  });
}

export async function ticketFromLicense(env, ls, sourceId) {
  return createTicket(env, {
    player_id: ls.player_id || null,
    category: 'license',
    source_table: 'license_signups',
    source_id: sourceId,
    title: `驾照考试 · ${ls.exam_type || '?'} · ${ls.exam_date || ''}`,
    body: JSON.stringify({
      name: ls.name, contact: ls.contact,
      exam_type: ls.exam_type, exam_date: ls.exam_date, exam_session: ls.exam_session,
      note: ls.note,
    }),
    priority: 'normal',
  });
}

export async function ticketFromCircuit(env, cs, sourceId) {
  return createTicket(env, {
    player_id: cs.player_id || null,
    category: 'race',
    source_table: 'circuit_signups',
    source_id: sourceId,
    title: `国际赛车场试车 · ${cs.session || ''}`,
    body: JSON.stringify({
      name: cs.name, contact: cs.contact,
      track_id: cs.track_id, session: cs.session, car: cs.car, license: cs.license,
      note: cs.note,
    }),
    priority: 'normal',
  });
}

export async function ticketFromKart(env, ks, sourceId) {
  return createTicket(env, {
    player_id: ks.player_id || null,
    category: 'kart',
    source_table: 'kart_signups',
    source_id: sourceId,
    title: `卡丁车试跑 · ${ks.session || ''}`,
    body: JSON.stringify({
      name: ks.name, contact: ks.contact,
      session: ks.session, car: ks.car, note: ks.note,
    }),
    priority: 'low',
  });
}
