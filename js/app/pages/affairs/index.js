/**
 * Affairs page workspace.
 *
 * v79-5 拆分自原 js/app/affairs.js（12 行 minified）。render() 展开为可读结构，
 * 依赖路径相应上移一级。
 */

import { viewCitizenTicket } from '../../ticket-form.js';
import {$,$$,api,region,esc,date,status,empty,title,state,login,toast} from '../../core.js'

export async function render(el) {
  el.innerHTML = title('我的事务');
  if (!state.session?.player) {
    el.insertAdjacentHTML(
      'beforeend',
      '<section class="panel"><p>登录之后，你办过或在办的事都会汇到这一页。</p><button id="affairs-login">我是市民</button></section>'
    );
    $('#affairs-login', el).onclick = async () => {
      await login();
      if (state.session?.player) await render(el);
    };
    return;
  }
  el.insertAdjacentHTML(
    'beforeend',
    `<div class="affairs-workspace"><aside class="affairs-assistant panel"><div class="row-head"><h2>灯灯 · 你的小帮手</h2><button id="affairs-refresh">再看一次</button></div><p>最近在办的事和当下的提醒都摆在这儿。数据只在打开页面和点「再看一次」时刷新，市政厅不后台替你盯着。</p><div id="affairs-reminders" role="status"></div><div class="actions"><a class="button primary" href="/messages.html?to=${encodeURIComponent(
      '灯灯客服'
    )}">问问灯灯</a><a class="button" href="/profile.html#security">账号与登录</a><a class="button" href="/map.html">城市地图</a></div></aside><div class="affairs-records"><div class="tabs" id="affairs-filters">${[
      ['all', '全部'],
      ['attention', '等我处理'],
      ['ticket', '工单'],
      ['booking', '酒店'],
      ['exam', '考试'],
      ['support', '人工'],
    ]
      .map(([k, l]) => `<button data-filter="${k}" aria-selected="${k === 'all'}">${l}</button>`)
      .join('')}</div><section id="affairs-items" class="section"></section></div></div>`
  );
  let data,
    filter = 'all';
  const labels = {
    ticket: '工单',
    booking: '酒店',
    exam: '考试',
    license: '驾照',
    appeal: '复核',
    support: '客服',
  };
  function affairStatus(r) {
    const labels =
      r.kind === 'support'
        ? { queued: '等人接', active: '已接入', ended: '聊完了' }
        : r.kind === 'exam'
        ? {
            generating: '正在出卷',
            in_progress: '正在答',
            grading: '正在批',
            needs_review: '等复核',
            graded: '批好了',
            abandoned: '已放弃',
          }
        : {};
    return labels[r.status] ? `<span class="badge">${labels[r.status]}</span>` : status(r.status);
  }
  function draw() {
    const rows = data.items.filter(
      (r) => filter === 'all' || (filter === 'attention' && r.attention) || r.kind === filter
    );
    $('#affairs-items', el).innerHTML =
      rows
        .map(
          (r) =>
            `<article class="panel"><div class="row-head"><h3>${esc(r.title)}</h3>${affairStatus(
              r
            )}</div><small>${labels[r.kind]} · ${date(r.created_at)}</small>${
              r.in_date
                ? `<p>住进去 ${esc(r.in_date)} — 退房 ${esc(r.out_date)}</p>`
                : ''
            }${
              r.kind === 'exam'
                ? `<p>${r.score === null ? '分数还没出来' : `得分 ${Number(r.score)} 分`}</p>`
                : ''
            }<div class="actions">${
              r.kind === 'ticket'
                ? `<button data-ticket="${esc(r.id)}">查看与补充</button>`
                : `<a class="button" href="${esc(r.href)}">接着办</a>`
            }</div></article>`
        )
        .join('') || empty('这一类暂时没有记录。换个分类，或者去工单里新交一单。');
    $$('[data-ticket]', el).forEach((b) =>
      b.onclick = () =>
        viewCitizenTicket(b.dataset.ticket, { onChanged: load }).catch((e) =>
          toast(e.message, true)
        )
    );
  }
  async function load() {
    await region($('#affairs-items', el), () => api('/api/my-affairs'), (d) => {
      data = d;
      $('#affairs-reminders', el).innerHTML = `<p>有 <b>${
        d.unread_count
      }</b> 条没看的通知、<b>${d.items.filter((r) => r.attention).length}</b> 项近期事务在等你。<a href="/messages.html?tab=notifications">看消息</a></p><small>数据截至 ${date(
        d.as_of
      )} · 只摆各类最近几件，完整历史去对应那页翻。</small>`;
      draw();
    });
  }
  $$('[data-filter]', el).forEach((b) =>
    b.onclick = () => {
      filter = b.dataset.filter;
      $$('[data-filter]', el).forEach((x) => x.setAttribute('aria-selected', x === b));
      if (data) draw();
    }
  );
  $('#affairs-refresh', el).onclick = load;
  await load();
  const ticket = new URLSearchParams(location.search).get('ticket');
  if (ticket) await viewCitizenTicket(ticket, { onChanged: load });
}