import { endpoint, identity, body, string, fail, reply } from '../_core/request.js';
import { ticketReference, ticketEvent } from '../_core/ticket-policy.js';
import { triageTicket } from '../_core/triage.js';

/** 玩家可以补的两种内容。 */
const KINDS = ['followup', 'question'];

/** 一分钟内的补充条数上限。 */
const RATE_LIMIT = 5;

/**
 * POST /api/ticket-updates —— 玩家给工单追加说明或追问。
 *
 * 顺带把已办结的工单重新打开：只要之前是 resolved/closed/done，
 * 就退回 open（老留言退回 unread），并记一条 reopened 事件。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const ref = ticketReference(input.ticket_id);
    const db = c.env.DB;

    // 归属校验在读内容之前：别人的工单连内容都不该看见。
    const row = await db
      .prepare(`SELECT * FROM ${ref.table} WHERE id=? AND player_id=?`)
      .bind(ref.id, player.id)
      .first();
    if (!row) fail(404, '工单不存在');

    const content = string(input.content, '补充说明', 2000);
    const kind = input.kind || 'followup';
    if (!KINDS.includes(kind)) fail(400, '补充类型无效');

    const recent = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_ref=? AND actor_type='player' AND actor_id=? AND action IN ('player_followup','player_question') AND created_at>datetime('now','-1 minute')"
      )
      .bind(ref.ref, player.id)
      .first();
    if (recent.n >= RATE_LIMIT) fail(429, '补充过于频繁，请稍后再试');

    const ops = [
      // 只在工单确实处于「已办结」时才记 reopened，没办结就不制造噪声。
      db
        .prepare(
          `INSERT INTO ticket_events(ticket_ref,actor_type,actor_id,actor_name,action,details) SELECT ?,'player',?,?,'reopened','{}' FROM ${ref.table} WHERE id=? AND status IN ('resolved','closed','done')`
        )
        .bind(ref.ref, player.id, player.username, ref.id),
      // 状态回退：老留言退回 unread，新工单退回 open。
      // 老留言表没有 updated_at 列，所以那个片段只给新工单加。
      db
        .prepare(
          `UPDATE ${ref.table} SET status=CASE WHEN status IN ('resolved','closed','done') THEN '${
            ref.legacy ? 'unread' : 'open'
          }' ELSE status END${ref.legacy ? '' : ",updated_at=datetime('now')"} WHERE id=?`
        )
        .bind(ref.id),
      ticketEvent(
        db,
        ref.ref,
        { type: 'player', id: player.id, name: player.username },
        kind === 'question' ? 'player_question' : 'player_followup',
        { reply: content }
      ),
      // 通知承办人；承办人没绑定玩家账号就自然查不到行，不发。
      db
        .prepare(
          "INSERT INTO notification_log(player_id,type,title,body,link) SELECT p.id,'ticket_update','工单收到补充或追问',?,'/admin-v37.html#tickets' FROM admins a JOIN players p ON p.id=a.linked_player_id AND p.linked_admin_id=a.id WHERE a.id=(SELECT assignee_id FROM ${ref.table} WHERE id=?)"
        )
        .bind('工单 #' + ref.ref + ' 有新内容，请在后台查看。', ref.id),
    ];

    // 留言型工单还要把老 messages 行的状态一起拨回未读，
    // 否则它在留言板里仍显示「已处理」。
    if (row.source_table === 'messages' && row.source_id) {
      ops.push(
        db
          .prepare("UPDATE messages SET status=CASE WHEN status='done' THEN 'unread' ELSE status END WHERE id=?")
          .bind(row.source_id)
      );
    }

    await db.batch(ops);
    // 补充内容重新参与自动分类，可能改变紧急度。
    await triageTicket(c, ref.ref, content);
    return reply({ id: ref.ref, saved: true }, 201);
  });
