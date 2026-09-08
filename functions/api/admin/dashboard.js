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
  await identity(context, 'admin');
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
  return reply({ ...result, errors, partial: Object.keys(errors).length > 0 });
});
