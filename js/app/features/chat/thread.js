/**
 * 私信线程：会话头 + 消息气泡列表。
 *
 * 这里原本是 chat/index.js 里最长的两行，混着轮询、增量判断、
 * 滚动位置保持、输入框防打断、AI 助手快捷问题、事务提醒。
 * 现在只留「线程的骨架」和「把一条消息画成气泡」两件事。
 *
 * 三个不能改掉的行为，都是踩过坑的：
 *   1. 用户正打在输入框 / 下拉框里时，轮询回来不能重画 —— 会吞掉正在打的字
 *   2. 重画前先量一次「离底部多近」，贴底才自动滚到底，否则会把人正在翻的
 *      历史拽回最新一条
 *   3. 「最后一条消息 id 没变」就直接跳过整个重画，连 DOM 都不碰
 */

import { $, $$, text, date, empty, esc, state } from '../../core.js';
import { feedbackMarkup, bindFeedback } from '../../reply-feedback.js';
import { sourceLinks } from './sources.js';

/** 离底部多少像素以内算「贴着底」 */
const NEAR_BOTTOM = 80;

/** 灯灯客服的固定用户名。全站多处按名字判定 AI 会话，提到一个常量里。 */
export const ASSISTANT = '灯灯客服';

/**
 * 取「当前焦点元素」。浮动助手把聊天挂在一棵独立 DOM 分支上，
 * document.activeElement 不一定抓得到，退回 root 上的 activeElement。
 */
export function focusedElement(box) {
  const root = box.getRootNode?.();
  return root?.activeElement || document.activeElement;
}

/** 焦点是不是落在会丢内容的控件上（输入框 / 下拉框） */
export function isTypingHere(box, container) {
  const active = focusedElement(box);
  return !!active && container.contains(active) && active.matches('textarea,select');
}

/** 线程骨架：会话头 + 消息区 + （仅灯灯）反馈槽 / 客服面板 / 快捷问题 / 事务提醒 */
export function threadMarkup({ peer, isAssistant }) {
  return (
    `<div class="row-head"><h2>${esc(peer.username)}</h2>` +
    `<a href="/profile.html?u=${encodeURIComponent(peer.username)}">主页 ↗</a></div>` +
    `<div class="messages" aria-label="消息记录"></div>` +
    (isAssistant
      ? `<section class="chat-assistance" aria-label="回复反馈与人工客服">` +
        `<div id="latest-reply-feedback"></div><div id="support-status"></div></section>` +
        `<p id="assistant-reminder" class="notice" aria-live="polite"></p>` +
        `<div class="actions assistant-shortcuts">` +
        `<button type="button" data-ask="我最近有哪些事务需要关注？">我的近况</button>` +
        `<button type="button" data-ask="我的工单和考试进度怎么样？">办理进度</button>` +
        `<a class="button" href="/affairs.html">查看我的事务与提醒</a></div>`
      : '')
  );
}

/** 快捷问题点一下就把话填进输入框，光标落在末尾让人接着写 */
export function bindShortcuts(box) {
  $$('[data-ask]', box).forEach((b) => {
    b.onclick = () => {
      const input = $('[name=content]', box);
      input.value = b.dataset.ask;
      input.focus();
    };
  });
}

/**
 * 画消息气泡。
 * @param {Element} box       线程容器
 * @param {object} opts
 * @param {Array}  opts.messages   /api/social?action=dm-thread 的 messages
 * @param {boolean} opts.isAssistant 是否与灯灯客服对话
 * @param {number} opts.ratedId  当前已选中评价的那条回复 id（它不再重复出控件）
 * @param {number} opts.lastDrawn 上一轮画到的最后一条消息 id
 * @returns {boolean} 真的重画了才返回 true —— 调用方靠它决定要不要补 dm-read
 */
export function drawMessages(box, { messages, isAssistant, ratedId, lastDrawn }, force = false) {
  const target = $('.messages', box);
  if (!target) return false;

  const last = messages.at(-1)?.id || 0;
  if (!force && last === lastDrawn) return false;
  if (!force && isTypingHere(box, target)) return false;

  const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < NEAR_BOTTOM;
  const mine = state.session.player.id;

  target.innerHTML =
    messages
      .map((m) => {
        const byAdmin = m.replied_by_admin_id
          ? esc('人工客服 #' + m.replied_by_admin_id + ' · ' + (m.reply_author_name || '')) + ' · '
          : '';
        // 评价控件只挂在「灯灯客服发给我的回复」上，且不跟反馈槽里那条重复
        const canRate = isAssistant && m.to_player_id === mine && m.id !== ratedId;
        return (
          `<div class="bubble ${m.from_player_id === mine ? 'mine' : ''}">` +
          `<p>${text(m.content)}</p>` +
          sourceLinks(m.knowledge_sources) +
          `<small>${byAdmin}${date(m.created_at)}</small>` +
          (canRate ? feedbackMarkup('dm', m.id, m.helpful) : '') +
          `</div>`
        );
      })
      .join('') || empty();

  bindFeedback(target);
  if (force || nearBottom) target.scrollTop = target.scrollHeight;
  return true;
}
