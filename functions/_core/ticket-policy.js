import { integer, string, fail } from './request.js';

/** 旧工单统一编到 1000000 号之后，抵消号段与 messages 表的 id 空间 */
const LEGACY_OFFSET = 1000000;

/**
 * 把工单引用串解析成 {ref, table, id, legacy}。
 *
 * ref 是给玩家看的显示 id（`m:12`），id/table 是给 SQL 用的真实位置。
 * 两种写法都要认：带 `m:` 前缀的，以及裸的大号历史 id。
 */
export function ticketReference(value) {
  const ref = String(value || '');

  if (ref.startsWith('m:')) {
    const id = integer(ref.slice(2));
    return { ref: 'm:' + id, table: 'messages', id, legacy: true };
  }

  const id = integer(ref);
  if (id >= LEGACY_OFFSET) {
    return { ref: 'm:' + (id - LEGACY_OFFSET), table: 'messages', id: id - LEGACY_OFFSET, legacy: true };
  }
  return { ref: String(id), table: 'tickets', id, legacy: false };
}

/**
 * 解析被举报/被投诉人。
 *
 * 管理员与玩家是两条互斥的线：给了 player_id 就以 id 为准（并用库里的用户名覆盖
 * 前端传的 name），只给名字才去查 —— 查得到就换成 id，查不到就当没填。
 */
export async function resolveTarget(db, input) {
  const adminId = input.target_admin_id ? integer(input.target_admin_id) : null;
  let playerId = input.target_player_id ? integer(input.target_player_id) : null;
  let name = string(input.target_player_name || '', '被举报人', 64, { required: false });

  if (adminId && !(await db.prepare('SELECT id FROM admins WHERE id=?').bind(adminId).first())) {
    fail(404, '被投诉管理员不存在');
  }

  if (playerId) {
    // 以 id 为准：名字不采信前端，防止「张冠李戴」举报到别人头上
    const p = await db.prepare('SELECT id,username FROM players WHERE id=?').bind(playerId).first();
    if (!p) fail(404, '被举报玩家不存在');
    name = p.username;
  } else if (name) {
    // 只给了名字：查得到就固化成 id 存进工单，避免之后改名对不上
    const p = await db.prepare('SELECT id,username FROM players WHERE username=?').bind(name).first();
    if (p) {
      playerId = p.id;
      name = p.username;
    }
  }

  return { target_admin_id: adminId, target_player_id: playerId, target_player_name: name || null };
}

/** 这个管理员是不是这张工单该回避的人（被投诉人 / 被举报人 / 提交者本人） */
export function conflicts(ticket, admin) {
  return (
    ticket.target_admin_id === admin.id ||
    (!!admin.linked_player_id && [ticket.target_player_id, ticket.player_id].includes(admin.linked_player_id))
  );
}

/** 派单前的候选人校验。通过就返回管理员行，失败直接抛 4xx。 */
export async function assignmentCandidate(db, ticket, id) {
  const admin = await db
    .prepare('SELECT id,username,role,linked_player_id FROM admins WHERE id=?')
    .bind(integer(id))
    .first();

  if (!admin) fail(404, '承办管理员不存在');
  if (conflicts(ticket, admin)) fail(409, '不能派给被投诉人、被举报人或提交者本人');
  // 投诉管理员的工单涉及内部追责，只允许超管接手
  if (ticket.target_admin_id && admin.role !== 'super') fail(403, '投诉管理员的工单仅能交由超管处理');

  return admin;
}

/** 往 ticket_events 插一条事件。调用方负责把它塞进 batch。 */
export function ticketEvent(db, ref, actor, action, details) {
  return db
    .prepare('INSERT INTO ticket_events(ticket_ref,actor_type,actor_id,actor_name,action,details) VALUES(?,?,?,?,?,?)')
    .bind(ref, actor.type, actor.id, actor.name, action, JSON.stringify(details || {}));
}

/**
 * 办结奖励的三条操作。
 *
 * 钱的流向：先在 ticket_rewards 记下这一笔并标记已付，再给绑定的玩家加 10 绿宝石。
 * 最后一条带 `changes()=1`，只有上一条真的付成功才会执行 —— 不加就会变成
 * 「奖励记录写失败但钱照发」。
 */
export async function rewardOperations(db, ref, assigneeId) {
  const admin = await db
    .prepare(
      "SELECT a.id,a.linked_player_id,p.username,p.status FROM admins a LEFT JOIN players p ON p.id=a.linked_player_id AND p.linked_admin_id=a.id WHERE a.id=?"
    )
    .bind(assigneeId)
    .first();

  // 没绑定玩家、或绑定的玩家不是 active，就只记奖励不发钱
  const playerId = admin?.status === 'active' ? admin.linked_player_id : null;

  return {
    playerId,
    playerName: admin?.username,
    operations: [
      db
        .prepare('INSERT INTO ticket_rewards(ticket_ref,admin_id,amount) VALUES(?,?,10) ON CONFLICT(ticket_ref) DO NOTHING')
        .bind(ref, assigneeId),
      db
        .prepare(
          "UPDATE ticket_rewards SET player_id=?,paid=1,paid_at=datetime('now') WHERE ticket_ref=? AND admin_id=? AND paid=0 AND EXISTS(SELECT 1 FROM players WHERE id=? AND status='active')"
        )
        .bind(playerId, ref, assigneeId, playerId),
      db.prepare('UPDATE players SET emeralds=emeralds+10 WHERE id=? AND changes()=1').bind(playerId),
    ],
  };
}

/**
 * 补发此前挂起的奖励（当时绑定的玩家还没激活，现在激活了）。
 *
 * 每条奖励都要重新确认「玩家已 active」，所以校验条件比 rewardOperations
 * 更严：多了一层 admins ⋈ players 的双向绑定校验。
 */
export async function claimPendingRewards(db, adminId, playerId) {
  const rows = await db.prepare('SELECT ticket_ref FROM ticket_rewards WHERE admin_id=? AND paid=0').bind(adminId).all();
  if (!rows.results.length) return;

  const operations = [];
  for (const r of rows.results) {
    operations.push(
      db
        .prepare(
          "UPDATE ticket_rewards SET player_id=?,paid=1,paid_at=datetime('now') WHERE ticket_ref=? AND paid=0 AND EXISTS(SELECT 1 FROM admins a JOIN players p ON p.id=a.linked_player_id AND p.linked_admin_id=a.id WHERE a.id=? AND p.id=? AND p.status='active')"
        )
        .bind(playerId, r.ticket_ref, adminId, playerId),
      db.prepare('UPDATE players SET emeralds=emeralds+10 WHERE id=? AND changes()=1').bind(playerId)
    );
  }

  await db.batch(operations);
}

/** 报名/预订状态变化时，在对应的工单上留一条 business_updated 事件 */
export async function linkedBusinessEvents(c, table, id, status) {
  const rows = await c.env.DB.prepare('SELECT id FROM tickets WHERE source_table=? AND source_id=?').bind(table, id).all();
  const who = c.audit?.actor || { type: 'system', id: null, name: '系统' };

  return rows.results.map((t) => ticketEvent(c.env.DB, String(t.id), who, 'business_updated', { source: table, source_id: id, status }));
}
