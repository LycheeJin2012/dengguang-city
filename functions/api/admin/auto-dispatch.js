import { endpoint, identity, reply, fail } from '../../_core/request.js';
import { ticketReference } from '../../_core/ticket-policy.js';
import { autoDispatchSafely } from '../../_core/dispatch.js';

/**
 * 人工点「立即自动派单」。
 *
 * 与 dispatch-suggestion 的区别是这里真的会写库；回避校验因此更不能松 ——
 * 建议页看错了只是一条建议，这里写错了就是真的把别人的单派给了他自己。
 * 真正的写入、竞态重试和兜底都在 _core/dispatch.js 的 autoDispatchSafely 里。
 */

/**
 * 取出工单并挡住三类回避情形，与 dispatch-suggestion 完全同一套规则：
 *   1. 指名投诉了别的管理员 —— 只有超管能碰；
 *   2. 指名的就是自己本人；
 *   3. 指名举报了自己绑定的玩家。
 * 顺序要紧：先 404（单不存在），再 403（有权但要回避）。
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

  return reference;
}

export const onRequestPost = (context) =>
  endpoint(async () => {
    const admin = await identity(context, 'admin');

    const reference = await loadDispatchableTicket(
      context.env.DB,
      admin,
      new URL(context.request.url).searchParams.get('id')
    );

    return reply(await autoDispatchSafely(context, reference.ref));
  });
