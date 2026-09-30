import { smartCustomerReply } from '../_core/customer-answer.js';
import { requestChat, needsHuman, sensitiveChat } from '../_core/chat-support.js';
import { auditStatement } from '../_core/audit.js';
import { endpoint, identity, body, string, reply, fail } from '../_core/request.js';
import { aiAutoReply, getOrCreateAiBot } from '../_shared/ai.js';
import { ticketEvent } from '../_core/ticket-policy.js';

/** 灯灯客服的游戏 ID。发给她的私信要另走客服会话逻辑。 */
const BOT_NAME = '灯灯客服';

/** 纯寒暄，正则匹配时用它走最省的一档回复。 */
const GREETING = /^(你好|您好|hi|hello)[!！。,.，\s]*$/i;

/** 玩家明确要人工的写法。 */
const ASKS_HUMAN = /人工|找.*客服|找.*工作人员/;

/** …但同一句里又说「不要人工」时，以否定为准。 */
const REFUSES_HUMAN = /(不要|不用|暂不|不想).{0,5}人工/;

/** 玩家已手动结束人工等待时，模型没答上来就说这句，而不是又把人拉回队列。 */
const HANDOFF_OPTED_OUT =
  '暂时没有足够的已确认资料回答这个问题。你已结束人工等待，需要时可以手动点击“转人工”。';

const GREETING_REPLY = '你好，我是灯灯。请告诉我你想了解什么。';

/**
 * 解析私信对象。名字非法 / 不存在 / 未激活都 404。
 *
 * 对灯灯的会话要确保机器人账号存在 —— 前面 getOrCreateAiBot 一次是为了让
 * 并发下先建出账号，后面再来一次是兜底（万一第一次被别人抢先建了）。
 */
async function peer(c, name) {
  if (name === BOT_NAME) await getOrCreateAiBot(c.env);

  const found = await c.env.DB
    .prepare("SELECT id,username,avatar_emoji FROM players WHERE username=? AND status='active'")
    .bind(string(name, '游戏 ID', 64))
    .first();
  if (!found) fail(404, '对方不存在或未激活');

  if (found.username === BOT_NAME) await getOrCreateAiBot(c.env);
  return found;
}

