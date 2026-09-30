/**
 * 「评价这条回复」——只对灯灯客服的回复开放。
 *
 * 跟气泡里的评价控件是同一套东西，但位置不同：反馈槽永远显示**最新一条**
 * 待评价的回复，控件会从客服面板里搬过来，好让「有用 / 没用」紧挨着
 * 正在看的那条回复，而不是散落在消息流里。
 *
 * 从 chat/index.js 拆出来的原因：它有一处很容易写错的分支 ——
 * 用户正要点「没用」的下拉框时，下一轮轮询不能把这个槽整个重画掉，
 * 否则下拉框会弹回默认值、选中的理由丢失。
 */

import { $, esc, state } from '../../core.js';
import { feedbackMarkup, bindFeedback } from '../../reply-feedback.js';
import { isTypingHere } from './thread.js';

/** 客服面板的按钮组要挪到反馈槽里（它们是同一个操作区） */
export function placeSupportActions(box) {
  const controls = $('#support-actions', box);
  const target = $('#latest-reply-feedback .reply-feedback .actions', box);
  if (controls && target) target.append(controls);
}

/**
 * 把反馈槽刷成「评价最新一条回复」。
 * @returns {number} 当前槽里那条回复的 id，-1 表示没有
 */
export function updateReplyFeedback(box, { messages, isAssistant, ratedId }) {
  if (!isAssistant) return ratedId;

  const target = $('#latest-reply-feedback', box);
  if (!target) return ratedId;

  const mine = state.session.player.id;
  const latest = messages.filter((m) => m.to_player_id === mine).at(-1);
  if (!latest || latest.id === ratedId) return ratedId;

  // 正在操作反馈控件（比如展开「没用」的理由下拉）就别换人
  if (isTypingHere(box, target)) return ratedId;

  // 控件先挪出客服面板，客服面板随后要重画，不搬会被一起冲掉
  const controls = $('#support-status', box);
  if (controls) $('#support-status', box).append(controls);

  target.innerHTML =
    '<p class="reply-context">评价这条回复：' + esc(latest.content.slice(0, 70)) + '</p>' +
    feedbackMarkup('dm', latest.id, latest.helpful);

  bindFeedback(target);
  placeSupportActions(box);
  return latest.id;
}
