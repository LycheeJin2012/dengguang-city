import { firstReplyAfterEvent } from '../_core/first-reply.js';
import { autoDispatchSafely } from '../_core/dispatch.js';
import {
  endpoint,
  identity,
  body,
  string,
  reply,
  fail,
} from '../_core/request.js';

/** 市民可以提的四种留言。 */
const TYPES = ['建议', '投诉', '咨询', '合作'];

/** 一分钟内的留言条数上限。 */
const RATE_LIMIT = 5;

/**
 * GET /api/messages —— 留言列表。
 *
 * ?public=1 是公开墙：只回玩家自己勾了「同意公开」且已过审的留言，
 * 并且带上评论数。匿名路径，不需要登录。
 * 其余情况回当前玩家自己的全部留言（含未公开的）。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const url = new URL(c.request.url);
    if (url.searchParams.get('public') === '1') {
      const rows = await c.env.DB
        .prepare(
          'SELECT m.id,m.name,m.type,m.content,m.admin_reply,m.created_at,m.replied_at,(SELECT COUNT(*) FROM message_comments x WHERE x.message_id=m.id) AS comment_count FROM messages m WHERE m.public_visible=1 AND m.public_consent=1 ORDER BY m.id DESC LIMIT 100'
        )
        .all();
      return reply({ messages: rows.results });
    }

    const player = await identity(c);
    const result = await c.env.DB
      .prepare(
        'SELECT id,name,content,type,status,admin_reply,created_at,replied_at,public_consent,public_visible FROM messages WHERE player_id=? ORDER BY id DESC LIMIT 100'
      )
      .bind(player.id)
      .all();
    return reply({ messages: result.results });
  });

/**
 * POST /api/messages —— 提交留言。
 *
 * 一次 batch 里写了四类东西，顺序不能动：
 *   1. messages 行
 *   2. tickets 行（category='message'，source 指向刚建的留言）
 *   3. ticket_events 的 created 事件
 *   4. 灯灯的自动首答（firstReplyAfterEvent）
 * 后三条都靠 last_insert_rowid() / changes() 引用上一条的插入结果，
 * 所以这四条必须待在同一个 batch 里顺序执行。
 *
 * 注意：这是留言板，不是私信。私信在 social.js。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const content = string(input.content, '留言', 2000);
    const contact = string(input.contact, '联系方式', 200);
    const type = string(input.type, '类型', 20);

    if (!TYPES.includes(type)) fail(400, '留言类型无效');

    const recent = await c.env.DB
      .prepare(
        "SELECT COUNT(*) AS n FROM messages WHERE player_id=? AND created_at>datetime('now','-1 minute')"
      )
      .bind(player.id)
      .first();
    if (recent.n >= RATE_LIMIT) fail(429, '留言太频繁，请稍后再试');

    const db = c.env.DB;
    // 只有前端明确传 true 或 1 才算同意公开，其它一律 0。
    const consent = input.public_consent === true || input.public_consent === 1 ? 1 : 0;

    const result = await db.batch([
      db
        .prepare(
          'INSERT INTO messages(player_id,name,contact,type,content,public_consent,public_visible) VALUES(?,?,?,?,?,?,0)'
        )
        .bind(player.id, player.username, contact, type, content, consent),
      db
        .prepare(
          "INSERT INTO tickets(player_id,category,source_table,source_id,title,body,kind,public_consent) VALUES(?,'message','messages',last_insert_rowid(),?,?,'message',?)"
        )
        .bind(player.id, type + ' · ' + player.username, content, consent),
      db
        .prepare(
          "INSERT INTO ticket_events(ticket_ref,actor_type,actor_id,actor_name,action,details) VALUES(CAST(last_insert_rowid() AS TEXT),'player',?,?,'created','{}')"
        )
        .bind(player.id, player.username),
      ...firstReplyAfterEvent(db, 'message'),
    ]);

    // 自动派单失败不阻断提交：留言已经落库了，补派交给管理员。
    await autoDispatchSafely(c, result[1].meta.last_row_id);

    return reply({ id: result[0].meta.last_row_id }, 201);
  });
