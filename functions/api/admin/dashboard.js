import { endpoint, identity, reply } from '../../_core/request.js';

/**
 * 后台首页统计。
 *
 * 每个板块一个 GROUP BY 查询，全部并发跑，单块失败只让那一块变 null。
 * 「拿不到」和「真的是 0」在运营上是两回事，不能混成同一个数字。
 */
const SECTIONS = {
  players: { table: 'players', states: ['pending', 'active', 'rejected'] },
  messages: { table: 'messages', states: ['unread', 'read', 'done'] },
  bookings: { table: 'bookings', states: ['pending', 'confirmed', 'completed', 'cancelled'] },
  license: { table: 'license_signups', states: ['pending', 'passed', 'failed'] },
  circuit: { table: 'circuit_signups', states: ['pending', 'approved', 'rejected'] },
  kart: { table: 'kart_signups', states: ['pending', 'approved', 'rejected'] },
};

/** 看板要展示的全部状态。库里出现表外的状态时不进 counts，但仍然计入 total。 */
function tallyByState(rows, states) {
  const counts = Object.fromEntries(states.map((state) => [state, 0]));
  let total = 0;
  for (const row of rows || []) {
    const n = Number(row.n);
    total += n;
    if (Object.hasOwn(counts, row.status)) counts[row.status] = n;
  }
  return { ...counts, total };
}

/**
 * 待办工单数。
 *
 * 未读消息只有在「还没有被开成工单镜像」时才算待办，否则同一件事会被计两次。
 * guard 是拼进 SQL 的：它只由 admin.role 和 linked_player_id 两个可信字段生成，
 * 数字也过了 Number() 兜底，不含任何用户可控文本。
 */
async function pendingCount(db, admin) {
  const guard =
    admin.role === 'super'
      ? ''
      : ` AND target_admin_id IS NULL AND (target_player_id IS NULL OR target_player_id!=${Number(admin.linked_player_id)||0})`;

  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM tickets WHERE status='open'${guard})+(SELECT COUNT(*) FROM messages m WHERE status='unread' AND NOT EXISTS(SELECT 1 FROM tickets t WHERE t.source_table='messages' AND t.source_id=m.id)${guard}) AS open`
    )
    .first();

  return row;
}

export const onRequestGet = (context) =>
  endpoint(async () => {
    const admin = await identity(context, 'admin');

    const result = {};
    const errors = {};

    // Keep independent sections visible if one query fails. Unavailable is not zero.
    await Promise.all(
      Object.entries(SECTIONS).map(async ([key, section]) => {
        try {
          const rows = await context.env.DB.prepare(
            `SELECT status, COUNT(*) AS n FROM ${section.table} GROUP BY status`
          ).all();
          result[key] = tallyByState(rows.results, section.states);
        } catch (error) {
          console.error(`[dashboard:${key}]`, error);
          result[key] = null;
          // Only authenticated admins can see diagnostics; these queries contain no user values.
          errors[key] = { code: 'STAT_QUERY_FAILED', detail: String(error.message || error).slice(0, 300) };
        }
      })
    );

    try {
      result.tickets = await pendingCount(context.env.DB, admin);
    } catch {
      result.tickets = null;
      errors.tickets = { code: 'STAT_QUERY_FAILED' };
    }

    return reply({ ...result, errors, partial: Object.keys(errors).length > 0 });
  });
