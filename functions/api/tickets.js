import { citizenTicket } from '../_core/ticket-visibility.js';
import { manualTriage } from '../_core/triage.js';
import { firstReplyAfterEvent } from '../_core/first-reply.js';
import { getOrCreateAiBot } from '../_shared/ai.js';
import { autoDispatchSafely } from '../_core/dispatch.js';
import { validateFiles, ticketFiles, uploadActor } from '../_core/uploads.js';
import { endpoint, identity, body, string, integer, fail, reply } from '../_core/request.js';
import {
  ticketReference,
  resolveTarget,
  assignmentCandidate,
  ticketEvent,
  rewardOperations,
} from '../_core/ticket-policy.js';

const STATES = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

/** 玩家可提的工单类型。 */
const KINDS = ['message', 'service', 'bug', 'report', 'admin_complaint'];

/** 老 messages 的状态 ↔ 工单状态。老表只认这三个值。 */
const LEGACY_STATUS = { unread: 'open', read: 'in_progress', done: 'resolved' };
const LEGACY_STATUS_BACK = { open: 'unread', in_progress: 'read', resolved: 'done', closed: 'done' };

/** 业务来源表的状态映射：工单办结时要把源表一起拨过去。 */
const SOURCE_STATUS = {
  bookings: { open: 'pending', in_progress: 'confirmed', resolved: 'completed', closed: 'cancelled' },
  license_signups: { open: 'pending', in_progress: 'pending', resolved: 'passed', closed: 'failed' },
  kart_signups: { open: 'pending', in_progress: 'approved', resolved: 'approved', closed: 'rejected' },
  circuit_signups: { open: 'pending', in_progress: 'approved', resolved: 'approved', closed: 'rejected' },
};

/**
 * 把 tickets 和「还没被 tickets 接管的 messages」拍平成一张表。
 * 缺 COALESCE(m.public_reply) 这类列的表在这条 UNION 里必须字段数对齐，
 * 所以两边字段顺序一一对应，改一边就要改另一边。
 * 老留言用 'm:'||id 拼出引用，ticketReference() 靠这个前缀分流。
 */
const UNION_SQL = `SELECT CAST(t.id AS TEXT) AS id,t.player_id,t.category,t.kind,t.source_table,t.source_id,t.title,t.body,t.status,t.priority,t.assignee_id,t.admin_reply,t.created_at,t.replied_at,t.replied_by,t.contact,t.public_consent,t.public_visible,t.public_title,t.public_body,t.public_reply,t.public_reply_by,t.target_player_id,t.target_player_name,t.target_admin_id,t.dispatch_hold,t.dispatch_note,p.username AS player_username FROM tickets t LEFT JOIN players p ON p.id=t.player_id
UNION ALL SELECT 'm:'||m.id,m.player_id,'message','message','messages',m.id,m.name,m.content,CASE m.status WHEN 'unread' THEN 'open' WHEN 'read' THEN 'in_progress' ELSE 'resolved' END,'normal',m.assignee_id,m.admin_reply,m.created_at,m.replied_at,m.replied_by,m.contact,m.public_consent,m.public_visible,m.public_title,m.public_body,m.public_reply,m.public_reply_by,m.target_player_id,m.target_player_name,m.target_admin_id,m.dispatch_hold,m.dispatch_note,p.username FROM messages m LEFT JOIN players p ON p.id=m.player_id WHERE NOT EXISTS(SELECT 1 FROM tickets t WHERE t.source_table='messages' AND t.source_id=m.id)`;

const actor = (admin) => ({ type: 'admin', id: admin.id, name: admin.username });

/** 公开墙看不到内部字段：受理人、紧急度分、目标人、派单标记等一律不给。 */
const PUBLIC_FIELDS = `q.id,COALESCE(q.public_title,q.title) AS title,COALESCE(q.public_body,q.body) AS body,q.status,q.category,q.created_at,COALESCE(q.public_reply,CASE WHEN q.kind='message' AND q.id LIKE 'm:%' THEN q.admin_reply END) AS admin_reply,COALESCE(q.public_reply_by,q.replied_by) AS replied_by,pa.username AS reply_author_name`;

