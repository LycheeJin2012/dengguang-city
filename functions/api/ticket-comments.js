import { endpoint, identity, body, string, reply, fail } from '../_core/request.js';
import { ticketReference } from '../_core/ticket-policy.js';

/**
 * 拿到这张工单的评论读写权，并返回它在物理表上的定位。
 *
 * 顺序有讲究：
 *   1. 解析引用并确认工单存在（先 404）
 *   2. 若已公开且提交者同意公开 → 直接放行
 *   3. 否则先试管理员；被投诉人 / 被举报人拿私密工单要拒
 *   4. 管理员也不行 → 当作玩家，只放行本人提交的工单
 */
async function access(c, reference) {
  const ref = ticketReference(reference);

  const ticket = await c.env.DB
    .prepare(`SELECT * FROM ${ref.table} WHERE id=?`)
    .bind(ref.id)
    .first();
  if (!ticket) fail(404, '工单不存在');

  if (ticket.public_visible && ticket.public_consent) return ref;

  try {
    const admin = await identity(c, 'admin');
    if (ticket.target_admin_id && admin.role !== 'super') fail(403, '仅超管可查看');
    if (ticket.target_player_id && ticket.target_player_id === admin.linked_player_id) {
      fail(403, '被举报人不能查看私密工单评论');
    }
    return ref;
  } catch (e) {
    // 非 401/403 是真故障（数据库没连上），不能当成「不是管理员」降级。
    if (e.status !== 401 && e.status !== 403) throw e;
    const player = await identity(c);
    if (ticket.player_id !== player.id) fail(404, '工单不存在');
    return ref;
  }
}

/**
 * GET /api/ticket-comments —— 工单评论列表。
 * 老留言（legacy）走 message_comments，新工单走 ticket_comments。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const ref = await access(c, new URL(c.request.url).searchParams.get('ticket_id'));
    const rows = ref.legacy
      ? await c.env.DB
          .prepare(
            'SELECT id,author_name,content,created_at FROM message_comments WHERE message_id=? ORDER BY id LIMIT 200'
          )
          .bind(ref.id)
          .all()
      : await c.env.DB
          .prepare(
            'SELECT id,author_name,content,created_at FROM ticket_comments WHERE ticket_ref=? ORDER BY id LIMIT 200'
          )
          .bind(ref.ref)
          .all();
    return reply({ comments: rows.results });
  });

/** POST /api/ticket-comments —— 追加一条工单评论。 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    // 权限检查先于内容读取和写入。
    const ref = await access(c, input.ticket_id);
    const content = string(input.content, '评论', 2000);

    const result = ref.legacy
      ? await c.env.DB
          .prepare(
            'INSERT INTO message_comments(message_id,player_id,author_name,content) VALUES(?,?,?,?)'
          )
          .bind(ref.id, player.id, player.username, content)
          .run()
      : await c.env.DB
          .prepare('INSERT INTO ticket_comments(ticket_ref,player_id,author_name,content) VALUES(?,?,?,?)')
          .bind(ref.ref, player.id, player.username, content)
          .run();

    return reply({ id: result.meta.last_row_id }, 201);
  });
