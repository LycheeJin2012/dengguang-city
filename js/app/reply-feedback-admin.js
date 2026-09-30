/**
 * 管理端「回复反馈监督」页。
 *
 * 玩家对灯灯 / 人工客服的回复点「有用 / 没解决」之后，负面反馈会汇到这里。
 * 这页是给市政厅核实用的线索，不是给玩家看的，也不是绩效表。
 *
 * 只读页面：一个列表，没有筛选、没有分页、没有任何写操作。
 *
 * 三个不能改的渲染细节：
 *   1. 反馈对象是「回复记录 id」不是工单 id，所以文案里写的是「回复 #」
 *   2. 有 ticket_ref 时才补「· 工单 #xx」，纯私信反馈没有这一段
 *   3. reason 是内部枚举键，映射不到就渲染空串（不回落显示英文键）
 */

import { $, api, region, esc, text, date } from './core.js';

/** 反馈原因枚举 → 中文。映射不到就是空串。 */
const REASON_LABELS = {
  not_resolved: '没有解决',
  irrelevant: '答非所问',
  incorrect: '内容有误',
  other: '其他',
};

export async function renderReplyFeedback(el) {
  el.innerHTML =
    '<h2>回复反馈监督</h2>' +
    '<p class="notice">仅管理端查看。负面反馈是需要核实的线索，不代表回复错误或管理员失职。</p>' +
    '<div id="feedback-list"></div>';

  await region(
    $('#feedback-list', el),
    () => api('/api/admin/reply-feedback'),
    (d, box) => {
      box.innerHTML =
        d.feedback
          .map(
            (f) =>
              `<article class="panel">` +
              `<b>${f.helpful ? '👍 有用' : '👎 未解决'} · ${esc(f.username)}</b>` +
              `<p>${esc(f.kind)} 回复 #${esc(f.target_id)}${f.ticket_ref ? ' · 工单 #' + esc(f.ticket_ref) : ''}</p>` +
              `<p>${esc(REASON_LABELS[f.reason] || '')}</p>` +
              `<p>${text(f.comment)}</p>` +
              `<small>${date(f.updated_at)}</small>` +
              `</article>`
          )
          .join('') || '<p>暂无回复反馈。</p>';
    }
  );
}