const ADMIN_FIELDS = `q.*,ra.username AS reply_author_name,aa.username AS assignee_name,(SELECT COUNT(*) FROM ticket_attachments x WHERE x.ticket_ref=q.id) AS attachment_count,(SELECT urgency FROM ticket_triage tr WHERE tr.ticket_ref=q.id) AS triage_urgency`;

/** 管理视图固定带这条：每张工单的自动回复正文。 */
const AUTO_REPLY_FIELD = `(SELECT content FROM ticket_auto_replies ar WHERE ar.ticket_ref=q.id) AS auto_reply`;

/**
 * GET /api/tickets —— 三种视角：
 *   ?public=1      公开墙，无需登录
 *   ?my=1          玩家看自己的工单（字段经 citizenTicket 脱敏）
 *   默认           管理后台全量
 *
 * 过滤条件是拼出来的（where[] + args[]），所以每个 push 的问号和
 * args.push 的顺序必须严格成对。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const { env, request } = c;
    const url = new URL(request.url);
    const isPublic = url.searchParams.get('public') === '1';
    const isMine = !isPublic && url.searchParams.get('my') === '1';
    const who = isPublic ? null : await identity(c, isMine ? 'player' : 'admin');

    const where = [];
    const args = [];

    if (isPublic) where.push('q.public_visible=1 AND q.public_consent=1');
    if (isMine) {
      where.push('q.player_id=?');
      args.push(who.id);
    }
    // 非超管管理员看不到「有人被投诉」的那类工单，也看不到自己被举报的。
    if (!isPublic && !isMine && who.role !== 'super') {
      where.push('q.target_admin_id IS NULL');
      if (who.linked_player_id) {
        where.push('(q.target_player_id IS NULL OR q.target_player_id!=?)');
        args.push(who.linked_player_id);
      }
    }

    // 单查：id 走 ticketReference 归一，'m:12' 和 1000012 都能命中老留言。
    const raw = url.searchParams.get('id');
    if (raw) {
      where.push('q.id=?');
      args.push(ticketReference(raw).ref);
    }

    for (const key of ['status', 'category']) {
      if (url.searchParams.get(key)) {
        where.push('q.' + key + '=?');
        args.push(url.searchParams.get(key));
      }
    }
    // 以下三项是后台专属筛选项，公开墙和玩家视角都不认。
    if (!isPublic && !isMine && url.searchParams.get('priority')) {
      where.push('q.priority=?');
      args.push(url.searchParams.get('priority'));
    }
    if (!isPublic && !isMine && url.searchParams.get('assignment') === 'unassigned') {
      where.push('q.assignee_id IS NULL');
    }
    if (!isPublic && !isMine && url.searchParams.get('assignment') === 'mine') {
      where.push('q.assignee_id=?');
      args.push(who.id);
    }

    // 关键词：公开墙搜的是公开文案，后台搜的是内部文案。
    const q = url.searchParams.get('q');
    if (q) {
      where.push(
        isPublic
          ? '(COALESCE(q.public_title,q.title) LIKE ? OR COALESCE(q.public_body,q.body) LIKE ?)'
          : '(q.title LIKE ? OR q.body LIKE ?)'
      );
      args.push('%' + q + '%', '%' + q + '%');
    }

    const limit = integer(url.searchParams.get('limit') || 100, 'limit', 1, 500);
    const offset = integer(url.searchParams.get('offset') || 0, 'offset', 0, 10000000);
    const fields = isPublic ? PUBLIC_FIELDS : ADMIN_FIELDS;

    const rows = await env.DB
      .prepare(
        `SELECT ${fields},${AUTO_REPLY_FIELD} FROM (${UNION_SQL}) q LEFT JOIN admins ra ON ra.id=q.replied_by LEFT JOIN admins pa ON pa.id=COALESCE(q.public_reply_by,q.replied_by) LEFT JOIN admins aa ON aa.id=q.assignee_id ${
          where.length ? 'WHERE ' + where.join(' AND ') : ''
        } ORDER BY q.created_at DESC,CASE WHEN q.id LIKE 'm:%' THEN CAST(SUBSTR(q.id,3) AS INTEGER) ELSE CAST(q.id AS INTEGER) END DESC,q.id DESC LIMIT ? OFFSET ?`
      )
      .bind(...args, limit, offset)
      .all();

    if (raw) {
      if (!rows.results.length) fail(404, '工单不存在或无权查看');
      const ticket = rows.results[0];

      // 后台视角挂全量关联数据；玩家视角只给 public_visible / triage 之外的部分。
      if (!isPublic) {
        ticket.attachments = await ticketFiles(env.DB, ticket.id);
        ticket.history = (
          await env.DB
            .prepare(
              'SELECT id,actor_type,actor_id,actor_name,action,details,created_at FROM ticket_events WHERE ticket_ref=? ORDER BY id'
            )
            .bind(ticket.id)
            .all()
        ).results;
        ticket.reward = await env.DB
          .prepare('SELECT admin_id,player_id,amount,paid,paid_at FROM ticket_rewards WHERE ticket_ref=?')
          .bind(ticket.id)
          .first();
        // 玩家视角下「这条回复是谁给的反馈」按玩家自己算，后台按工单提交人算。
        ticket.reply_feedback = (
          await env.DB
            .prepare(
              "SELECT e.id,e.action,(SELECT helpful FROM reply_feedback f WHERE f.kind='ticket' AND f.target_id=CAST(e.id AS TEXT) AND f.player_id=?) AS helpful FROM ticket_events e WHERE e.ticket_ref=? AND e.action IN ('replied','auto_replied') ORDER BY e.id DESC LIMIT 50"
            )
            .bind(isMine ? who.id : ticket.player_id, ticket.id)
            .all()
        ).results;
      }
      if (!isMine) {
        ticket.triage = await env.DB
          .prepare('SELECT * FROM ticket_triage WHERE ticket_ref=?')
          .bind(ticket.id)
          .first();
        ticket.feedback = (
          await env.DB
            .prepare('SELECT * FROM reply_feedback WHERE ticket_ref=? ORDER BY updated_at DESC LIMIT 100')
            .bind(ticket.id)
            .all()
        ).results;
      }

      return reply({ ticket: isMine ? citizenTicket(ticket) : ticket });
    }

    // 列表：has_more 用「取回来的条数 == limit」判断，和前端约定一致。
    return reply({
      tickets: isMine ? rows.results.map(citizenTicket) : rows.results,
      limit,
      offset,
      has_more: rows.results.length === limit,
    });
  });

/**
 * POST /api/tickets —— 玩家建单。
 *
 * 一次 batch 里写：工单行 → 每个附件的关联行 → created 事件 → 灯灯自动首答。
 * 后三条都靠 last_insert_rowid() / changes() 引用前一条，顺序不能调。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const kind = input.kind || 'message';
    if (!KINDS.includes(kind)) fail(400, '工单类型无效');

    // 先解析并校验被投诉/被举报对象，缺失就直接 400。
    const target = await resolveTarget(c.env.DB, input);
    if (kind === 'admin_complaint' && !target.target_admin_id) fail(400, '请选择被投诉的管理员编号');
    if (kind === 'report' && !target.target_player_id && !target.target_player_name) {
      fail(400, '请选择或输入被举报玩家');
    }

    const consent = input.public_consent === true || input.public_consent === 1;
    // 标题前缀让后台一眼看出工单类别。
    const prefix =
      kind === 'bug'
        ? '[Bug 反馈] '
        : kind === 'report'
          ? '[举报] '
          : kind === 'admin_complaint'
            ? '[投诉管理员] '
            : '';
    const title = prefix + string(input.title, '标题', 90);
    const content = string(input.body, '内容', 2000);
    const contact = string(input.contact || '', '联系方式', 200, { required: false });

    const files = await validateFiles(c, input.attachment_ids, { kind: 'player', user: player });
    const db = c.env.DB;

    const queries = [
      db
        .prepare(
          'INSERT INTO tickets(player_id,category,kind,title,body,contact,public_consent,target_player_id,target_player_name,target_admin_id) VALUES(?,?,?,?,?,?,?,?,?,?)'
        )
        .bind(
          player.id,
          // category 只有 message / service 两种，细节类别放 kind。
          kind === 'message' ? 'message' : 'service',
          kind,
          title,
          content,
          contact,
          consent ? 1 : 0,
          target.target_player_id,
          target.target_player_name,
          target.target_admin_id
        ),
    ];

    for (const file of files) {
      queries.push(
        db
          .prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,CAST(last_insert_rowid() AS TEXT))')
          .bind(file.id)
      );
    }

    queries.push(
      db
        .prepare(
          "INSERT INTO ticket_events(ticket_ref,actor_type,actor_id,actor_name,action,details) VALUES(CAST(last_insert_rowid() AS TEXT),'player',?,?,'created',?)"
        )
        .bind(
          player.id,
          player.username,
          JSON.stringify({
            public_consent: consent,
            kind,
            target_player_id: target.target_player_id,
            target_player_name: target.target_player_name,
            target_admin_id: target.target_admin_id,
          })
        )
    );

    queries.push(...firstReplyAfterEvent(db, kind));

    const result = await db.batch(queries);
    // 自动派单失败不回滚建单：单已经落库了，改由管理员补派。
    await autoDispatchSafely(c, result[0].meta.last_row_id);

    return reply(
      {
        id: result[0].meta.last_row_id,
        attachment_count: files.length,
        public_consent: consent,
        public_visible: false,
      },
      201
    );
  });

/**
 * PATCH /api/tickets?id= —— 处理工单。
 *
 * 两种身份：
 *   管理员   可改状态 / 优先级 / 派单 / 回复 / 公开字段 / 附件
 *   玩家     只能改自己的 public_consent（且必须先从 admin 身份降级下来）
 *
 * 人工派单会置 dispatch_hold=1 并清掉 dispatch_token：
 * 自动派单那边有 `!t.dispatch_hold` 和 dispatch_token 的 CAS 检查，
 * 不这么做的话自动派单会把手工指派覆盖掉。
 */