/**
 * GET /api/social —— 资料页 / 会话列表 / 私信串。
 *   ?action=profile   公开资料（无需登录）
 *   ?action=me        自己的资料
 *   ?action=dm-list   会话列表（含每个会话的未读数）
 *   ?action=dm-thread 与某人的私信全文
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const url = new URL(c.request.url);
    const action = url.searchParams.get('action');

    if (action === 'profile') {
      const profile = await c.env.DB
        .prepare(
          "SELECT id,username,avatar_emoji,bio,created_at FROM players WHERE username=? AND status='active'"
        )
        .bind(string(url.searchParams.get('username'), '游戏 ID', 64))
        .first();
      if (!profile) fail(404, '玩家不存在');

      const stats = await c.env.DB
        .prepare(
          'SELECT (SELECT COUNT(*) FROM messages WHERE player_id=?) AS messages,(SELECT COUNT(*) FROM message_comments WHERE player_id=?) AS comments'
        )
        .bind(profile.id, profile.id)
        .first();
      return reply({ profile, stats });
    }

    const player = await identity(c);

    if (action === 'me') {
      const profile = await c.env.DB
        .prepare('SELECT id,username,email,bio,avatar_emoji,created_at FROM players WHERE id=?')
        .bind(player.id)
        .first();
      return reply({ profile });
    }

    if (action === 'dm-list') {
      // mine 把「对方」这一侧算成 peer_id；ranked 取每个会话的最后一条
      // 并窗口累计未读（未读 = 对方发给我的且没读）。
      const rows = await c.env.DB
        .prepare(
          `WITH mine AS (SELECT *,CASE WHEN from_player_id=? THEN to_player_id ELSE from_player_id END AS peer_id FROM direct_messages WHERE from_player_id=? OR to_player_id=?),ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY peer_id ORDER BY id DESC) AS rn,SUM(CASE WHEN to_player_id=? AND read_at IS NULL THEN 1 ELSE 0 END) OVER(PARTITION BY peer_id) AS unread FROM mine) SELECT r.peer_id,r.created_at AS last_at,r.content AS last_content,r.unread,p.username,p.avatar_emoji FROM ranked r LEFT JOIN players p ON p.id=r.peer_id WHERE rn=1 ORDER BY r.id DESC LIMIT 100`
        )
        .bind(player.id, player.id, player.id, player.id)
        .all();

      return reply({
        conversations: rows.results.map((r) => ({
          ...r,
          peer: { id: r.peer_id, username: r.username, avatar_emoji: r.avatar_emoji },
        })),
      });
    }

    if (action === 'dm-thread') {
      const other = await peer(c, url.searchParams.get('peer'));
      if (other.id === player.id) fail(400, '不能给自己发私信');

      // 先取最新 200 条再翻回正序，否则长会话会从头开始看。
      // helpful / reply_author_name 是附带的回复反馈与管理员署名。
      const thread = await c.env.DB
        .prepare(
          'SELECT * FROM (SELECT id,from_player_id,to_player_id,content,read_at,created_at,replied_by_admin_id,knowledge_sources,(SELECT helpful FROM reply_feedback WHERE kind=\'dm\' AND target_id=CAST(direct_messages.id AS TEXT) AND player_id=direct_messages.to_player_id) AS helpful,(SELECT username FROM admins WHERE id=direct_messages.replied_by_admin_id) AS reply_author_name FROM direct_messages WHERE (from_player_id=? AND to_player_id=?) OR (from_player_id=? AND to_player_id=?) ORDER BY id DESC LIMIT 200) ORDER BY id'
        )
        .bind(player.id, other.id, other.id, player.id)
        .all();
      return reply({ peer: other, messages: thread.results });
    }

    fail(404, '未知功能');
  });

/**
 * POST /api/social?action=dm-send —— 发私信。
 *
 * 发给真人只插一条 direct_messages + 按订阅决定要不要通知。
 * 发给灯灯要额外处理客服会话：敏感话题升级、排队、必要时自动回复。
 * 无论走哪条路，自动回复的异常都被吞掉（support_error=true 上报），
 * 因为「灯灯挂了」不该让玩家这条私信发不出去。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    if (new URL(c.request.url).searchParams.get('action') !== 'dm-send') fail(404, '未知功能');

    const player = await identity(c);
    const input = await body(c.request);
    const other = await peer(c, input.to_username);
    const content = string(input.content, '消息', 2000);
    const db = c.env.DB;
    if (other.id === player.id) fail(400, '不能给自己发私信');

    // 灯灯的活跃客服会话（queued/active）。
    const chat =
      other.username === BOT_NAME
        ? await db
            .prepare(
              "SELECT * FROM support_chats WHERE player_id=? AND status IN ('queued','active')"
            )
            .bind(player.id)
            .first()
        : null;

    const ops = [
      db
        .prepare('INSERT INTO direct_messages(from_player_id,to_player_id,content) VALUES(?,?,?)')
        .bind(player.id, other.id, content),
    ];

    if (chat) {
      // 敏感话题（投诉/举报）升级给超管：如果现在挂的是普通管理员，
      // 就撤下来重新排队，让超管来接。
      const sensitive = sensitiveChat(content) ? 1 : 0;
      ops.push(
        db
          .prepare(
            "UPDATE support_chats SET requires_super=CASE WHEN ?=1 THEN 1 ELSE requires_super END,assigned_admin_id=CASE WHEN ?=1 AND assigned_admin_id IN (SELECT id FROM admins WHERE role!='super') THEN NULL ELSE assigned_admin_id END,status=CASE WHEN ?=1 AND assigned_admin_id IN (SELECT id FROM admins WHERE role!='super') THEN 'queued' ELSE status END,revision=revision+1,updated_at=datetime('now') WHERE id=?"
          )
          .bind(sensitive, sensitive, sensitive, chat.id)
      );
    } else if (other.username !== BOT_NAME) {
      // 收件人退订了私信通知就不打扰，但消息照样送达。
      ops.push(
        db
          .prepare(
            "INSERT INTO notification_log(player_id,type,title,body,link) SELECT ?,'dm',?,?,? WHERE NOT EXISTS(SELECT 1 FROM subscriptions WHERE player_id=? AND type='dm' AND enabled=0)"
          )
          .bind(
            other.id,
            player.username + ' 发来了私信',
            content,
            '/dm.html?to=' + encodeURIComponent(player.username),
            other.id
          )
      );
    }

    const saved = await db.batch(ops);
    let replied = false;
    let human = false;
    let supportError = false;

    if (other.username === BOT_NAME) {
      // 已经有活跃会话 → 说明人工在路上，不再自动回。
      const active = await db
        .prepare(
          "SELECT id FROM support_chats WHERE player_id=? AND status IN ('queued','active')"
        )
        .bind(player.id)
        .first();
      if (active) {
        human = true;
      } else {
        try {
          // 上下文取本次之前的 6 条（不含刚插入的这条），正序给模型。
          const context = (
            await db
              .prepare(
                'SELECT from_player_id,content FROM (SELECT id,from_player_id,content FROM direct_messages WHERE ((from_player_id=? AND to_player_id=?) OR (from_player_id=? AND to_player_id=?)) AND id<? ORDER BY id DESC LIMIT 6) ORDER BY id'
              )
              .bind(player.id, other.id, other.id, player.id, saved[0].meta.last_row_id)
              .all()
          ).results.map((m) => ({
            role: m.from_player_id === player.id ? 'user' : 'assistant',
            content: m.content.slice(0, 1000),
          }));

          // 玩家明说「转人工」时不浪费一次模型调用。
          const explicitHuman = ASKS_HUMAN.test(content) && !REFUSES_HUMAN.test(content);
          const preference = await db
            .prepare('SELECT auto_handoff FROM support_chats WHERE player_id=?')
            .bind(player.id)
            .first();
          const answer = explicitHuman
            ? null
            : await smartCustomerReply(c.env, content, context, player);

          // 答不上来且没被明确禁止转人工 → 排队找人工。
          if (!answer && (explicitHuman || (needsHuman(content) && preference?.auto_handoff !== 0))) {
            const result = await requestChat(c, player, { reason: content.slice(0, 500), mode: 'automatic' });
            human = true;
            // existing 表示复用已有会话，不是这次新建的。
            replied = !result.existing;
          } else {
            const draft =
              answer?.answer ||
              (preference?.auto_handoff === 0 && needsHuman(content) ? HANDOFF_OPTED_OUT : null) ||
              (GREETING.test(content.trim()) ? GREETING_REPLY : await aiAutoReply(c.env, content, 'dm'));

            // NOT EXISTS 兜并发：排队成功就不再自动回。
            const result = await db
              .prepare(
                "INSERT INTO direct_messages(from_player_id,to_player_id,content,knowledge_sources) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM support_chats WHERE player_id=? AND status IN ('queued','active'))"
              )
              .bind(
                other.id,
                player.id,
                '🤖 ' + draft,
                answer ? JSON.stringify(answer.sources) : null,
                player.id
              )
              .run();
            replied = !!result.meta.changes;

            if (replied) {
              await auditStatement(
                // 显式系统动作：用裸 DB，别把审计算到发私信的玩家头上。
                c.audit?.base || db,
                { type: 'system', id: null, name: '灯灯' },
                {
                  action: 'dm.auto_replied',
                  resource_type: 'direct_messages',
                  resource_id: result.meta.last_row_id,
                  status: 200,
                  details: {
                    source: answer?.source || 'greeting_or_basic_fact',
                    recipient_player_id: player.id,
                  },
                }
              ).run();
            }
          }
        } catch {
          // 灯灯侧的故障不该回滚玩家已经发出去的私信。
          supportError = true;
        }
      }
    }

    return reply(
      {
        id: saved[0].meta.last_row_id,
        ai_replied: replied,
        human_support: human,
        support_error: supportError,
      },
      201
    );
  });

/**
 * PATCH /api/social —— 改自己资料 / 标记私信已读。
 *   ?action=me       改 bio 和头像
 *   ?action=dm-read  把某人发来的未读私信标已读
 */
export const onRequestPatch = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const url = new URL(c.request.url);
    const action = url.searchParams.get('action');

    if (action === 'me') {
      const input = await body(c.request);
      const bio = string(input.bio ?? '', '简介', 500, { required: false });
      const avatar = string(input.avatar_emoji || '👤', '头像', 32);
      await c.env.DB
        .prepare('UPDATE players SET bio=?,avatar_emoji=? WHERE id=?')
        .bind(bio, avatar, player.id)
        .run();
      return reply({ updated: true });
    }

    if (action === 'dm-read') {
      const other = await peer(c, url.searchParams.get('peer'));
      // 只标「对方发给我」且未读的那批。
      await c.env.DB
        .prepare(
          "UPDATE direct_messages SET read_at=datetime('now') WHERE to_player_id=? AND from_player_id=? AND read_at IS NULL"
        )
        .bind(player.id, other.id)
        .run();
      return reply({ read: true });
    }

    fail(404, '未知功能');
  });
