/**
 * 消息页（私信 / 通知 两个 tab）。
 *
 * 原来这个文件 74 行、最长行 225 字符：两个空的 tabpanel 挤在一根 300 字符的
 * 模板串里，tab 切换的同步逻辑和首次懒加载混在一起。现在把面板骨架和
 * URL 同步拆成小函数。
 *
 * 不能改的行为：
 *   1. `loaded` 这个 Map 是**懒加载守卫**：每个 tab 的内容只在第一次切到时
 *      渲染一次，之后再切回来只做显示切换。去掉它会导致每次切 tab 都重拉
 *      私信、重置滚动位置。
 *   2. 切 tab 会用 `history.replaceState` 同步地址栏（不是 pushState）：
 *      用户的浏览器「后退」不应该在两个 tab 之间来回跳。
 *      `?tab=notifications` 只在通知页存在，私信页要把它删掉。
 *   3. `page === 'messages'` 时要读 `?tab=` 决定落在哪个 tab 上——dm.html /
 *      notifications.html / messages.html 三处共用这一个 render。
 *   4. 首次渲染完要把子面板里的 `.page-heading` 删掉、并把 document.title 改成
 *      「消息 · 灯光市」。这是因为子模块自己会画一个页头。
 *   5. 切 tab 时 `aria-selected` / `tabIndex` / panel 的 `hidden` 三件事要**在同一次
 *      循环里**同步完成，别拆成两次遍历。
 */

import { tabsMarkup, bindTabs } from '../../../ui/workspace.js';
import { renderChat } from '../../chat-page.js';
import { $, $$, region, title, login, state } from '../../core.js';
import { notifications } from './notifications.js';

/** 解析最终落在哪个 tab。dm.html / notifications.html / messages.html 共用。 */
function resolvePage(page) {
  if (page !== 'messages') return page;
  return new URLSearchParams(location.search).get('tab') === 'notifications'
    ? 'notifications'
    : 'dm';
}

const TABS = [
  { key: 'dm', label: '私信' },
  { key: 'notifications', label: '通知' },
];

/** 两个空面板，等各自的模块第一次被切到时再填 */
function panelsMarkup() {
  return (
    '<section role="tabpanel" id="message-panel-dm" aria-labelledby="message-tabs-dm" hidden></section>' +
    '<section role="tabpanel" id="message-panel-notifications" ' +
    'aria-labelledby="message-tabs-notifications" hidden></section>'
  );
}

export async function render(el, page) {
  page = resolvePage(page);

  if (!state.session?.player) {
    el.innerHTML =
      title(page === 'dm' ? '私信' : '通知中心') +
      '<div class="panel"><p>私信和通知都锁在账号里，得先认明你本人。</p>' +
      '<button id="sign-in">我是市民</button></div>';
    $('#sign-in', el).onclick = async () => {
      await login();
      if (state.session?.player) render(el, page);
    };
    return;
  }

  el.innerHTML =
    title('消息') +
    tabsMarkup(TABS, page === 'notifications' ? 'notifications' : 'dm', {
      id: 'message-tabs',
      label: '消息分类',
      panelPrefix: 'message-panel-',
    }) +
    panelsMarkup();

  // 每个 tab 只在第一次切到时加载，之后复用同一个 promise
  const loaded = new Map();

  /** 把地址栏同步成当前 tab。用 replaceState，后退键不参与。 */
  function syncUrl(key) {
    const url = new URL(location.href);
    url.pathname = '/messages.html';
    if (key === 'notifications') url.searchParams.set('tab', 'notifications');
    else url.searchParams.delete('tab');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  async function select(key) {
    $$('[data-tab-key]', el).forEach((b) => {
      const active = b.dataset.tabKey === key;
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
      $('#message-panel-' + b.dataset.tabKey, el).hidden = !active;
    });

    syncUrl(key);

    if (!loaded.has(key)) {
      const panel = $('#message-panel-' + key, el);
      const load = region(panel, () => key, async () => {
        await (key === 'dm' ? renderChat(panel) : notifications(panel));
        // 子模块自己画的页头和外层重复，删掉；标题同步成消息页
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
