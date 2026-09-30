import { endpoint, identity, body, string, integer, reply, fail } from '../_core/request.js';

/** 玩家能反馈的两种回复来源。 */
const KINDS = ['dm', 'ticket'];

/** 反馈原因；空串表示「只点有用/没用，没写原因」。 */
const REASONS = ['', 'not_resolved', 'irrelevant', 'incorrect', 'other'];

/** 一分钟内的反馈条数上限，防止刷。 */
const RATE_LIMIT = 20;

/**
 * POST /api/reply-feedback —— 玩家给一条回复点「有用/没用」。
 *
 * 同一玩家对同一条回复重复提交会走 upsert 覆盖，而不是堆多条。
 * 私信反馈没有工单可挂，ticket_ref 留空。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const db = c.env.DB;
    const kind = input.kind;
    const targetId = integer(input.target_id);

    if (!KINDS.includes(kind)) fail(400, '回复类型无效');

    // 归属校验：只能反馈「确实发给自己」的回复。
    // 私信：必须是灯灯客服发给本人的那条。
    let ref = null;
    if (kind === 'dm') {
      const dm = await db
        .prepare(
          "SELECT d.id FROM direct_messages d JOIN players bot ON bot.id=d.from_player_id WHERE d.id=? AND d.to_player_id=? AND bot.username='灯灯客服' AND bot.game_id='AI_BOT'"
        )
        .bind(targetId, player.id)
        .first();
      if (!dm) fail(404, '回复不存在');
    } else {
      // 工单回复：既可能是 tickets 的事件，也可能是老 messages 的事件，
      // 靠 ticket_ref 前缀区分，两边都必须是本人的单。
      const event = await db
        .prepare(
          "SELECT e.ticket_ref FROM ticket_events e WHERE e.id=? AND e.action IN ('replied','auto_replied') AND (EXISTS(SELECT 1 FROM tickets t WHERE CAST(t.id AS TEXT)=e.ticket_ref AND t.player_id=?) OR EXISTS(SELECT 1 FROM messages m WHERE 'm:'||m.id=e.ticket_ref AND m.player_id=?))"
        )
        .bind(targetId, player.id, player.id)
        .first();
      if (!event) fail(404, '回复不存在');
      ref = event.ticket_ref;
    }

    // 限流记在审计表：feedback 本身会 upsert 覆盖，记不住次数。
    const recent = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_events WHERE actor_type='player' AND actor_id=? AND action='reply.feedback' AND created_at>datetime('now','-1 minute')"
      )
      .bind(player.id)
      .first();
    if (recent.n >= RATE_LIMIT) fail(429, '反馈过于频繁，请稍后再试');

    if (![true, false, 0, 1].includes(input.helpful)) fail(400, '请选择是否有用');
    const reason = string(input.reason || '', '原因', 40, { required: false });
    const comment = string(input.comment || '', '补充反馈', 500, { required: false });
    if (!REASONS.includes(reason)) fail(400, '原因无效');

    await db.batch([
      db
        .prepare(
          "INSERT INTO reply_feedback(player_id,kind,target_id,ticket_ref,helpful,reason,comment) VALUES(?,?,?,?,?,?,?) ON CONFLICT(player_id,kind,target_id) DO UPDATE SET helpful=excluded.helpful,reason=excluded.reason,comment=excluded.comment,updated_at=datetime('now')"
        )
        .bind(player.id, kind, String(targetId), ref, input.helpful ? 1 : 0, reason, comment),
      db
        .prepare(
          "INSERT INTO audit_events(actor_type,actor_id,actor_name,action,resource_type,resource_id,http_status,details) VALUES('player',?,?,'reply.feedback','reply_feedback',?,200,?)"
        )
        .bind(
          player.id,
          player.username,
          kind + ':' + targetId,
          JSON.stringify({ helpful: !!input.helpful, reason, ticket_ref: ref })
        ),
    ]);

    return reply({ saved: true });
  });
