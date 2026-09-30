import { endpoint, identity, body, string, integer, reply, fail } from '../_core/request.js';
import { getOrCreateAiBot } from '../_shared/ai.js';
import { requestChat, publicChat } from '../_core/chat-support.js';

/**
 * GET /api/support —— 当前玩家的客服会话状态（没有则为 null）。
 * publicChat 只挑前端要用的字段，内部状态不外泄。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const chat = await c.env.DB
      .prepare('SELECT * FROM support_chats WHERE player_id=?')
      .bind(player.id)
      .first();
    return reply({ chat: publicChat(chat) });
  });

/**
 * POST /api/support —— 会话操作，三个分支：
 *   cancel       结束人工等待（乐观锁：revision 必须匹配）
 *   link-ticket  把会话挂到一张工单上
 *   默认          请求转人工
 *
 * 每个分支的 UPDATE 都带 changes()=1 守卫，后面的事件/私信语句靠它
 * 判断「主更新真的生效了」，不生效就不写事件、不发系统私信。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const db = c.env.DB;

    if (input.action === 'cancel') {
      const chat = await db
        .prepare('SELECT * FROM support_chats WHERE player_id=?')
        .bind(player.id)
        .first();
      // 会话本来就没有、或者已经结束：幂等地回成功，别让前端卡在报错态。
      if (!chat || chat.status === 'closed') return reply({ ended: true });

      const bot = await getOrCreateAiBot(c.env);
      const result = await db.batch([
        db
          .prepare(
            "UPDATE support_chats SET status='closed',auto_handoff=0,revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND status IN ('queued','active')"
          )
          .bind(chat.id, integer(input.revision, '会话版本', 1)),
        db
          .prepare(
            "INSERT INTO support_chat_events(chat_id,actor_type,actor_id,actor_name,action) SELECT ?,'player',?,?,'ended_by_player' WHERE changes()=1"
          )
          .bind(chat.id, player.id, player.username),
        db
          .prepare(
            "INSERT INTO direct_messages(from_player_id,to_player_id,content) SELECT ?,?,? WHERE changes()=1"
          )
          .bind(
            bot.id,
            player.id,
            '已结束本次人工等待或会话。聊天记录会保留，你可以继续与灯灯交流，需要时再手动转人工。'
          ),
      ]);
      if (!result[0].meta.changes) fail(409, '客服状态已变化，请刷新后确认');
      return reply({ ended: true });
    }

    if (input.action === 'link-ticket') {
      const ticketId = integer(input.ticket_id);
      // 必须先有人工客服建议过才能挂单（needs_ticket=1）。
      const chat = await db
        .prepare('SELECT * FROM support_chats WHERE player_id=? AND needs_ticket=1')
        .bind(player.id)
        .first();
      if (!chat) fail(403, '请先由人工客服建议提交工单');

      const ticket = await db
        .prepare('SELECT id FROM tickets WHERE id=? AND player_id=?')
        .bind(ticketId, player.id)
        .first();
      if (!ticket) fail(404, '工单不存在');

      if (chat.linked_ticket_id && chat.linked_ticket_id !== ticketId) fail(409, '该会话已关联工单');

      const result = await db.batch([
        db
          .prepare(
            'UPDATE support_chats SET linked_ticket_id=?,revision=revision+1 WHERE id=? AND (linked_ticket_id IS NULL OR linked_ticket_id=?)'
          )
          .bind(ticketId, chat.id, ticketId),
        db
          .prepare(
            "INSERT INTO support_chat_events(chat_id,actor_type,actor_id,actor_name,action,details) SELECT ?,'player',?,?,'ticket_linked',? WHERE changes()=1"
          )
          .bind(chat.id, player.id, player.username, JSON.stringify({ ticket_id: ticketId })),
      ]);
      if (!result[0].meta.changes) fail(409, '该会话已关联其他工单，请刷新查看');
      return reply({ linked: true });
    }

    // 默认分支：请求转人工。已有活跃会话时 requestChat 回 existing，状态码随之降为 200。
    const result = await requestChat(c, player, {
      reason: string(input.reason || '请求人工协助', '说明', 500),
    });
    return reply(result, result.existing ? 200 : 201);
  });
