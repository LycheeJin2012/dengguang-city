import { ticketEvent } from '../_core/ticket-policy.js';
import { endpoint, body, reply, fail } from '../_core/request.js';
import { uploadActor, ticketOwner, validateFiles, ticketFiles } from '../_core/uploads.js';
import { MAX_ATTACHMENTS } from '../../shared/uploads.js';

/**
 * 给工单挂附件。
 *
 * 顺序不能调换：
 *   1. 先确认工单存在且调用者有权处理（否则等于探测别人的单）
 *   2. 再校验这批附件确实属于当前身份（归属 / 已传完 / 未被别的单占用）
 *   3. 才比数量上限
 * 提前返回的错误更具体，也更便宜 —— 数量检查放最后是因为它要查一次库。
 *
 * 插入与事件记录放在同一个 batch：附件挂上却没有「attachments_added」事件，
 * 事后排查会对不上账。
 */
export const onRequestPost = (context) =>
  endpoint(async () => {
    const input = await body(context.request);
    const reference = String(input.ticket_id);

    await ticketOwner(context, reference);

    const actor = await uploadActor(context);
    const files = await validateFiles(context, input.attachment_ids, actor);

    const count = await context.env.DB
      .prepare('SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_ref=?')
      .bind(reference)
      .first();
    if (count.n + files.length > MAX_ATTACHMENTS) fail(400, `每个工单最多 ${MAX_ATTACHMENTS} 个附件`);

    if (!files.length) fail(400, '请先选择附件');

    await context.env.DB.batch([
      ...files.map((file) =>
        context.env.DB
          .prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)')
          .bind(file.id, reference)
      ),
      ticketEvent(
        context.env.DB,
        reference,
        { type: actor.kind, id: actor.user.id, name: actor.user.username },
        'attachments_added',
        { names: files.map((f) => f.name) }
      ),
    ]);

    return reply({ attachments: await ticketFiles(context.env.DB, reference) });
  });
