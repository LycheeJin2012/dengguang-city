/**
 * 工单时间线：把 ticket_events 那几行流水账画成「办到哪一步了」。
 *
 * 原来这部分和 createTicket / viewCitizenTicket 挤在 js/app/ticket-form.js 的
 * 一行里（单行 2200+ 字符），其中光「每种 action 后面接什么补充说明」就有
 * 七个三元嵌套。现在把「文案表」「谁做的」「补充说明」三件事分开写。
 *
 * 四个不能改的行为：
 *   1. **details 是不可信 JSON**。event.details 由后端拼装，历史数据里存在
 *      解析不了的情况，所以 try/catch 吞掉后退化成 {}，绝不能让一条坏事件
 *      把整张时间线炸掉。
 *   2. **actor 的四个分支**（system / admin / hotel_owner / 其余=市民）。
 *      未知 actor_type 落到「市民」，这是有意的兜底：宁可显示错身份，
 *      也不能显示成空白。
 *   3. **补充说明是「追加」不是「互斥」**。原式是一串独立的 `${cond ? x : ''}`
 *      拼接，`assigned` 那条同时可能输出两段（派给了谁 + 自动派单理由）。
 *      改成互斥的 if/else 会把「自动派单理由」整段吃掉 —— 所以 assigned
 *      分支里先拼「派给了谁」再拼「怎么自动派的」。
 *   4. **只有带回复正文的四种 action 才渲染 <div> 里的回复**：
 *      replied / auto_replied / player_followup / player_question。
 *      少了 player_followup，市民自己的补充就不会出现在时间线上。
 */

import { esc, text, status, date } from '../../core.js';

/** action → 给人看的话。表里没有的直接显示原始 action，不做二次翻译。 */
const ACTION_LABELS = {
  triage_resumed: '重新交给机器分级',
  triaged: '内部掂了掂轻重',
  priority_changed: '改了内部轻重',
  reopened: '又捡起来办',
  player_question: '市民追问',
  auto_replied: '灯灯自动回话',
  human_requested: '要求转人工',
  player_followup: '市民补了情况',
  dispatch_deferred: '自动派单先按住',
  business_updated: '关联业务有变',
  created: '递交工单',
  assigned: '派给了谁',
  replied: '有人回复',
  status_changed: '状态变了',
  published: '挂上公开页',
  unpublished: '撤下公开',
  consent_changed: '改了公开授权',
  attachments_added: '补了附件',
};

/** 这几种 action 的 details.reply 里带的是「这一条回复的正文」 */
const REPLY_ACTIONS = ['replied', 'auto_replied', 'player_followup', 'player_question'];

/** 谁做的。未知类型一律按市民显示，不留空。 */
function actorText(e) {
  const role =
    e.actor_type === 'system' ? '市政厅机器'
    : e.actor_type === 'admin' ? '市政厅'
    : e.actor_type === 'hotel_owner' ? '酒店老板'
    : '市民';
  return role + (e.actor_id ? ' #' + e.actor_id : '') + ' · ' + e.actor_name;
}

/**
 * 每种 action 在「做了什么」后面追加的那一截。
 * 返回值是原样拼进 <p> 的 HTML 片段，可能为空串。
 */
function eventDetail(e, d) {
  if (e.action === 'assigned') {
    // 派单对象：d.to 是承办人 id，没有就是还没落到人头上
    const who = d.to ? '#' + d.to + ' ' + (d.name || '') : '还没落到人';
    // 自动派单（mode==='automatic'）要额外说明是 AI 判的还是规则判的、为什么。
    // 注意这和上面那段是「追加」关系，不是二选一。
    const how =
      d.mode === 'automatic'
        ? ` · ${esc(d.source === 'ai' ? 'AI 自动派单' : '规则自动派单')}<br>${esc(d.reason || '')}`
        : '';
    return ` → ${esc(who)}${how}`;
  }
  if (e.action === 'dispatch_deferred') return ` · ${esc(d.reason || '')}`;
  if (e.action === 'triaged') {
    return ` · ${esc(d.priority || '')} / ${esc(d.urgency || '')} / ${esc(d.complexity || '')}<br>${esc(d.reason || '')} · ${esc(d.source || '')}`;
  }
  if (e.action === 'priority_changed') return ` · ${esc(d.from || '')} → ${esc(d.to || '')}`;
  if (e.action === 'business_updated') return ` · ${status(d.status)}`;
  if (e.action === 'status_changed') return ` · ${status(d.to)}`;
  return '';
}

/** 一条事件 */
function eventRow(e) {
  // 历史 details 可能是坏 JSON，解析不了就当空对象，不让整条时间线崩掉
  let d = {};
  try {
    d = JSON.parse(e.details);
  } catch {
    /* 保持 {} */
  }

  const reply = REPLY_ACTIONS.includes(e.action) ? `<div>${text(d.reply)}</div>` : '';

  return (
    `<div class="row">` +
    `<div class="row-head"><b>${esc(actorText(e))}</b><small>${date(e.created_at)}</small></div>` +
    `<p>${esc(ACTION_LABELS[e.action] || e.action)}${eventDetail(e, d)}</p>` +
    reply +
    `</div>`
  );
}

/**
 * 回复署名。转人工之前的老数据没有署名行，所以有一句专门的兜底文案。
 * @param {{replied_by?:number, reply_author_name?:string}} t
 */
export const replyAuthor = (t) =>
  t.replied_by
    ? `市政厅 #${t.replied_by} · ${t.reply_author_name || '没留名字'}`
    : '这条旧回复没留署名';

/**
 * 画整段时间线。
 * @param {Array<object>} events /api 返回的 ticket.history
 * @returns {string} HTML
 */
export function ticketTimeline(events = []) {
  const body = events.length
    ? events.map(eventRow).join('')
    : `<p class="muted">这单还新，除了你递上来那一句，没人动过。</p>`;

  return `<section class="ticket-history"><h3>办到哪一步了</h3>${body}</section>`;
}
