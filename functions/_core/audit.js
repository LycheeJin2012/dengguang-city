import { readToken } from '../_shared/session.js';

// 原始 statement / SQL 文本 / 绑定参数，挂在被包装的 statement 上，
// 这样 batch 拿到的是一串代理对象时仍能还原出每条语句在写什么。
const RAW = Symbol('statement');
const SQL = Symbol('sql');
const ARGS = Symbol('args');

// 只有这些表值得写审计。查询类语句不记，也不该进 audit_events。
const trackedTables = new Set([
  'support_chats', 'support_chat_events', 'reply_feedback', 'ticket_triage', 'exam_appeals', 'exam_sessions',
  'exam_session_events', 'knowledge_articles', 'exam_question_drafts', 'dispatch_settings', 'admins', 'players',
  'messages', 'direct_messages', 'message_comments', 'bookings', 'kart_signups', 'circuit_signups', 'license_signups',
  'tickets', 'ticket_attachments', 'ticket_rewards', 'ticket_events', 'ticket_comments', 'hotel_owners', 'hotels',
  'hotel_rooms', 'race_tracks', 'race_times', 'license_requirements', 'exam_questions', 'exam_attempts',
  'announcements', 'gallery_items', 'subscriptions', 'notification_log', 'passkeys', 'daily_signin', 'media_uploads',
]);

export async function auditActor(db, request, tokenOverride) {
  const token = tokenOverride || readToken(request);
  if (!token) return { type: 'anonymous', id: null, name: '访客' };

  // 查会话时带上 expires_at：过期会话要当场当匿名处理，而不是当成有效身份。
  const session = await db
    .prepare('SELECT player_id,admin_id,hotel_owner_id,expires_at FROM sessions WHERE token=?')
    .bind(token)
    .first();
  if (!session || !Number.isFinite(+new Date(session.expires_at)) || new Date(session.expires_at) <= new Date()) {
    return { type: 'anonymous', id: null, name: '访客' };
  }

  const type = session.admin_id ? 'admin' : session.hotel_owner_id ? 'hotel_owner' : 'player';
  const id = session.admin_id || session.hotel_owner_id || session.player_id;
  const table = { admin: 'admins', hotel_owner: 'hotel_owners', player: 'players' }[type];
  const account = await db.prepare(`SELECT username FROM ${table} WHERE id=?`).bind(id).first();
  return {
    type,
    id,
    // 账号可能已被注销，但审计记录要留下来。
    name: account?.username || '已注销账号',
    player_id: session.player_id,
    admin_id: session.admin_id,
    owner_id: session.hotel_owner_id,
  };
}

export function auditStatement(db, actor, event) {
  return db
    .prepare(
      'INSERT INTO audit_events(request_id,actor_type,actor_id,actor_name,player_id,admin_id,owner_id,action,resource_type,resource_id,method,path,http_status,details) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    )
    .bind(
      event.request_id || null,
      actor.type,
      actor.id ?? null,
      actor.name,
      actor.player_id ?? null,
      actor.admin_id ?? null,
      actor.owner_id ?? null,
      event.action,
      event.resource_type || 'request',
      event.resource_id ? String(event.resource_id) : null,
      event.method || null,
      event.path || null,
      event.status ?? null,
      JSON.stringify(event.details || {})
    );
}

// 从 SQL 文本里认出「写操作 + 目标表」。认不出就返回 null（不审计）。
function mutation(sql) {
  const matched = /^\s*(INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?([a-z_]+)/i.exec(sql);
  return matched && trackedTables.has(matched[2])
    ? { operation: matched[1].split(/\s/)[0].toLowerCase(), table: matched[2] }
    : null;
}

export function auditedDatabase(db, actor, event) {
  // 决定某条语句要不要补一条审计，返回准备好的 statement 或 null。
  function log(sql, args = []) {
    const matched = mutation(sql);
    if (!matched) return null;

    // ticket_events 的 6 个参数是 (ticket_ref,actor_type,actor_id,actor_name,action,details)，
    // 直接映射成一条人能读的工单事件审计，而不是笼统的 db.INSERT。
    if (matched.table === 'ticket_events' && args.length === 6) {
      let details = {};
      try {
        details = JSON.parse(args[5]);
      } catch {}
      return auditStatement(
        db,
        { type: args[1], id: args[2], name: args[3] },
        {
          ...event,
          action: 'ticket.' + args[4],
          resource_type: 'tickets',
          resource_id: args[0],
          status: 200,
          details,
        }
      );
    }

    return auditStatement(db, actor, {
      ...event,
      action: 'db.' + matched.operation,
      resource_type: matched.table,
      // 只有资源就是这张表时才挂 resource_id，否则 id 属于另一件事，会指错。
      resource_id: event.resource_type === matched.table ? event.resource_id : null,
      status: 200,
      details: { operation: matched.operation },
    });
  }

  // 包一层 prepare：方法调用继续往下传，同时记住这条语句的 SQL 和绑定参数。
  function wrap(statement, sql, args = []) {
    return {
      [RAW]: statement,
      [SQL]: sql,
      [ARGS]: args,
      bind(...values) {
        return wrap(statement.bind(...values), sql, values);
      },
      first(...params) {
        return statement.first(...params);
      },
      all(...params) {
        return statement.all(...params);
      },
      async run() {
        const audit = log(sql, args);
        // 不需要审计就直接执行，保持原返回。
        if (!audit) return statement.run();
        // 写操作和它的审计必须同一批落库，不能出现"改了但没记"或"记了但没改"。
        return (await db.batch([statement, audit]))[0];
      },
    };
  }

  return {
    prepare: (sql) => wrap(db.prepare(sql), sql),
    async batch(statements) {
      const raw = statements.map((s) => s[RAW] || s);
      const logs = statements.map((s) => log(s[SQL] || '', s[ARGS] || [])).filter(Boolean);
      const results = await db.batch([...raw, ...logs]);
      // batch 的返回值是调用方要用的：前 raw.length 条是原语句的结果，后面是我们补的审计。
      return results.slice(0, raw.length);
    },
  };
}

export const actorLabel = (actor) =>
  `${
    actor.type === 'admin' ? '管理员' : actor.type === 'hotel_owner' ? '酒店老板' : actor.type === 'player' ? '玩家' : '访客'
  }${actor.id ? ' #' + actor.id : ''} · ${actor.name}`;
