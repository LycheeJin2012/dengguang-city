/**
 * 私信页左侧的会话列表。
 *
 * 原来只有一句 `.map()` 拼 HTML。现在把「取数据 → 渲染 → 挂点击」
 * 收在一个函数里，调用方只需要传入选中的人和「点开某人」的回调。
 */

import { $, $$, api, esc, empty, region } from '../../core.js';

/**
 * @param {Element} el        renderChat 的根节点
 * @param {object} options
 * @param {string} options.peer      当前选中的用户名，用来打 selected
 * @param {(u:string)=>void} options.onOpen  点某个会话时回调
 */
export async function renderConversations(el, { peer = '', onOpen } = {}) {
  await region(
    $('#conversations', el),
    () => api('/api/social?action=dm-list'),
    (data, box) => {
      box.innerHTML =
        data.conversations
          .map(
            (c, i) => `<button class="conversation ${c.peer.username === peer ? 'selected' : ''}" data-conversation="${i}"><b>${esc(c.peer.username)}</b>${c.unread ? ` <span class="badge">${c.unread}</span>` : ''}<small>${esc(c.last_content)}</small></button>`
          )
          .join('') || empty();

      // data-conversation 存的是本次渲染的数组下标，点击时现取 username，
      // 不把 username 烤进闭包 —— 列表刷新后旧闭包会指向错位的人。
      $$('[data-conversation]', box).forEach((b) => {
        b.onclick = () => onOpen?.(data.conversations[Number(b.dataset.conversation)].peer.username);
      });
    }
  );
}
