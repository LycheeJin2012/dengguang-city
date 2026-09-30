/**
 * 私信工作区（市民私信 + 灯灯助手）。
 *
 * v88.6 重构：原来这个文件 33 行、10KB，每行都超长，同时管着
 *   会话列表 / 线程渲染 / 消息增量判断 / 发送 / 已读 / 5 秒轮询
 *   / 灯灯提醒 / 快捷问题 / 回复评价 / 人工转接
 * 十件事。现在拆成 conversations / thread / feedback / support / composer
 * 五个模块，这里只留**生命周期**和**数据流**。
 *
 * 拆的时候有三个约定必须守住，否则会出很难查的 bug：
 *
 *   1. epoch —— 每次打开会话自增。异步回调里凡是碰 DOM 的都要先核对
 *      epoch 还是自己。切得快的时候，上一个会话的 in-flight 请求会回来，
 *      不挡的话会把新会话的界面冲掉。
 *   2. stillMine = epoch 没变 **且** 节点还在文档里。两个条件缺一不可：
 *      节点被移走时 isConnected 为 false，但仍有人在监听。
 *   3. 轮询自续期 —— 每轮 setTimeout 结束时再决定要不要排下一轮，
 *      不是固定 setInterval。这样标签页隐藏、组件卸载都能干净停掉。
 *      轮询必须定义在 open() 的作用域里，因为它要碰到那一回合的
 *      lastDrawn / ratedId / supportRevision 游标。
 *
 * 对外契约（别的文件依赖，不能改）：
 *   renderChat(el, {assistantOnly, isVisible})
 *   渲染后必须存在 #send-form（assistant-window.js 靠它判断加载完了）
 *   API 路径与 data-* 钩子保持原样
 */

import { $, api, post, patch, region, empty, title, field, modal, action } from '../../core.js';
import { renderConversations } from './conversations.js';
import { threadMarkup, drawMessages, bindShortcuts, ASSISTANT } from './thread.js';
import { updateReplyFeedback, placeSupportActions } from './feedback.js';
import { drawSupport } from './support.js';
import { composerMarkup, bindComposer } from './composer.js';

const POLL_MS = 5000;

