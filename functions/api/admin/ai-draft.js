import { searchKnowledge, citation } from '../../_core/knowledge.js';
import { endpoint, identity, body, string, fail, reply } from '../../_core/request.js';
import { ticketReference } from '../../_core/ticket-policy.js';
import { aiDraft } from '../../_shared/ai.js';
import { auditStatement } from '../../_core/audit.js';

/** 允许的草稿类型 */
const MODES = ['reply', 'rewrite', 'summary'];

/**
 * 生成回复草稿。
 *
 * 草稿**永远不发送**：只生成文本、记一条审计，返回给前端让人工过目。
 * AI 没配或调用失败时 aiDraft 内部会回落到固定模板，
 * 所以这个接口不存在「返回空草稿」的情况。
 */

/** 工单正文在两种字段名之间二选一 */
const bodyText = (ticket) => ticket.body || ticket.content || '';

/**
 * 读工单并挡住需要回避的情况。
 *
 * 三种情形：投诉的正是自己、举报了自己绑定的玩家、
 * 或者这是一张指名投诉别人的单（那种只有超管能碰）。
 */
async function loadDraftableTicket(db, admin, ticketId) {
  const reference = ticketReference(ticketId);
  const ticket = await db.prepare(`SELECT * FROM ${reference.table} WHERE id=?`).bind(reference.id).first();

  if (!ticket) fail(404, '工单不存在');
  if (
    ticket.target_admin_id === admin.id ||
    (ticket.target_player_id && ticket.target_player_id === admin.linked_player_id) ||
    (ticket.target_admin_id && admin.role !== 'super')
  ) {
    fail(403, '该工单需要回避，请由有权限的其他管理员处理');
  }

  return { reference, ticket };
}

export const onRequestPost = (context) =>
  endpoint(async () => {
    const admin = await identity(context, 'admin');

    const input = await body(context.request);
    const mode = input.mode || 'reply';
    if (!MODES.includes(mode)) fail(400, '草稿类型无效');

    const { reference, ticket } = await loadDraftableTicket(context.env.DB, admin, input.ticket_id);

    const instructions = string(input.instructions || '', '补充要求', 1000, { required: false });
    const existing = string(input.existing || '', '已有文字', 2000, { required: false });
    // rewrite 没有原文就没法改写，这一条要在碰模型之前挡掉。
    if (mode === 'rewrite' && !existing) fail(400, '请先填写要修改的文字');

    const references = await searchKnowledge(
      context.env.DB,
      (ticket.title || '') + ' ' + bodyText(ticket),
      ['public', 'staff']
    );

    const history = (
      await context.env.DB.prepare(
        'SELECT actor_name,action,details,created_at FROM ticket_events WHERE ticket_ref=? ORDER BY id DESC LIMIT 12'
      )
        .bind(reference.ref)
        .all()
    ).results;

    const result = await aiDraft(context.env, {
      message: String(bodyText(ticket)).slice(0, 4000),
      instructions,
      existing,
      mode,
      references: [
        ...references.map((row) => ({ id: row.id, title: row.title, content: row.answer })),
        // 本单办理记录随 prompt 一起发，type 那句是给模型看的定性说明：
        // 这些是本单的操作痕迹，不许当成别的事实的来源。
        { type: '本单办理记录，不能作为其他工单事实', events: history },
      ],
    });

    // 审计写未包装的真库（c.audit.base）：这条记录该挂在发起人名下，
    // 走请求级包装会把系统动作错记成别的玩家。
    await auditStatement(
      context.audit?.base || context.env.DB,
      { type: 'admin', id: admin.id, name: admin.username },
      {
        action: 'ai.draft_created',
        resource_type: 'tickets',
        resource_id: reference.ref,
        status: 200,
        details: {
          mode,
          source: result.source,
          instructions,
          existing_length: existing.length,
          // 草稿没有发出去，这是审计里最要紧的一个字段。
          sent: false,
        },
      }
    ).run();

    return reply({ ...result, sources: references.map(citation) });
  });
