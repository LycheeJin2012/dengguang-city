import { getOrCreateAiBot } from '../_shared/ai.js';
import { fail } from './request.js';

/**
 * 客服会话的对外形状。
 *
 * 只挑前端真正用到的字段，requires_super / assigned_admin_id 这类内部状态
 * 不外泄 —— 前端拿到也不该知道。
 */
export const publicChat = (r) =>
  r
    ? {
        id: r.id,
        status: r.status,
        auto_handoff: !!r.auto_handoff,
        revision: r.revision,
        needs_ticket: !!r.needs_ticket,
        ticket_summary: r.needs_ticket ? r.ticket_summary : null,
        linked_ticket_id: r.linked_ticket_id,
        requested_at: r.requested_at,
      }
    : null;

/**
 * 这句话要不要转人工。
 *
 * 顺序很重要：先排除「明确不要人工」，再判断「明确要人工」，
 * 最后才兜底返回 true（宁可多转也不要让真人诉求卡在机器人这里）。
 *
 * 各条规则的用意：
 *   · 明确说不要 → 不转
 *   · 说要找客服/工作人员 → 转
 *   · 纯打招呼或纯致谢 → 不转（转了也是浪费人力）
 *   · 问建市年份这类 FAQ → 不转
 *   · 问怎么举报投诉 → 不转，投诉有专门的工单入口，不该走客服排队
 */
export function needsHuman(text) {
  const t = String(text || '').trim();

  if (/(?:不要|不用|暂不|不想).{0,5}人工/.test(t)) return false;
  if (/人工|找.*客服|找.*工作人员/.test(t)) return true;
  if (/^(你好|您好|hi|hello|谢谢|感谢|thanks|好的|好|ok)[!！。,.，\s]*$/i.test(t)) return false;
  if (/建市|建城|哪年成立|成立年份/.test(t)) return false;
  if (/(?:如何|怎么).{0,8}(?:举报|投诉|反馈)/.test(t)) return false;

  return true;
}

/** 消息里出现「投诉/举报」，就要 SUPER 权限的人来接手 */
export function sensitiveChat(text) {
  return /投诉|举报/.test(String(text || ''));
}

/** 机器人转人工后立刻回给玩家的话，别让玩家干等着 */
const HANDOFF_ACK =
  '🤖 已在当前聊天转人工，请在这里等候或补充说明。工作人员会直接在本会话回复你。';

/**
 * 发起（或重开）一次人工客服会话。
 *
 * 用 db.batch 把 5 条写入合成一次往返：建会话、记事件、机器人回执、
 * 写审计、通知管理员。分 5 次往返的话，任一步失败都会留下半截状态
 * （比如会话建了但没人收到通知），而这些写入必须同生共死。
 *
 * 这几条 SQL 靠 `changes()` 串联 —— 前一条写成功，后一条的
 * `WHERE changes()=1` 才成立，天然做到「整条链子只在该写的时候写」。
 * 已经存在活跃会话时 changes() 为 0，机器人不会重复回执。
 */
export async function requestChat(c, p, { reason = '请求人工协助', mode = 'manual' } = {}) {
  const db = c.env.DB;
  const bot = await getOrCreateAiBot(c.env);

  // 每个玩家只有一条客服会话，已存在且没关就直接复用
  const current = await db.prepare('SELECT * FROM support_chats WHERE player_id=?')
    .bind(p.id)
    .first();
  if (current && current.status !== 'closed') {
    return { chat: publicChat(current), existing: true };
  }

  // 转接前把最近 200 条对机器人的对话也纳入敏感度判断 —— 玩家可能第一句
  // 不提投诉，翻聊天记录才看得出来，避免敏感诉求落到普通管理员手里。
  const recent = (
    await db
      .prepare(
        'SELECT content FROM direct_messages WHERE from_player_id=? AND to_player_id=? ORDER BY id DESC LIMIT 200'
      )
      .bind(p.id, bot.id)
      .all()
  ).results;

  const restricted =
    !!current?.requires_super ||
    sensitiveChat(reason + ' ' + recent.map((m) => m.content).join(' '));

  // 自动转接来自机器人，所以署名是「灯灯」而不是玩家名
  const actorType = mode === 'automatic' ? 'system' : 'player';
  const actorId = mode === 'automatic' ? null : p.id;
  const actorName = mode === 'automatic' ? '灯灯' : p.username;
  const details = JSON.stringify({ mode });

  const batchResult = await db.batch([
    db
      .prepare(
        `INSERT INTO support_chats(player_id,reason,requires_super) VALUES(?,?,?)
         ON CONFLICT(player_id) DO UPDATE SET
           status='queued',assigned_admin_id=NULL,reason=excluded.reason,
           requires_super=excluded.requires_super,auto_handoff=1,needs_ticket=0,
           ticket_summary=NULL,linked_ticket_id=NULL,revision=revision+1,
           requested_at=datetime('now'),updated_at=datetime('now')
         WHERE support_chats.status='closed'`
      )
      .bind(p.id, reason.slice(0, 500), restricted ? 1 : 0),

    db
      .prepare(
        `INSERT INTO support_chat_events(chat_id,actor_type,actor_id,actor_name,action,details)
         SELECT id,?,?,?,?,? FROM support_chats WHERE player_id=? AND changes()=1`
      )
      .bind(actorType, actorId, actorName, 'requested', details, p.id),

    db
      .prepare(
        `INSERT INTO direct_messages(from_player_id,to_player_id,content)
         SELECT ?,?,? WHERE changes()=1`
      )
      .bind(bot.id, p.id, HANDOFF_ACK),

    db
      .prepare(
        `INSERT INTO audit_events(actor_type,actor_id,actor_name,action,resource_type,resource_id,http_status,details)
         SELECT ?,?,?,'support.chat_requested','support_chats',CAST(id AS TEXT),201,?
         FROM support_chats WHERE player_id=? AND changes()=1`
      )
      .bind(actorType, actorId, actorName, details, p.id),

    // 通知所有绑定了玩家账号的管理员；restricted 时只通知 SUPER
    db
      .prepare(
        `INSERT INTO notification_log(player_id,type,title,body,link)
         SELECT p.id,'support_chat','有玩家等待人工客服','请在后台人工客服聊天中接入会话。','/admin-v37.html#support'
         FROM admins a
         JOIN players p ON p.id=a.linked_player_id AND p.linked_admin_id=a.id
         WHERE p.id!=? AND (?=0 OR a.role='super') AND p.status='active' AND changes()=1`
      )
      .bind(p.id, restricted ? 1 : 0),
  ]);

  const saved = await db.prepare('SELECT * FROM support_chats WHERE player_id=?')
    .bind(p.id)
    .first();
  if (!saved) fail(503, '转人工暂未成功，请重试');

  // 第一条 SQL 走了 ON CONFLICT 的 UPDATE 分支（重开已关闭的会话）时
  // changes 为 0，对玩家而言就还是原来那条会话。
  return { chat: publicChat(saved), existing: !batchResult[0].meta.changes };
}

/**
 * 管理员能不能处理这个会话。
 * 三个拒绝理由的顺序：先确认存在，再挡住「自己处理自己」，最后才管权限等级。
 */
export async function chatAccess(db, a, id, { readOnly = false } = {}) {
  const chat = await db.prepare('SELECT * FROM support_chats WHERE id=?').bind(id).first();
  if (!chat) fail(404, '会话不存在');

  if (!readOnly && a.linked_player_id === chat.player_id) {
    fail(403, '不能处理自己的客服会话');
  }
  if (chat.requires_super && a.role !== 'super') {
    fail(403, '该会话仅限超管处理');
  }
  return chat;
}
