// Legacy message-management API, backed by the unified ticket workflow.
import { endpoint, identity, body, string, integer, reply, fail } from '../../_core/request.js';
import { onRequestPatch as updateTicket } from '../tickets.js';
import { aiAutoReply } from '../../_shared/ai.js';

export const onRequestGet = (c) =>
  endpoint(async () => {
    await identity(c, 'admin');
    const url = new URL(c.request.url);
    const status = url.searchParams.get('status');
    if (status && !['unread', 'read', 'done'].includes(status)) fail(400, '状态无效');
    const rows = await c.env.DB
      .prepare(
        `SELECT m.*,p.username AS player_username FROM messages m LEFT JOIN players p ON p.id=m.player_id ${status ? 'WHERE m.status=?' : ''} ORDER BY m.id DESC LIMIT 200`
      )
      .bind(...(status ? [status] : []))
      .all();
    return reply({ messages: rows.results });
  });

/** 旧留言状态 → 统一工单状态；没给 status 就原样透传给工单接口 */
const TICKET_STATUS = { unread: 'open', read: 'in_progress', done: 'resolved' };

export const onRequestPatch = (c) =>
  endpoint(async () => {
    await identity(c, 'admin');
    const messageId = integer(new URL(c.request.url).searchParams.get('id'));
    const input = await body(c.request);

    // 留言已经被并成工单的就走工单；还没并的用 m: 前缀交给工单侧的 legacy 通道
    const ticket = await c.env.DB
      .prepare("SELECT id FROM tickets WHERE source_table='messages' AND source_id=?")
      .bind(messageId)
      .first();
    const url = new URL(c.request.url);
    url.pathname = '/api/tickets';
    url.searchParams.set('id', ticket ? String(ticket.id) : 'm:' + messageId);

    const status = TICKET_STATUS[input.status] || input.status;
    return updateTicket({
      ...c,
      request: new Request(url, {
        method: 'PATCH',
        headers: c.request.headers,
        body: JSON.stringify({ ...input, status }),
      }),
    });
  });

export const onRequestPost = (c) =>
  endpoint(async () => {
    await identity(c, 'admin');
    const input = await body(c.request);
    return reply({
      draft: await aiAutoReply(c.env, string(input.message, '留言', 2000), 'message'),
      note: '自动建议，请核对后再发送',
    });
  });

export const onRequestDelete = (c) =>
  endpoint(async () => {
    await identity(c, 'super');
    // 删留言就等于抹掉处理历史，一律引导去关工单
    fail(409, '请关闭对应工单，以保留市民留言及处理历史');
  });