export async function renderChat(el, { assistantOnly = false, isVisible = () => true } = {}) {
  let peer = '';
  let epoch = 0;
  let timer = null;

  el.innerHTML =
    (assistantOnly ? '' : title('市民私信')) +
    `<div class="toolbar" ${assistantOnly ? 'hidden' : ''}>` +
    `<button id="new-message" class="primary">＋ 写私信</button>` +
    `<button id="ai-message">🤖 灯灯个人助手</button>` +
    `<a class="button" href="/knowledge.html">查阅知识库</a></div>` +
    `<div class="split"><aside class="panel" id="conversations" ${assistantOnly ? 'hidden' : ''}></aside>` +
    `<section class="panel" id="thread">${empty('选择会话或写一封新私信')}</section></div>`;

  const refreshList = () => renderConversations(el, { peer, onOpen: open });

  /** 打开某个会话 */
  async function open(username) {
    clearTimeout(timer);
    peer = username;
    const version = ++epoch;
    const stillMine = () => version === epoch && el.isConnected;
    const isAssistant = username === ASSISTANT;

    await region(
      $('#thread', el),
      () => api('/api/social?action=dm-thread&peer=' + encodeURIComponent(username)),
      async (data, box) => {
        if (!stillMine()) return;

        box.innerHTML = threadMarkup({ peer: data.peer, isAssistant }) + composerMarkup();

        // ---- 本回合的增量游标 ----
        let lastDrawn = -1;
        let ratedId = null;
        let supportRevision = -1;

        /** 反馈槽先刷，再画气泡 —— 反馈槽不受「最后一条 id 没变」影响 */
        function redraw(messages, force = false) {
          ratedId = updateReplyFeedback(box, { messages, isAssistant, ratedId });
          const changed = drawMessages(box, { messages, isAssistant, ratedId, lastDrawn }, force);
          // 只有真画了才推进游标。被「正在输入」挡下来时不能推进，
          // 否则这批消息永远不会再被画出来。lastDrawn 是按值传的，
          // 靠这里回写，跟原实现里闭包变量 lastId 的行为一致。
          if (changed) lastDrawn = messages.at(-1)?.id || 0;
          return changed;
        }

        /** 客服面板：revision 没变就整块跳过，不重画 */
        async function paintSupport(force = false) {
          if (!isAssistant) return;
          const rev = await drawSupport(box, { refresh, isCurrent: stillMine });
          if (rev === null) return;
          if (!force && rev === supportRevision) return;
          supportRevision = rev;
        }

        /** 一次完整刷新：拉线程 → 重画 → 刷客服 → 标已读 → 刷左侧 */
        async function refresh() {
          const r = await api('/api/social?action=dm-thread&peer=' + encodeURIComponent(username));
          redraw(r.messages);
          await paintSupport(true);
          await patch('/api/social?action=dm-read&peer=' + encodeURIComponent(username));
          await refreshList();
        }

        bindShortcuts(box);
        placeSupportActions(box);

        if (isAssistant) await loadReminder(box, stillMine);

        redraw(data.messages, true);
        await paintSupport(true);

        bindComposer(
          box,
          async (content) => {
            const result = await post('/api/social?action=dm-send', { to_username: username, content });
            if (version === epoch) await refresh();
            return result;
          },
          () => version === epoch
        );

        if (isVisible() && !el.closest('[hidden]')) {
          await patch('/api/social?action=dm-read&peer=' + encodeURIComponent(username));
        }
        await refreshList();

        // ---- 轮询：自续期，每轮结束时再决定要不要排下一轮 ----
        const schedulePoll = () => {
          timer = setTimeout(async () => {
            const note = () => $('#chat-refresh-state', box);
            try {
              const watching = isVisible() && document.visibilityState !== 'hidden' && !el.closest('[hidden]');
              if (stillMine() && watching) {
                const r = await api('/api/social?action=dm-thread&peer=' + encodeURIComponent(username));
                if (!stillMine()) return;
                // 请求在飞的这几秒里可能已经切走或切到别的标签页了，补一次检查
                if (!isVisible() || el.closest('[hidden]')) {
                  schedulePoll();
                  return;
                }
                if (redraw(r.messages)) {
                  await patch('/api/social?action=dm-read&peer=' + encodeURIComponent(username));
                  await refreshList();
                }
                await paintSupport();
                if (note()) note().textContent = '';
              }
            } catch {
              if (note()) note().textContent = '暂时无法刷新，可点击刷新回复重试。';
            }
            if (stillMine()) schedulePoll();
          }, POLL_MS);
        };
        schedulePoll();
      }
    );
  }

  /**
   * 灯灯的「你有几条未读 / 几项事务待办」提醒。
   * 读不到不算错误 —— 我的事务接口挂了不该让聊天看起来坏了。
   */
  async function loadReminder(box, stillMine) {
    try {
      const d = await api('/api/my-affairs');
      if (!box.isConnected || !stillMine()) return;
      $('#assistant-reminder', box).textContent =
        `灯灯提醒：你有 ${d.unread_count} 条未读通知、` +
        `${d.items.filter((r) => r.attention).length} 项近期事务值得关注。可打开“我的事务”查看。`;
    } catch {
      if (box.isConnected) $('#assistant-reminder', box).textContent = '暂时无法读取个人提醒，可在我的事务中刷新。';
    }
  }

  // ---- 顶栏三个入口 ----
  $('#new-message', el).onclick = () =>
    modal('新私信', field('username', '收件人游戏 ID'), {
      label: '打开会话',
      submit: async (v) => {
        await open(v.username);
      },
    });

  $('#ai-message', el).onclick = (e) =>
    action(e.currentTarget, async () => {
      const d = await api('/api/ai-bot');
      await open(d.username);
    });

  await renderConversations(el, { peer: '', onOpen: open });

  const to = assistantOnly
    ? (await api('/api/ai-bot')).username
    : new URLSearchParams(location.search).get('to');
  if (to) await open(to);
}
