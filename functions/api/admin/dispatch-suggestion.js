import { endpoint, identity, reply, fail } from '../../_core/request.js';
import { ticketReference } from '../../_core/ticket-policy.js';
import { recommend } from '../../_core/dispatch.js';

/**
 * 派单建议预览（只读 —— 真的不写库）。
 *
 * 前端点一下「看看建议」，后台算一遍负载和经验分就返回，不落任何数据。
 */

/**
 * 取出工单，并挡住三类不该由当前管理员处理的情况：
 *   1. 指名投诉了别的管理员 —— 只有超管能碰；
 *   2. 指名的就是自己本人；
 *   3. 指名举报了自己绑定的玩家。
 * 顺序不能动：先判 404（单不存在），再判 403（有权但要回避）。
 */
async function loadDispatchableTicket(db, admin, id) {
  const reference = ticketReference(id);
  const ticket = await db.prepare(`SELECT * FROM ${reference.table} WHERE id=?`).bind(reference.id).first();

  if (!ticket) fail(404, '工单不存在');
  if (
    (ticket.target_admin_id && admin.role !== 'super') ||
    ticket.target_admin_id === admin.id ||
    (ticket.target_player_id && ticket.target_player_id === admin.linked_player_id)
  ) {
    fail(403, '请由有权限且无需回避的管理员处理');
  }

  return { reference, ticket };
}

export const onRequestGet = (context) =>
  endpoint(async () => {
    const admin = await identity(context, 'admin');

    const { reference, ticket } = await loadDispatchableTicket(
      context.env.DB,
      admin,
      new URL(context.request.url).searchParams.get('id')
    );

    // config 是内部策略（工作量上限、版本号等），不往外发。
    const { config: ignored, ...decision } = await recommend(context, ticket);
    // 「没有可派的人」不是错误结果，是 409 —— 前端据此提示改派人工。
    if (decision.status === 'deferred') fail(409, decision.reason);

    const { status: ignoredStatus, ...result } = decision;
    return reply({ ticket_id: reference.ref, ...result });
  });
