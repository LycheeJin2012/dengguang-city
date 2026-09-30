/**
 * 工单卡片：工单墙上的一张（预览态和列表态共用）。
 *
 * 原来 card() 是 features/ticket-center/index.js 里的一行 900 字符模板串，
 * 三元嵌套出「预览 / 完整 / 我的 / 公开」四种组合。现在按「头部 / 正文 /
 * 两条回复 / 操作区」四段拆开。
 *
 * 三个不能改的点：
 *   1. **compact（预览卡）只出标题、状态、时间和按钮**：不出正文，也不出
 *      灯灯/人这两条回复。首页只放一条，不能被一条长回复撑开。
 *   2. **data-mine 决定点开走哪条路**：'1' 是本人的单 → 市民详情弹窗（带附件、
 *      时间线、补充）；'0' 是公开单 → 公开详情弹窗（只读 + 评论）。
 *      这个标记由 card() 写、index.js 的 bind() 读，两边都要改。
 *   3. **私密角标只有本人的单才有**。公开页上的卡片不显示「私密」标签 ——
 *      能出现在公开列表里的单已经不是私密单了，标出来是错的。
 */

import { esc, text, ticketBody, date, status } from '../../core.js';
import { replyAuthor } from '../../ticket-form.js';

/** 本人单右上角的可见性角标。三态互斥，顺序不能调。 */
function visibilityBadge(t) {
  if (t.public_visible) return '已公开';
  if (t.public_consent) return '待审核公开';
  return '私密';
}

/**
 * @param {object} t        /api/tickets 返回的一条
 * @param {boolean} mine    是否本人的单
 * @param {boolean} compact 预览态：只出摘要
 */
export function ticketCard(t, mine, compact = false) {
  const body = compact ? '' : `<div>${ticketBody(t.body)}</div>`;

  // 两条回复在预览态一律不出
  const auto = !compact && t.auto_reply
    ? `<div class="notice"><b>灯灯 · 自动基础回复</b><p>${text(t.auto_reply)}</p></div>`
    : '';
  const human = !compact && t.admin_reply
    ? `<div class="notice"><b>${esc(replyAuthor(t))}</b><p>${text(t.admin_reply)}</p></div>`
    : '';

  const label = mine ? '办理记录 / 附件' : '查看公开详情';
  const badge = mine ? `<span class="badge">${visibilityBadge(t)}</span>` : '';

  return (
    `<article class="panel ${compact ? 'ticket-preview' : ''}">` +
    `<div class="row-head"><h3>${esc(t.title)}</h3>${status(t.status)}</div>` +
    body +
    `<small>${date(t.created_at)}</small>` +
    auto +
    human +
    `<div class="actions">` +
    `<button data-ticket="${esc(t.id)}" data-mine="${mine ? '1' : '0'}">${label}</button>` +
    badge +
    `</div>` +
    `</article>`
  );
}
