/**
 * 市民视角的工单详情弹窗（/api/tickets?my=1）。
 *
 * 原来 viewCitizenTicket 是 js/app/ticket-form.js 里第二个超长单行：一张
 * 700 多字符的模板串 + 三个事件处理器 + 递归重开的逻辑。现在把「画什么」
 * 拆成若干命名片段，把「按钮干了什么」各自独立成函数。
 *
 * 六个不能改的行为：
 *   1. **改完就重开弹窗**（consent 切换、递补充之后都是
 *      dialog.close() → onChanged() → 再 viewCitizenTicket 一遍）。
 *      不是「原地刷新」：工单状态、公开状态、时间线、剩余附件数全都变了，
 *      重新拉一次比在旧 DOM 上打补丁可靠。
 *   2. **附件名额用完就没有提交按钮**。remaining<=0 时 submit 传 null，
 *      js/ui/dialog.js 就不渲染那个 primary 按钮 —— 不能改成「总是显示但点了报错」。
 *   3. **补附件要先判空**：`if(!ids.length) throw` 让错误显示在弹窗的
 *      .form-error 上，而不是静默发一个空数组上去。
 *   4. **consent-toggle 按钮在转人工单上要藏起来**（ticket.private_support）。
 *      转人工工单按产品约定始终私密，不给公开授权的入口。
 *   5. **时间线要重画**，所以 bindFeedback(dialog) 必须在 innerHTML 写完之后、
 *      挂事件之前调用一次；reply_feedback 那段就是靠它把评价控件绑上。
 *   6. **onChanged 抛错只弹提示**。工单已经改成功，只是回调方刷新失败。
 */

import { $, api, post, patch, field, modal, toast, esc, text, ticketBody, status, action, date } from '../../core.js';
import { feedbackMarkup, bindFeedback } from '../../reply-feedback.js';
import { attachmentPicker, renderAttachments } from '../../attachments.js';
import { MAX_ATTACHMENTS } from '../../../../shared/uploads.js';
import { replyAuthor, ticketTimeline } from './timeline.js';

/** 四段进度。注意「结案了」用的是子串判断，原样保留。 */
function progressMarkup(t) {
  const stages = [
    ['递上来了', true],
    ['有人接手', t.status === 'in_progress' || !!t.admin_reply],
    ['有回话', !!t.admin_reply],
    ['结案了', 'resolved'.includes(t.status)],
  ];
  return `<ol class="ticket-progress" aria-label="工单进度">${stages
    .map(([label, done]) => `<li class="${done ? 'done' : ''}">${done ? '✓ ' : '○ '}${label}</li>`)
    .join('')}</ol>`;
}

/** 这单现在给谁看。三种状态互斥，顺序不能调换。 */
function visibilityText(ticket) {
  if (ticket.public_visible) return '已挂上公开页';
  if (ticket.public_consent) return '你同意了，等人过目';
  return '只你自己看';
}

/** 被投诉的管理员 / 被举报的玩家 */
function targetsMarkup(ticket) {
  const admin = ticket.target_admin_id ? `<p>被投诉的管理员 #${ticket.target_admin_id}</p>` : '';
  // 没搜到人时 target_player_id 是空的，这时标注「你自己填的名字」
  const player = ticket.target_player_name
    ? `<p>被举报的玩家：${esc(ticket.target_player_name)} ${
        ticket.target_player_id ? '#' + ticket.target_player_id : '（你自己填的名字）'
      }</p>`
    : '';
  return admin + player;
}

/** 人工回复和灯灯的自动回复，分成两张 notice */
function repliesMarkup(ticket) {
  const human = ticket.admin_reply
    ? `<div class="notice"><b>${esc(replyAuthor(ticket))}</b><small> · ${date(ticket.replied_at)}</small><p>${text(ticket.admin_reply)}</p></div>`
    : '';
  const auto = ticket.auto_reply
    ? `<div class="notice"><b>灯灯 · 自动回的话</b><p>${text(ticket.auto_reply)}</p></div>`
    : '';
  return human + auto;
}

/** 办结奖励。金额 10 是产品定的写死文案，后端按 ticket_rewards 账本发放。 */
function rewardMarkup(ticket) {
  if (!ticket.reward) return '';
  const paid = ticket.reward.paid ? '已发到账' : '等承办人绑了市民账号再发';
  return `<p class="notice">办结奖励：10 💎 · ${paid} · 市政厅 #${ticket.reward.admin_id}</p>`;
}

