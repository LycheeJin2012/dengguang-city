/**
 * 人工客服面板：转人工 / 结束等待 / 关联工单 / 建议提交工单。
 *
 * 这是整个私信里分支最多的地方：面板上会出现哪几个按钮，取决于
 * support_chats 那一行的 status 和两个标记位。原代码把这些分支
 * 压在一行 500 字符的模板串里，现在按状态拆成命名分支。
 *
 * 状态来自 /api/support 的 chat 字段：
 *   status        null | queued(排队等人工) | active(人工已接入) | closed
 *   auto_handoff  false 表示「不再自动转人工」
 *   needs_ticket  客服建议走工单
 *   linked_ticket_id 已经关联上的工单
 *   revision      乐观锁用的版本号，取消会话时要带回去
 */

import { $, api, post, action } from '../../core.js';
import { createTicket, viewCitizenTicket } from '../../ticket-form.js';
import { placeSupportActions } from './feedback.js';

const COPY = {
  queued: '已转人工，正在等待客服接入。继续在这个聊天补充说明即可。',
  active: '人工客服已接入，灯灯自动回复已暂停。',
  manual: '已结束人工等待。可以继续与灯灯交流，需要时手动转人工。',
  idle: '灯灯会根据资料组织答复；无法可靠回答时，会在当前聊天自动转人工。',
};

function statusCopy(chat) {
  if (!chat) return COPY.idle;
  if (chat.status === 'queued') return COPY.queued;
  if (chat.status === 'active') return COPY.active;
  if (chat.auto_handoff === false) return COPY.manual;
  return COPY.idle;
}

/** 面板上的按钮组，按当前状态挑该出现的 */
function actionsMarkup(chat) {
  const busy = chat?.status === 'queued' || chat?.status === 'active';
  const endLabel = chat?.status === 'queued' ? '结束等待' : '结束人工会话';

  let out = '';
  if (busy) {
    out += `<button type="button" id="end-support">${endLabel}</button>`;
  } else {
    out += '<button type="button" id="handoff">转人工</button>';
  }
  out += '<button type="button" id="support-refresh">刷新回复</button>';

  if (chat?.linked_ticket_id) {
    out += '<button type="button" id="linked-ticket">查看已提交工单</button>';
  } else if (chat?.needs_ticket) {
    out += '<button type="button" class="primary" id="suggested-ticket">提交工单</button>';
  }
  return `<div class="actions" id="support-actions">${out}</div>`;
}

/**
 * 画客服面板并挂上按钮。
 * @param {() => Promise<void>} refresh  拉完新数据后的统一刷新回调
 * @returns {number} 面板当前的 revision
 */
export async function drawSupport(box, { refresh, isCurrent }) {
  const result = await api('/api/support');
  if (!isCurrent() || !box.isConnected) return null;

  const chat = result.chat;
  const bar = $('#support-status', box);
  if (!bar) return null;

  // 控件要移走重画，否则会被 innerHTML 冲掉（反馈槽要的就是这个）
  $('#support-actions', box)?.remove();

  const suggest = chat?.needs_ticket && !chat.linked_ticket_id;

  bar.innerHTML =
    `<p>${statusCopy(chat)}</p>` +
    actionsMarkup(chat) +
    (suggest ? '<p>人工客服建议通过工单继续处理。点击后可核对问题说明，再确认提交。</p>' : '');

  $('#support-refresh', bar).onclick = (e) => action(e.currentTarget, refresh);

  if ($('#handoff', bar)) {
    $('#handoff', bar).onclick = (e) =>
      action(e.currentTarget, async () => {
        await post('/api/support', {});
        await refresh();
      });
  }

  if ($('#end-support', bar)) {
    $('#end-support', bar).onclick = (e) =>
      action(e.currentTarget, async () => {
        await post('/api/support', { action: 'cancel', revision: chat.revision });
        await refresh();
      });
  }

  if ($('#linked-ticket', bar)) {
    $('#linked-ticket', bar).onclick = (e) =>
      action(e.currentTarget, () => viewCitizenTicket(chat.linked_ticket_id));
  }

  if ($('#suggested-ticket', bar)) {
    $('#suggested-ticket', bar).onclick = (e) =>
      action(e.currentTarget, () =>
        createTicket({
          kind: 'service',
          initial: { title: '人工客服建议跟进的问题', body: chat.ticket_summary || '' },
          onCreated: async (t) => {
            await post('/api/support', { action: 'link-ticket', ticket_id: t.id });
            await refresh();
          },
        })
      );
  }

  placeSupportActions(box);
  return chat?.revision ?? 0;
}
