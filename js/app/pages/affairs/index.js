/**
 * 我的事务页：左侧「灯灯小帮手」提醒栏 + 右侧按类别过滤的记录流。
 *
 * 原来这个文件是 118 行、最长行 481 字符的手压写法：整个页面的骨架是一根
 * 几百字符的模板字符串，过滤器、状态徽章、记录卡片各挤在一行里。现在拆成
 * 「模板片段 + 纯函数」两层，模板片段用数组 join 拼回**逐字相同**的 HTML。
 *
 * 不能改的行为：
 *   1. 模板字符串是 COPY_LOCK 之外但被 frontend.test.js 的「标签配对 + 中文
 *      纯度」断言盯着的内容，任何一个闭合标签的 `<` 丢了都会让整页塌掉。
 *      所以本文件只把字符串**切段**，不增删任何字符。
 *   2. `affairStatus()` 里有一个**同名遮蔽**的局部 `labels`（工单/考试状态码
 *      → 中文），和外层 `labels`（kind → 中文）是两回事。这里保持遮蔽关系不变，
 *      容易看错，所以专门写了注释。
 *   3. 过滤的判定式 `filter === 'all' || (filter === 'attention' && r.attention)
 *      || r.kind === filter` 有优先级：'attention' 是叠加在 kind 之外的第四种
 *      状态，不是第六类。改这个式子会改变「等我处理」里出现工单的数量。
 *   4. 切 tab 时先同步 aria-selected 再 `if (data) draw()`：首次点 tab 时
 *      region 还没回来，data 是 undefined，此时不能画。
 */

import { viewCitizenTicket } from '../../ticket-form.js';
import { $, $$, api, region, esc, date, status, empty, title, state, login, toast } from '../../core.js';

/** 顶部分类 tab。'attention' 不是 kind，是叠加在 kind 上的第四种视图。 */
const FILTERS = [
  ['all', '全部'],
  ['attention', '等我处理'],
  ['ticket', '工单'],
  ['booking', '酒店'],
  ['exam', '考试'],
  ['support', '人工'],
];

/** kind → 中文，用在每条记录标题下面那行小字 */
const KIND_LABELS = {
  ticket: '工单',
  booking: '酒店',
  exam: '考试',
  license: '驾照',
  appeal: '复核',
  support: '客服',
};

/** 人工客服会话的状态码 → 中文 */
const SUPPORT_STATUS = {
  queued: '等人接',
  active: '已接入',
  ended: '聊完了',
};

/** 考试记录的状态码 → 中文 */
const EXAM_STATUS = {
  generating: '正在出卷',
  in_progress: '正在答',
  grading: '正在批',
  needs_review: '等复核',
  graded: '批好了',
  abandoned: '已放弃',
};

/** 一条记录右上角的状态徽章。人工和考试用专属词表，其余走 core 的 status()。 */
function affairStatus(r) {
  // 注意：这里的 `labels` 刻意遮蔽外层 KIND_LABELS —— 它是「状态码 → 中文」，
  // 下面 `${labels[r.kind]}` 用的是外层那个。两张表不是一回事，改名会掩盖这个区别。
  const labels = r.kind === 'support' ? SUPPORT_STATUS : r.kind === 'exam' ? EXAM_STATUS : {};
  return labels[r.status] ? `<span class="badge">${labels[r.status]}</span>` : status(r.status);
}

/** 一条记录下方的补充信息：酒店给日期，考试给分数。两种都没有就是空串。 */
function recordDetail(r) {
  if (r.in_date) return `<p>住进去 ${esc(r.in_date)} — 退房 ${esc(r.out_date)}</p>`;
  if (r.kind === 'exam') {
    return `<p>${r.score === null ? '分数还没出来' : `得分 ${Number(r.score)} 分`}</p>`;
  }
  return '';
}

/** 记录卡右下角的按钮：工单走弹窗补材料，其余是一张跳转链接。 */
function recordAction(r) {
  return r.kind === 'ticket'
    ? `<button data-ticket="${esc(r.id)}">查看与补充</button>`
    : `<a class="button" href="${esc(r.href)}">接着办</a>`;
}

/** 左侧提醒栏。数据截至时间一起显示，避免用户把旧数据当现状。 */
function remindersMarkup(d) {
  const attention = d.items.filter((r) => r.attention).length;
  return (
    `<p>有 <b>${d.unread_count}</b> 条没看的通知、` +
    `<b>${attention}</b> 项近期事务在等你。` +
    `<a href="/messages.html?tab=notifications">看消息</a></p>` +
    `<small>数据截至 ${date(d.as_of)} · 只摆各类最近几件，完整历史去对应那页翻。</small>`
  );
}