/** 「再补两句」区块。只交承办人，不进公开页。 */
function followupMarkup() {
  return (
    `<section class="ticket-followup">` +
    `<h3>再补两句</h3>` +
    field('followup_kind', '类型', 'select', 'followup', {
      options: [['followup', '补充情况'], ['question', '我要问一句']],
    }) +
    field('followup_content', '补充内容', 'textarea', '', { required: false, maxlength: 2000 }) +
    `<button type="button" id="ticket-followup-send">递补充</button>` +
    `<p class="muted">这段只交给承办人，不进公开页。工单已经结案的，收到新话会重新开起来。</p>` +
    `</section>`
  );
}

/** 最近两条回复的有用性评价控件 */
function replyFeedbackMarkup(ticket) {
  return `<section>${(ticket.reply_feedback || [])
    .slice(0, 2)
    .map(
      (f) =>
        `<h4>${f.action === 'auto_replied' ? '灯灯的回话' : '人的回话'}</h4>${feedbackMarkup('ticket', f.id, f.helpful)}`
    )
    .join('')}</section>`;
}

/** 弹窗主体。整串 HTML 拼装，顺序即页面从上到下。 */
function ticketDetailMarkup(ticket) {
  return (
    `<div class="wide">` +
    progressMarkup(ticket) +
    `<div class="row-head">${status(ticket.status)}<span>${visibilityText(ticket)}</span></div>` +
    `<div>${ticketBody(ticket.body)}</div>` +
    targetsMarkup(ticket) +
    repliesMarkup(ticket) +
    renderAttachments(ticket.attachments) +
    rewardMarkup(ticket) +
    `<button type="button" id="consent-toggle">${ticket.public_consent ? '收回公开授权' : '同意公开'}</button>` +
    ticketTimeline(ticket.history) +
    followupMarkup() +
    replyFeedbackMarkup(ticket) +
    `</div>`
  );
}

/**
 * 打开市民自己的工单详情。
 * @param {string|number} id
 * @param {object} opts
 * @param {() => Promise<void>} [opts.onChanged] 改动成功后的刷新回调
 * @returns {Promise<Element>} 弹窗元素
 */
export async function viewCitizenTicket(id, { onChanged = () => {} } = {}) {
  const data = await api('/api/tickets?my=1&id=' + encodeURIComponent(id));
  const ticket = data.ticket;
  let picker;

  // 这单还能再补几个附件。已经满了就不给提交按钮（submit 传 null）
  const remaining = MAX_ATTACHMENTS - (ticket.attachments || []).length;

  const dialog = modal(ticket.title, ticketDetailMarkup(ticket), {
    wide: true,
    label: '补附件',
    submit:
      remaining > 0
        ? async () => {
            const ids = picker.ids();
            // 空数组也发过去会被后端当 0 件处理，用户以为传上去了其实没有
            if (!ids.length) throw new Error('先挑个文件再递');
            await post('/api/ticket-attachments', {
              ticket_id: String(ticket.id),
              attachment_ids: ids,
            });
            picker.commit();
            toast('材料补上了');
            try {
              await onChanged();
            } catch (e) {
              toast(e.message, true);
            }
          }
        : null,
  });

  if (remaining > 0) {
    picker = attachmentPicker(dialog, {
      max: remaining,
      existingBytes: (ticket.attachments || []).reduce((sum, f) => sum + f.size, 0),
    });
  }

  // innerHTML 写完之后再绑：评价控件是重画出来的，绑早了会被冲掉
  bindFeedback(dialog);

  $('#ticket-followup-send', dialog).onclick = (e) =>
    action(e.currentTarget, async () => {
      await post('/api/ticket-updates', {
        ticket_id: id,
        kind: $('[name=followup_kind]', dialog).value,
        content: $('[name=followup_content]', dialog).value,
      });
      toast('递上去了');
      dialog.close();
      await onChanged();
      // 结案单被追问后会自动重开，状态和按钮都变了 → 整个重开
      await viewCitizenTicket(id, { onChanged });
    });

  const consent = $('#consent-toggle', dialog);
  // 转人工工单始终私密，不给公开授权的入口
  consent.hidden = ticket.private_support;
  consent.onclick = (e) =>
    action(e.currentTarget, async () => {
      await patch('/api/tickets?my=1&id=' + encodeURIComponent(id), {
        public_consent: !ticket.public_consent,
      });
      dialog.close();
      await onChanged();
      await viewCitizenTicket(id, { onChanged });
    });

  return dialog;
}
