import { endpoint, identity, body, string, integer, reply, fail } from '../../_core/request.js';
import { chatAccess } from '../../_core/chat-support.js';
import { getOrCreateAiBot } from '../../_shared/ai.js';

/** 客服会话列表/详情里的「最后一句玩家提问」 */
const LAST_QUESTION_SQL =
  "(SELECT content FROM direct_messages d WHERE d.from_player_id=c.player_id AND d.to_player_id=(SELECT id FROM players WHERE username='灯灯客服' AND game_id='AI_BOT') ORDER BY d.id DESC LIMIT 1) AS last_question";

/** 单个会话的消息：机器人 <-> 玩家的往来，最近 200 条再翻回正序 */
async function threadMessages(db, chat, bot, role) {
  return (
    await db
      .prepare(
        "SELECT * FROM (SELECT d.id,d.from_player_id,d.to_player_id,d.content,d.created_at,d.replied_by_admin_id,ad.username AS reply_author_name FROM direct_messages d LEFT JOIN admins ad ON ad.id=d.replied_by_admin_id WHERE ((d.from_player_id=? AND d.to_player_id=?) OR (d.from_player_id=? AND d.to_player_id=?)) AND EXISTS(SELECT 1 FROM support_chats live WHERE live.id=? AND (?='super' OR live.requires_super=0)) ORDER BY d.id DESC LIMIT 200) ORDER BY id"
      )
      .bind(chat.player_id, bot.id, bot.id, chat.player_id, chat.id, role)
      .all()
  ).results;
}

export const onRequestGet = (c) =>
  endpoint(async () => {
    const admin = await identity(c, 'admin');
    const url = new URL(c.request.url);
    const db = c.env.DB;

    if (url.searchParams.has('id')) {
      // readOnly：详情页也要能被普通 admin 打开，具体改写权由 POST 端再判一次
      const chat = await chatAccess(db, admin, integer(url.searchParams.get('id')), { readOnly: true });
      const bot = await getOrCreateAiBot(c.env);
      const messages = await threadMessages(db, chat, bot, admin.role);
      return reply({
        chat: {
          ...chat,
          is_self: admin.linked_player_id === chat.player_id,
          player_name: (await db.prepare('SELECT username FROM players WHERE id=?').bind(chat.player_id).first()).username,
        },
        messages,
        events: (await db.prepare('SELECT * FROM support_chat_events WHERE chat_id=? ORDER BY id').bind(chat.id).all()).results,
      });
    }

    // 工作台列表：排队中的排最前，其次处理中；标了 requires_super 的只有超管看得见
    const rows = (
      await db
        .prepare(
          `SELECT c.*,p.username,a.username AS admin_name,${LAST_QUESTION_SQL} FROM support_chats c JOIN players p ON p.id=c.player_id LEFT JOIN admins a ON a.id=c.assigned_admin_id WHERE (?='super' OR c.requires_super=0) ORDER BY CASE c.status WHEN 'queued' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,c.updated_at DESC LIMIT 100`
        )
        .bind(admin.role)
        .all()
    ).results;
    return reply({ chats: rows.map((r) => ({ ...r, is_self: r.player_id === admin.linked_player_id })) });
  });

/**
 * 认领会话。
 *
 * 条件里带 status='queued'，再靠 changes()=1 判定赢家：
 * 两个客服同时点「接入」时，输的那个拿到 409 而不是把 assigned_admin_id 覆盖掉。
 */
async function claimChat(db, admin, chat) {
  if (chat.status === 'active' && chat.assigned_admin_id === admin.id) return reply({ claimed: true });
  if (chat.status !== 'queued') fail(409, '会话已被接入或已结束');

  const result = await db.batch([
    db
      .prepare("UPDATE support_chats SET status='active',assigned_admin_id=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND status='queued'")
      .bind(admin.id, chat.id),
    db
      .prepare("INSERT INTO support_chat_events(chat_id,actor_type,actor_id,actor_name,action) SELECT ?,'admin',?,?,'claimed' WHERE changes()=1")
      .bind(chat.id, admin.id, admin.username),
  ]);
  if (!result[0].meta.changes) fail(409, '其他客服已接入');
  return reply({ claimed: true });
}

export const onRequestPost = (c) =>
  endpoint(async () => {
    const admin = await identity(c, 'admin');
    const input = await body(c.request);
    const db = c.env.DB;
    const chat = await chatAccess(db, admin, integer(input.id));
    const action = input.action;

    if (action === 'claim') return claimChat(db, admin, chat);

    // 除认领外，其余写操作都只允许当前承办人；超管可以强行处理
    if (chat.status !== 'active' || (chat.assigned_admin_id !== admin.id && admin.role !== 'super')) {
      fail(403, '请由已接入客服处理此会话');
    }
    const revision = integer(input.revision, '会话版本', 1);
    if (chat.revision !== revision) fail(409, '会话已更新，请刷新');

    let content = '';
    let summary = '';
    if (action === 'reply') {
      content = string(input.content, '回复', 2000);
    } else if (action === 'suggest-ticket') {
      summary = string(input.summary, '给玩家的工单说明', 2000);
    } else if (action !== 'close') {
      fail(400, '操作无效');
    }

    // 每次动作对应不同的 SET 子句，所以这里拼字符串而不是写死一条 UPDATE
    const bot = await getOrCreateAiBot(c.env);
    const setClause =
      action === 'close' ? "status='closed'"
      : action === 'suggest-ticket' ? 'needs_ticket=1,ticket_summary=?'
      : "status='active'";

    const operations = [
      db
        .prepare(
          `UPDATE support_chats SET ${setClause},revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND status='active'`
        )
        .bind(...(action === 'suggest-ticket' ? [summary] : []), chat.id, revision),
      db
        .prepare("INSERT INTO support_chat_events(chat_id,actor_type,actor_id,actor_name,action,details) SELECT ?,'admin',?,?,?,? WHERE changes()=1")
        .bind(chat.id, admin.id, admin.username, action, JSON.stringify(action === 'reply' ? { reply: content } : action === 'suggest-ticket' ? { summary } : {})),
    ];

    // 回复和「建议提工单」都要让玩家在私信里看到结果；close 不发消息
    if (action === 'reply' || action === 'suggest-ticket') {
      const text =
        action === 'reply'
          ? content
          : '这个问题需要通过工单继续处理。你可以点击本会话上方的“提交工单”，检查说明后确认提交。';
      operations.push(
        db
          .prepare('INSERT INTO direct_messages(from_player_id,to_player_id,content,replied_by_admin_id) SELECT ?,?,?,? WHERE changes()=1')
          .bind(bot.id, chat.player_id, text, admin.id)
      );
    }

    operations.push(
      db
        .prepare("INSERT INTO notification_log(player_id,type,title,body,link) SELECT ?,'support_chat','人工客服有更新','请在灯灯会话中查看回复。','/dm.html?to=%E7%81%AF%E7%81%AF%E5%AE%A2%E6%9C%8D' WHERE changes()=1")
        .bind(chat.player_id),
      db
        .prepare("INSERT INTO audit_events(actor_type,actor_id,actor_name,action,resource_type,resource_id,http_status,details) SELECT 'admin',?,?,?,'support_chats',?,200,? WHERE changes()=1")
        .bind(admin.id, admin.username, 'support.' + action, String(chat.id), JSON.stringify({ action }))
    );

    const result = await db.batch(operations);
    if (!result[0].meta.changes) fail(409, '会话已由其他工作人员更新，请刷新');
    return reply({ saved: true });
  });
