import { endpoint, identity, reply } from '../../_core/request.js';

const sections = {
  players: { table: 'players', states: ['pending', 'active', 'rejected'] },
  messages: { table: 'messages', states: ['unread', 'read', 'done'] },
  bookings: { table: 'bookings', states: ['pending', 'confirmed', 'completed', 'cancelled'] },
  license: { table: 'license_signups', states: ['pending', 'passed', 'failed'] },
  kart: { table: 'kart_signups', states: ['pending', 'approved', 'rejected'] },
  circuit: { table: 'circuit_signups', states: ['pending', 'approved', 'rejected'] },
};

export const onRequestGet = context => endpoint(async () => {
  const admin = await identity(context, 'admin');
  const result = {};
  const errors = {};
  // Keep independent sections visible if one query fails. Unavailable is not zero.
  await Promise.all(Object.entries(sections).map(async ([key, section]) => {
    try {
      const rows = await context.env.DB.prepare(
        `SELECT status, COUNT(*) AS n FROM ${section.table} GROUP BY status`
      ).all();
      const counts = Object.fromEntries(section.states.map(state => [state, 0]));
      let total = 0;
      for (const row of rows.results || []) {
        const n = Number(row.n);
        total += n;
        if (Object.hasOwn(counts, row.status)) counts[row.status] = n;
      }
      result[key] = { ...counts, total };
    } catch (error) {
      console.error(`[dashboard:${key}]`, error);
      result[key] = null;
      // Only authenticated admins can see diagnostics; these queries contain no user values.
      errors[key] = { code: 'STAT_QUERY_FAILED', detail: String(error.message || error).slice(0, 300) };
    }
  }));
  try {
    const guard=admin.role==='super'?'':` AND target_admin_id IS NULL AND (target_player_id IS NULL OR target_player_id!=${Number(admin.linked_player_id)||0})`;
    const pending=await context.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM tickets WHERE status='open'${guard})+(SELECT COUNT(*) FROM messages m WHERE status='unread' AND NOT EXISTS(SELECT 1 FROM tickets t WHERE t.source_table='messages' AND t.source_id=m.id)${guard}) AS open`).first();
    result.tickets=pending;
  } catch { result.tickets=null; errors.tickets={code:'STAT_QUERY_FAILED'}; }
  return reply({ ...result, errors, partial: Object.keys(errors).length > 0 });
});
