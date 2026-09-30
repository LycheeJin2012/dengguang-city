/**
 * 通知中心（/messages 的通知 tab）。
 *
 * 原来这个文件 80 行、最长行 197 字符：过滤条件、未读计数、卡片模板、三个
 * 按钮的绑定混在一起。现在把「过滤」「计数」「一张通知卡」提成小函数。
 *
 * 不能改的行为：
 *   1. 未读计数只统计**这次取回来的这一批**（limit=200），文案里明说了
 *      「只数这次取回来的」。别改成去请求一个总数接口 —— 那会让这句提示失真。
 *   2. 外链过滤：只有 `linkUrl(n.link)` 非空**且**解析后的 origin 和本站相同
 *      才给「去看看」按钮。这是对外链的同源校验，去掉会引入开放重定向。
 *      注意 `new URL()` 只在 linkUrl() 返回真值时才调用，空值会抛。
 *   3. 「看过」和「全部收下」都是**先打后端、再本地改 read_at、最后重画**。
 *      本地改的是内存里的 `all` 数组，不会重新拉列表 —— 保持这个顺序，
 *      避免一次点击发两次请求。
 *   4. 「全部收下」用 `n.read_at = n.read_at || now`：已经看过的不改时间戳。
 *   5. 过滤条件里 `unread` 和具体 type 是并列的第三、第四种视图，
 *      不是第七种 type。
 */

import { $, $$, api, patch, region, esc, text, empty, title, action, date, linkUrl } from '../../core.js';

/** 类别过滤条 */
const FILTERS = [
  ['all', '全部'],
  ['unread', '未读'],
  ['message_reply', '留言回信'],
  ['dm', '私信'],
  ['announcement', '公告'],
];

function shellMarkup() {
  const tabs = FILTERS.map(
    ([k, zh]) => `<button data-filter="${k}" aria-selected="${k === 'all'}">${zh}</button>`
  ).join('');

  return (
    title('通知中心') +
    '<div class="toolbar"><div class="tabs">' +
    tabs +
    '</div><button id="refresh-notifications">再取一次</button>' +
    '<button id="read-all">全部收下</button></div>' +
    '<p id="unread" class="muted"></p>' +
    '<div id="notifications"></div>'
  );
}

/** 通知里的链接必须是站内链接才给入口（防开放重定向） */
function isInternalLink(link) {
  if (!linkUrl(link)) return false;
  return new URL(linkUrl(link)).origin === location.origin;
}

function notificationCard(n) {
  const unread = n.read_at ? '' : '<span class="badge unread">没看</span>';
  const go = isInternalLink(n.link)
    ? `<a class="button" href="${esc(linkUrl(n.link))}">去看看 ↗</a>`
    : '';
  const mark = n.read_at ? '' : `<button data-read="${n.id}">看过</button>`;

  return (
    '<article class="panel"><div class="row-head">' +
    `<h3>${esc(n.title)}</h3>${unread}</div>` +
    `<p>${text(n.body)}</p>` +
    `<small>${date(n.created_at)}</small>` +
    `<div class="actions">${go}${mark}</div></article>`
  );
}

export async function notifications(el) {
  let filter = 'all';
  let all = [];

  el.innerHTML = shellMarkup();

  const draw = () => {
    const list = all.filter(
      (n) => filter === 'all' || (filter === 'unread' && !n.read_at) || n.type === filter
    );

    $('#unread', el).textContent =
      all.filter((n) => !n.read_at).length + ' 条没看（只数这次取回来的）';

    $('#notifications', el).innerHTML = list.map(notificationCard).join('') || empty();

    $$('[data-read]', el).forEach((b) => {
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          await patch('/api/notifications?id=' + b.dataset.read);
          // 本地标记已读即可，不重新拉列表
          all.find((n) => n.id === +b.dataset.read).read_at = new Date().toISOString();
          draw();
        });
    });
  };

  $$('[data-filter]', el).forEach((b) => {
    b.onclick = () => {
      filter = b.dataset.filter;
      $$('[data-filter]', el).forEach((x) => x.setAttribute('aria-selected', x === b));
      draw();
    };
  });

  $('#read-all', el).onclick = (e) =>
    action(e.currentTarget, async () => {
      await patch('/api/notifications?action=read-all');
      // 已经看过的不动时间戳
      all.forEach((n) => (n.read_at = n.read_at || new Date().toISOString()));
      draw();
    });

  const load = () =>
    region($('#notifications', el), () => api('/api/notifications?my=1&limit=200'), (d) => {
      all = d.notifications || [];
      draw();
    });

  $('#refresh-notifications', el).onclick = load;
  await load();
}
