// Only outward-facing fields for a server-authenticated player. Never feed staff notes to AI.

/**
 * 玩家自己的「近期事务」聚合。
 *
 * 八条查询一次并发打完再统一归一：返回给 AI 的 personal 来源完全由这里产出，
 * 所以每条 SELECT 的字段都是**已经筛过的外发字段**，不含任何内部备注。
 * 顺序、别名、条数上限都直接影响「我的事务」页的展示，别随手改。
 */

/** 工单与站内私信 —— 两者在页面上都呈现为工单卡，只是链接前缀不同 */
const TICKETS_SQL =
  "SELECT CAST(id AS TEXT) AS id,title,status,admin_reply,replied_at,created_at FROM tickets WHERE player_id=? ORDER BY id DESC LIMIT 40";

// 已经转成工单的私信不再重复出现（NOT EXISTS），并把消息状态映射成工单状态
const MESSAGES_SQL =
  "SELECT 'm:'||id AS id,name AS title,CASE status WHEN 'unread' THEN 'open' WHEN 'read' THEN 'in_progress' ELSE 'resolved' END AS status,admin_reply,replied_at,created_at FROM messages WHERE player_id=? AND NOT EXISTS(SELECT 1 FROM tickets t WHERE t.source_table='messages' AND t.source_id=messages.id) ORDER BY id DESC LIMIT 20";

const queries = [
  [TICKETS_SQL, 'tickets'],
  [MESSAGES_SQL, 'messages'],
  ['SELECT id,room_name,in_date,out_date,status,created_at FROM bookings WHERE player_id=? ORDER BY id DESC LIMIT 30', 'bookings'],
  ['SELECT id,grade,status,score,pending_count,created_at FROM exam_sessions WHERE player_id=? ORDER BY created_at DESC LIMIT 20', 'exams'],
  ['SELECT id,exam_type,status,exam_date,created_at FROM license_signups WHERE player_id=? ORDER BY id DESC LIMIT 20', 'licenses'],
  ['SELECT id,status,created_at FROM exam_appeals WHERE player_id=? ORDER BY id DESC LIMIT 20', 'appeals'],
  ['SELECT status,updated_at FROM support_chats WHERE player_id=?', 'support'],
  ['SELECT COUNT(*) AS n FROM notification_log WHERE player_id=? AND read_at IS NULL', 'unread'],
];

export async function myAffairs(db, playerId) {
  // 一次性并发取完；八条之间没有依赖，串行只会白白变慢
  const values = await Promise.all(
    queries.map(async ([sql, key]) => [key, (await db.prepare(sql).bind(playerId).all()).results])
  );
  const data = Object.fromEntries(values);

  // 工单卡：tickets 与 messages 合并，带跳转到具体工单的链接
  const items = [...data.tickets, ...data.messages].map((r) => ({
    ...r,
    kind: 'ticket',
    href: '/affairs.html?ticket=' + encodeURIComponent(r.id),
    attention: false,
  }));

  // 预订只有「已确认且入住日还没过」才算需要玩家处理
  items.push(
    ...data.bookings.map((r) => ({
      ...r,
      kind: 'booking',
      title: r.room_name || '酒店预订',
      href: '/profile.html',
      attention: r.status === 'confirmed' && r.in_date >= new Date().toISOString().slice(0, 10),
    })),
    ...data.exams.map((r) => ({
      ...r,
      kind: 'exam',
      title: r.grade + ' 类模拟考试',
      href: '/profile.html#exam',
      attention: r.status === 'in_progress',
    })),
    ...data.licenses.map((r) => ({
      ...r,
      kind: 'license',
      title: r.exam_type + ' 驾照申请',
      href: '/profile.html',
      attention: false,
    })),
    ...data.appeals.map((r) => ({
      ...r,
      kind: 'appeal',
      title: '成绩复核申请',
      href: '/profile.html#exam',
      attention: false,
    }))
  );

  // 人工客服会话没有独立列表页，塞一条固定卡片
  if (data.support[0]) {
    items.push({
      id: 'support',
      kind: 'support',
      title: '灯灯与人工客服',
      status: data.support[0].status,
      created_at: data.support[0].updated_at,
      href: '/dm.html?to=' + encodeURIComponent('灯灯客服'),
      attention: data.support[0].status === 'active',
    });
  }

  // 倒序按时间排。排序是稳定的，所以上面 push 的顺序就是同一天时的展示顺序
  items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  // limited:true —— 明示这只是快照，不是完整历史，AI 侧据此限制措辞
  return { items, unread_count: data.unread[0].n, as_of: new Date().toISOString(), limited: true };
}