/** 骨架：提醒栏 + 分类 tab + 记录流。记录流本身是空的，等 region 填。 */
function workspaceMarkup() {
  const tabs = FILTERS.map(
    ([k, l]) => `<button data-filter="${k}" aria-selected="${k === 'all'}">${l}</button>`
  ).join('');

  return (
    '<div class="affairs-workspace">' +
    '<aside class="affairs-assistant panel">' +
    '<div class="row-head"><h2>灯灯 · 你的小帮手</h2>' +
    '<button id="affairs-refresh">再看一次</button></div>' +
    '<p>最近在办的事和当下的提醒都摆在这儿。数据只在打开页面和点「再看一次」时刷新，' +
    '市政厅不后台替你盯着。</p>' +
    '<div id="affairs-reminders" role="status"></div>' +
    '<div class="actions">' +
    `<a class="button primary" href="/messages.html?to=${encodeURIComponent('灯灯客服')}">问问灯灯</a>` +
    '<a class="button" href="/profile.html#security">账号与登录</a>' +
    '<a class="button" href="/map.html">城市地图</a>' +
    '</div></aside>' +
    '<div class="affairs-records">' +
    `<div class="tabs" id="affairs-filters">${tabs}</div>` +
    '<section id="affairs-items" class="section"></section>' +
    '</div></div>'
  );
}

/**
 * 已登录分支的页面主体。
 * filter / data 收在这个函数的作用域里：切 tab、过滤、重画三个闭包共用它们，
 * 提到模块级会让状态跨页面残留。调用方（render）已经确认过 session，未登录
 * 那段守卫不在这里重复。
 */
async function start(el) {
  let data;
  let filter = 'all';

  el.insertAdjacentHTML('beforeend', workspaceMarkup());

  /** 按当前 filter 画记录流。data 还没回来时调用方自己判。 */
  function draw() {
    const rows = data.items.filter(
      (r) => filter === 'all' || (filter === 'attention' && r.attention) || r.kind === filter
    );

    $('#affairs-items', el).innerHTML =
      rows
        .map(
          (r) =>
            '<article class="panel">' +
            `<div class="row-head"><h3>${esc(r.title)}</h3>${affairStatus(r)}</div>` +
            `<small>${KIND_LABELS[r.kind]} · ${date(r.created_at)}</small>` +
            recordDetail(r) +
            `<div class="actions">${recordAction(r)}</div>` +
            '</article>'
        )
        .join('') || empty('这一类暂时没有记录。换个分类，或者去工单里新交一单。');

    $$('[data-ticket]', el).forEach((b) => {
      b.onclick = () =>
        viewCitizenTicket(b.dataset.ticket, { onChanged: load }).catch((e) => toast(e.message, true));
    });
  }

  /** 拉一次数据，顺手更新提醒栏。region 负责 loading / 错误态。 */
  async function load() {
    await region($('#affairs-items', el), () => api('/api/my-affairs'), (d) => {
      data = d;
      $('#affairs-reminders', el).innerHTML = remindersMarkup(d);
      draw();
    });
  }

  function bindFilters() {
    $$('[data-filter]', el).forEach((b) => {
      b.onclick = () => {
        filter = b.dataset.filter;
        $$('[data-filter]', el).forEach((x) => x.setAttribute('aria-selected', x === b));
        // 首屏数据可能还没回来（region 仍在飞），此时没有可画的东西
        if (data) draw();
      };
    });
  }

  $('#affairs-refresh', el).onclick = load;
  bindFilters();

  await load();

  const ticket = new URLSearchParams(location.search).get('ticket');
  if (ticket) await viewCitizenTicket(ticket, { onChanged: load });
}

/** 未登录时只画一个登录按钮，登录成功后整页重画一次（session 变了）。 */
export async function render(el) {
  el.innerHTML = title('我的事务');

  if (!state.session?.player) {
    el.insertAdjacentHTML(
      'beforeend',
      '<section class="panel"><p>登录之后，你办过或在办的事都会汇到这一页。</p>' +
        '<button id="affairs-login">我是市民</button></section>'
    );
    $('#affairs-login', el).onclick = async () => {
      await login();
      if (state.session?.player) await render(el);
    };
    return;
  }

  return start(el);
}
