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

    // 收集：6 条查询照旧并发跑（性能不动），但结果先落到 collected 里，
    // **不**直接往最终要序列化的对象上赋值。
    const collected = {};
    const failed = {};

    // Keep independent sections visible if one query fails. Unavailable is not zero.
    await Promise.all(
      Object.entries(SECTIONS).map(async ([key, section]) => {
        try {
          const rows = await context.env.DB.prepare(
            `SELECT status, COUNT(*) AS n FROM ${section.table} GROUP BY status`
          ).all();
          collected[key] = tallyByState(rows.results, section.states);
        } catch (error) {
          console.error(`[dashboard:${key}]`, error);
          collected[key] = null;
          // Only authenticated admins can see diagnostics; these queries contain no user values.
          failed[key] = { code: 'STAT_QUERY_FAILED', detail: String(error.message || error).slice(0, 300) };
        }
      })
    );

    // ── 拼装：按 SECTIONS 的声明顺序重建 ──────────────────────────────────
    //
    // 原来这里是 `result[key] = …`，赋值写在各自 promise 的回调内部，
    // 于是谁先返回谁先被插入。JS 对象对非数组下标的字符串键按**插入序**枚举，
    // JSON.stringify 又按插入序输出 —— 同一个接口、同样的数据，只因 D1 的调度
    // 快慢不同就给出不同的键序，响应没法做快照比对，缓存/监控的哈希也无意义地抖。
    //
    // errors 同样要按声明序排：两块以上查询失败时，它的键序也是完成顺序。
    const result = {};
    const errors = {};
    for (const key of Object.keys(SECTIONS)) {
      result[key] = collected[key];
      if (key in failed) errors[key] = failed[key];
    }

    // tickets 一直在 Promise.all 之后单独算，位置仍然在最后。
    try {
      result.tickets = await pendingCount(context.env.DB, admin);
    } catch {
      result.tickets = null;
      errors.tickets = { code: 'STAT_QUERY_FAILED' };
    }

    return reply({ ...result, errors, partial: Object.keys(errors).length > 0 });
  });
