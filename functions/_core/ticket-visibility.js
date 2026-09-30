/** 玩家侧时间线只放行这几个状态；其他内部状态不外泄 */
const visibleStates = ['open', 'in_progress', 'resolved', 'closed'];

/** 玩家可见的工单字段白名单，顺序即返回给前端的字段顺序 */
const citizenFields = [
  'id',
  'title',
  'body',
  'kind',
  'category',
  'status',
  'created_at',
  'replied_at',
  'admin_reply',
  'auto_reply',
  'replied_by',
  'reply_author_name',
  'public_consent',
  'public_visible',
  'target_player_id',
  'target_player_name',
  'target_admin_id',
  'attachments',
  'attachment_count',
  'reply_feedback',
];

/**
 * 一条工单事件 → 玩家可见的时间线条目。
 *
 * 返回数组而不是单条：这样「这条不显示」就能直接表达成 `[]`，
 * 外层 flatMap 不需要额外的 continue。
 */
function timelineEntry(event, details) {
  // 默认当成一条无内容的系统事件；下面各分支只覆盖自己关心的字段
  const base = {
    id: event.id,
    created_at: event.created_at,
    actor_type: 'system',
    actor_name: '工单进度',
    action: event.action,
    details: '{}',
  };
  const replyDetails = () => JSON.stringify({ reply: details.reply || '' });

  // 玩家提交和系统建单在时间线上是同一件事，统一呈现为「已创建」
  if (['created', 'human_requested'].includes(event.action)) {
    return [{ ...base, action: 'created' }];
  }

  if (['replied', 'auto_replied'].includes(event.action)) {
    return [
      {
        ...base,
        actor_type: event.actor_type,
        actor_id: event.actor_id,
        actor_name: event.actor_name,
        details: replyDetails(),
      },
    ];
  }

  if (['player_followup', 'player_question'].includes(event.action)) {
    // 玩家自己发的内容，actor 强制标成 player，不采信事件里记的 actor_type
    return [
      {
        ...base,
        actor_type: 'player',
        actor_id: event.actor_id,
        actor_name: event.actor_name,
        details: replyDetails(),
      },
    ];
  }

  if (event.action === 'status_changed' && visibleStates.includes(details.to)) {
    return [{ ...base, details: JSON.stringify({ to: details.to }) }];
  }

  // reopened 对玩家来说就是「状态变回 open」
  if (event.action === 'reopened') {
    return [{ ...base, action: 'status_changed', details: JSON.stringify({ to: 'open' }) }];
  }

  // 附件与授权变更只留一个时间戳，不带任何内容
  if (['attachments_added', 'consent_changed'].includes(event.action)) {
    return [base];
  }

  // 其余是内部事件（指派、内部备注等），一律不外泄
  return [];
}

/** 工单事件流 → 玩家可见的时间线 */
export function citizenTimeline(events = []) {
  return events.flatMap((event) => {
    let details = {};
    try {
      details = JSON.parse(event.details || '{}');
    } catch {
      // details 里存了脏数据也不能让整条时间线挂掉，退回空对象
    }
    return timelineEntry(event, details);
  });
}

/** 整张工单 → 玩家可见的字段集。只透出白名单里的字段 */
export function citizenTicket(t) {
  const out = Object.fromEntries(
    citizenFields.filter((key) => t[key] !== undefined).map((key) => [key, t[key]])
  );

  out.private_support = t.source_table === 'support';
  if (t.history) out.history = citizenTimeline(t.history);
  return out;
}
