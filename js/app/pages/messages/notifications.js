/**
 * Notifications tab (within /messages).
 *
 * v79-3 拆分自原 social.js 的 notifications()。
 * 通知列表 + 类别过滤 + 单条标已读 + 全部已读。
 */

import {
  $,
  $$,
  api,
  patch,
  region,
  tr,
  esc,
  text,
  empty,
  title,
  action,
  date,
  linkUrl,
} from '../../core.js';

export async function notifications(el) {
  let filter = 'all';
  let all = [];
  el.innerHTML =
    title('通知中心', 'Notifications') +
    `<div class="toolbar"><div class="tabs">${[
      ['all', '全部', 'All'],
      ['unread', '未读', 'Unread'],
      ['message_reply', '留言回复', 'Replies'],
      ['dm', '私信', 'Messages'],
      ['announcement', '公告', 'Announcements'],
    ]
      .map(
        ([k, zh, en]) =>
          `<button data-filter="${k}" aria-selected="${k === 'all'}">${tr(zh, en)}</button>`
      )
      .join('')}</div><button id="refresh-notifications">刷新通知</button><button id="read-all">${tr(
      '全部标为已读',
      'Mark all read'
    )}</button></div><p id="unread" class="muted"></p><div id="notifications"></div>`;
  const draw = () => {
    const list = all.filter(
      (n) => filter === 'all' || (filter === 'unread' && !n.read_at) || n.type === filter
    );
    $('#unread', el).textContent =
      all.filter((n) => !n.read_at).length +
      ' ' +
      tr('条未读（当前加载范围）', 'unread in loaded records');
    $('#notifications', el).innerHTML =
      list
        .map(
          (n) =>
            `<article class="panel"><div class="row-head"><h3>${esc(n.title)}</h3>${
              n.read_at ? '' : `<span class="badge unread">${tr('未读', 'Unread')}</span>`
            }</div><p>${text(n.body)}</p><small>${date(n.created_at)}</small><div class="actions">${
              linkUrl(n.link) && new URL(linkUrl(n.link)).origin === location.origin
                ? `<a class="button" href="${esc(linkUrl(n.link))}">${tr('查看', 'Open')} ↗</a>`
                : ''
            }${
              !n.read_at
                ? `<button data-read="${n.id}">${tr('标为已读', 'Mark read')}</button>`
                : ''
            }</div></article>`
        )
        .join('') || empty();
    $$('[data-read]', el).forEach((b) =>
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          await patch('/api/notifications?id=' + b.dataset.read);
          all.find((n) => n.id === +b.dataset.read).read_at = new Date().toISOString();
          draw();
        })
    );
  };
  $$('[data-filter]', el).forEach((b) =>
    b.onclick = () => {
      filter = b.dataset.filter;
      $$('[data-filter]', el).forEach((x) => x.setAttribute('aria-selected', x === b));
      draw();
    }
  );
  $('#read-all', el).onclick = (e) =>
    action(e.currentTarget, async () => {
      await patch('/api/notifications?action=read-all');
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