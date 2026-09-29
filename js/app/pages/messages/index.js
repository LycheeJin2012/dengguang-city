/**
 * Messages page workspace.
 *
 * v79-3 拆分自原 js/app/social.js (56 行)：
 *   - render     → 本文件（顶层 render + tab 切换）
 *   - notifications → ./notifications.js
 *   - messages（DM）→ 继续走 renderChat()（chat-page.js），无独立文件
 *
 * 该页签同时被 data-page=dm / notifications / messages 三处引用。
 */

import { tabsMarkup, bindTabs } from '../../../ui/workspace.js';
import { renderChat } from '../../chat-page.js';
import {$,$$,region,title,login,state} from '../../core.js'
import { notifications } from './notifications.js';

export async function render(el, page) {
  page =
    page === 'messages'
      ? new URLSearchParams(location.search).get('tab') === 'notifications'
        ? 'notifications'
        : 'dm'
      : page;
  if (!state.session?.player) {
    el.innerHTML =
      title(page === 'dm' ? '私信' : '通知中心') +
      `<div class="panel"><p>${'私信和通知都锁在账号里，得先认明你本人。'}</p><button id="sign-in">${'我是市民'}</button></div>`;
    $('#sign-in', el).onclick = async () => {
      await login();
      if (state.session?.player) render(el, page);
    };
    return;
  }
  el.innerHTML =
    title('消息') +
    tabsMarkup(
      [
        { key: 'dm', label: '私信' },
        { key: 'notifications', label: '通知' },
      ],
      page === 'notifications' ? 'notifications' : 'dm',
      {
        id: 'message-tabs',
        label: '消息分类',
        panelPrefix: 'message-panel-',
      }
    ) +
    `<section role="tabpanel" id="message-panel-dm" aria-labelledby="message-tabs-dm" hidden></section><section role="tabpanel" id="message-panel-notifications" aria-labelledby="message-tabs-notifications" hidden></section>`;
  const loaded = new Map();
  async function select(key) {
    $$('[data-tab-key]', el).forEach((b) => {
      const active = b.dataset.tabKey === key;
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
      $('#message-panel-' + b.dataset.tabKey, el).hidden = !active;
    });
    const url = new URL(location.href);
    url.pathname = '/messages.html';
    if (key === 'notifications') url.searchParams.set('tab', 'notifications');
    else url.searchParams.delete('tab');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (!loaded.has(key)) {
      const panel = $('#message-panel-' + key, el);
      const load = region(panel, () => key, async () => {
        await (key === 'dm' ? renderChat(panel) : notifications(panel));
        $('.page-heading', panel)?.remove();
        document.title = '消息 · 灯光市';
      });
      loaded.set(key, load);
    }
    await loaded.get(key);
  }
  bindTabs($('#message-tabs', el), select);
  await select(page === 'notifications' ? 'notifications' : 'dm');
}