export const onRequestPatch = (c) =>
  endpoint(async () => {
    const ref = ticketReference(new URL(c.request.url).searchParams.get('id'));
    const db = c.env.DB;
    const row = await db
      .prepare(`SELECT * FROM ${ref.table} WHERE id=?`)
      .bind(ref.id)
      .first();
    if (!row) fail(404, '工单不存在');

    const input = await body(c.request);
    // 人工客服对话的私密性是产品硬约束：不允许转公开。
    if (row.source_table === 'support' && (input.public_consent || input.public_visible)) {
      fail(409, '人工客服对话仅限私密处理');
    }

    let admin;
    try {
      // 带了 my=1 说明前端想走玩家路径，这里主动拒绝降级。
      if (new URL(c.request.url).searchParams.get('my') === '1') fail(403, '按玩家身份操作');
      admin = await identity(c, 'admin');
    } catch (e) {
      if (e.status !== 401 && e.status !== 403) throw e;
      const player = await identity(c);
      if (row.player_id !== player.id) fail(404, '工单不存在');
      // 玩家路径只放行 public_consent 这一个键，其余一律 403。
      if (Object.keys(input).some((k) => k !== 'public_consent')) {
        fail(403, '只能修改自己的公开授权');
      }
      if (![true, false, 0, 1].includes(input.public_consent)) fail(400, '公开授权值无效');
      await db.batch([
        db
          .prepare(`UPDATE ${ref.table} SET public_consent=?,public_visible=0 WHERE id=?`)
          .bind(input.public_consent ? 1 : 0, ref.id),
        ticketEvent(
          db,
          ref.ref,
          { type: 'player', id: player.id, name: player.username },
          'consent_changed',
          { consent: !!input.public_consent }
        ),
      ]);
      return reply({ updated: true });
    }

    // 回避规则：被投诉人、被举报人不能处理自己的工单。
    if (
      row.target_admin_id === admin.id ||
      (row.target_player_id && row.target_player_id === admin.linked_player_id)
    ) {
      fail(403, '被投诉或被举报人不能处理自己的工单');
    }
    // 投诉管理员的工单只能超管处理。
    if (row.target_admin_id && admin.role !== 'super') {
      fail(403, '投诉管理员的工单仅限超管处理');
    }

    // 老留言没有 priority/status 统一语义，先归一化到工单状态。
    const oldStatus = ref.legacy ? LEGACY_STATUS[row.status] || row.status : row.status;

    /** 攒要写回数据库的列；空对象表示「本次没有任何字段变更」。 */
    const changes = {};
    const events = [];

    if (input.status !== undefined) {
      if (!STATES.includes(input.status)) fail(400, '状态无效');
      changes.status = ref.legacy ? LEGACY_STATUS_BACK[input.status] : input.status;
      if (input.status !== oldStatus) {
        events.push(
          ticketEvent(db, ref.ref, actor(admin), 'status_changed', { from: oldStatus, to: input.status })
        );
      }
    }

    // 老留言没有优先级列，所以整段跳过。
    if (input.priority !== undefined && !ref.legacy) {
      if (!PRIORITIES.includes(input.priority)) fail(400, '优先级无效');
      changes.priority = input.priority;
      if (input.priority !== row.priority) {
        events.push(
          ticketEvent(db, ref.ref, actor(admin), 'priority_changed', {
            from: row.priority,
            to: input.priority,
          })
        );
      }
    }

    if (input.assignee_id !== undefined) {
      // assignmentCandidate 内部会 fail(404/409/403)，所以空值才返回 null。
      const candidate = input.assignee_id ? await assignmentCandidate(db, row, input.assignee_id) : null;
      changes.assignee_id = candidate?.id || null;
      if (changes.assignee_id !== row.assignee_id) {
        // 人工优先：置 hold 并作废 token，让 _core/dispatch.js 的自动派单让路。
        changes.dispatch_hold = 1;
        changes.dispatch_token = null;
        changes.dispatch_note = '人工派单，自动系统不覆盖';
      }
      if (changes.assignee_id !== row.assignee_id) {
        events.push(
          ticketEvent(db, ref.ref, actor(admin), 'assigned', {
            from: row.assignee_id || null,
            to: changes.assignee_id,
            name: candidate?.username || null,
            // 声明成 ai / rules 的人工派单，前端会标成「系统推荐」样式。
            mode: ['ai', 'rules'].includes(input.assignment_mode) ? input.assignment_mode : 'manual',
          })
        );
      }
    }

    let replyText;
    if (input.admin_reply !== undefined) {
      replyText = string(input.admin_reply, '回复', 2000, { required: false });
      // 只在内容真的变了才记事件，避免空提交刷屏。
      if (replyText !== row.admin_reply) {
        changes.admin_reply = replyText;
        changes.replied_by = admin.id;
        changes.replied_at = new Date().toISOString();
        events.push(
          ticketEvent(db, ref.ref, actor(admin), 'replied', {
            reply: replyText,
            previous_reply: row.admin_reply || null,
          })
        );
      }
    }

    if (input.public_visible !== undefined) {
      if (![true, false, 0, 1].includes(input.public_visible)) fail(400, '公开处理值无效');
      // 没勾同意公开就不许公开，避免替提交者做决定。
      if (input.public_visible && !row.public_consent) fail(409, '提交者未同意公开处理');
      changes.public_visible = input.public_visible ? 1 : 0;

      if (input.public_visible) {
        // 公开文案缺省回落到内部文案，公开答复缺省回落到这次的管理员回复。
        changes.public_title = string(
          input.public_title ?? row.public_title ?? row.title ?? row.name,
          '公开标题',
          120
        );
        changes.public_body = string(
          input.public_body ?? row.public_body ?? row.body ?? row.content,
          '公开内容',
          2000
        );
        changes.public_reply = string(
          input.public_reply ?? row.public_reply ?? replyText ?? row.admin_reply ?? '',
          '公开答复',
          2000,
          { required: false }
        );
        // 公开答复与内部答复一致时，署名给真正回复的那个人。
        changes.public_reply_by =
          changes.public_reply === (replyText ?? row.admin_reply)
            ? changes.replied_by || row.replied_by || admin.id
            : admin.id;
      }

      events.push(
        ticketEvent(
          db,
          ref.ref,
          actor(admin),
          input.public_visible ? 'published' : 'unpublished',
          { public_consent: !!row.public_consent }
        )
      );
    }

    const files = input.attachment_ids?.length
      ? await validateFiles(c, input.attachment_ids, await uploadActor(c))
      : [];
    if (files.length) {
      events.push(
        ticketEvent(db, ref.ref, actor(admin), 'attachments_added', {
          names: files.map((f) => f.name),
        })
      );
    }

    // 办结要发奖励：已派单的工单必须由承办人（或超管）亲自结，且要有处理结果。
    let reward = null;
    const completing = input.status === 'resolved' && oldStatus !== 'resolved';
    if (completing && row.assignee_id) {
      // 边改派单边办结是不允许的：奖励会发给错的人。
      if (input.assignee_id !== undefined && Number(input.assignee_id) !== row.assignee_id) {
        fail(409, '请先完成派单，再由承办人办结');
      }
      if (admin.id !== row.assignee_id && admin.role !== 'super') {
        fail(403, '仅承办人或超管可办结已派工单');
      }
      if (!(replyText ?? row.admin_reply)?.trim()) fail(400, '请填写处理结果后再办结');
      await assignmentCandidate(db, row, row.assignee_id);
      reward = await rewardOperations(db, ref.ref, row.assignee_id);
    }

    if (!Object.keys(changes).length && !files.length) fail(400, '没有可更新字段');

    /** 攒这一批要顺序执行的所有写操作，最后一次 batch。 */
    const ops = [];

    if (Object.keys(changes).length) {
      ops.push(
        db
          .prepare(
            `UPDATE ${ref.table} SET ${Object.keys(changes)
              .map((k) => k + '=?')
              .join(',')}${ref.legacy ? '' : ",updated_at=datetime('now')"} WHERE id=?`
          )
          .bind(...Object.values(changes), ref.id)
      );
    }

    for (const file of files) {
      ops.push(
        db
          .prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)')
          .bind(file.id, ref.ref)
      );
    }

    // 工单办结时，源留言也要一起拨状态并同步答复。
    if (
      !ref.legacy &&
      row.source_table === 'messages' &&
      row.source_id &&
      (changes.status !== undefined || changes.admin_reply !== undefined)
    ) {
      ops.push(
        db
          .prepare(
            'UPDATE messages SET status=?,admin_reply=?,replied_at=?,replied_by=? WHERE id=?'
          )
          .bind(
            LEGACY_STATUS_BACK[input.status || row.status],
            replyText ?? row.admin_reply,
            changes.replied_at || row.replied_at,
            changes.replied_by || row.replied_by,
            row.source_id
          )
      );
    }

    // 报名类工单办结时把源表也拨过去（预约/驾照/卡丁车/试车）。
    if (!ref.legacy && row.source_table in SOURCE_STATUS && input.status) {
      ops.push(
        db
          .prepare(`UPDATE ${row.source_table} SET status=? WHERE id=?`)
          .bind(SOURCE_STATUS[row.source_table][input.status], row.source_id)
      );
    }

    if (changes.admin_reply && row.player_id) {
      ops.push(
        db
          .prepare(
            "INSERT INTO notification_log(player_id,type,title,body,link) VALUES(?,'message_reply','市政厅已回复你的工单',?,'/profile.html')"
          )
          .bind(row.player_id, changes.admin_reply)
      );
    }

    // 客服对话类工单的回复要同步成灯灯的私信，玩家在私信页才看得到。
    if (row.source_table === 'support' && changes.admin_reply && row.player_id) {
      const bot = await getOrCreateAiBot(c.env);
      ops.push(
        db
          .prepare(
            'INSERT INTO direct_messages(from_player_id,to_player_id,content,replied_by_admin_id) VALUES(?,?,?,?)'
          )
          .bind(bot.id, row.player_id, changes.admin_reply, admin.id)
      );
    }

    // 人工改优先级要同步刷新分诊记录。
    if (changes.priority !== undefined && changes.priority !== row.priority) {
      ops.push(manualTriage(db, ref.ref, changes.priority, admin));
    }

    ops.push(...events);

    // reward.operations 有三条（建奖励行 / 标记已付 / 加玩家余额）。
    // 记下它们的起始下标，才能在结果里取到「加余额」那条的 changes。
    const rewardIndex = ops.length;
    if (reward) ops.push(...reward.operations);

    const result = await db.batch(ops);

    return reply({
      id: ref.ref,
      updated: true,
      reward: reward
        ? {
            // 真正加上余额才算发成功，否则 amount 报 0。
            amount: result[rewardIndex + 1]?.meta.changes ? 10 : 0,
            pending: !reward.playerId,
            player_name: reward.playerName || null,
          }
        : null,
    });
  });
