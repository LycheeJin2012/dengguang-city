/**
 * 工单墙：主页和「我的事务」共用的工单列表。
 *
 * 之前 v79-6 从 js/app/ticket-center.js 拆出来时只改了 import 路径，代码还是
 * 18 行压缩写法。这次把两件跟状态机无关的东西挪走（卡片、公开详情），
 * 本文件只留下「三个页签 + 分页 + 竞态防护」这一件事。
 *
 * 三个页签（mode）：
 *   preview  首页预览，只放一条。优先本人的未结单，没有才退到最近一条公开单
 *   my       我的工单
 *   public   公开处理
 *
 * 五个不能改的行为，都是踩过坑的：
 *   1. **epoch 是竞态防护**。每次 load() 开头 ++epoch，回来后比对
 *      `current !== epoch` 就丢弃。快速来回切页签时，慢的那次请求会把
 *      新页签的内容覆盖掉 —— 没有它列表会串。
 *   2. **feed._load = Symbol() 不是废话**。预览态走 core.js 的 region()，
 *      它在元素上留了一个 _load token；切到列表态时必须换一个新 Symbol，
 *      让还在飞的预览渲染回来时自己撞掉（region 里 `el._load !== token` 就 return）。
 *      顺手 removeAttribute('aria-busy') 是因为 region 的 finally 只在 token
 *      还是自己的时候才清这个标记，而我们已经把 token 换掉了。
 *   3. **列表用 Map 按 id 去重**。分页翻页时如果后端因为新工单插入而返回了
 *      重复条目，直接 append 会出现两张一样的卡。
 *   4. **catch 里渲染完错误要再 throw**。throw 是给外层 action() 用的 ——
 *      让它弹 toast。只渲染不 throw 的话，按钮会复原但用户什么提示都收不到。
 *   5. **preview() 里 map 的参数名是 status**。原来 core.js 的 status() 在这
 *      个作用域里被遮住了；卡片渲染拆到 card.js 之后 index.js 不再 import
 *      status，这个名字保持原样不影响任何人，但别「顺手」改成 st。
 */

import { $, $$, api, region, esc, requirePlayer, action, state } from '../../core.js';
import { createTicket, viewCitizenTicket, showAdminDirectory } from '../../ticket-form.js';
import { newestTicket } from '../../ticket-preview.js';
import { ticketCard } from './card.js';
import { publicDetails } from './public-details.js';

/** 静态外壳。整个模块生命周期内只渲染这一次，后面都是往 #ticket-feed 里塞。 */
function shellMarkup() {
  return (
    `<span id="wall"></span>` +
    `<div class="toolbar">` +
    `<button id="new-ticket" class="primary">＋ 提交留言 / 工单</button>` +
    `<button id="admin-directory">查看管理员编号</button>` +
    `<div class="tabs">` +
    `<button data-mode="public" aria-selected="false">公开处理</button>` +
    `<button data-mode="my" aria-selected="false">我的工单</button>` +
    `</div>` +
    `</div>` +
    `<p class="muted">公开内容经提交者授权和工作人员审核。私密工单与附件不会出现在这里。</p>` +
    `<div id="ticket-feed"></div>` +
    `<div class="actions">` +
    `<button id="ticket-more" hidden>加载更多</button>` +
    `<button id="ticket-collapse" hidden>收起列表</button>` +
    `</div>`
  );
}

/**
 * 渲染工单墙。
 * @param {Element} el 页面上的挂载点
 */
export async function renderTicketCenter(el) {
  /** preview | my | public */
  let mode = 'preview';
  /** 列表态下已经攒下来的卡片数据，跨「加载更多」累积 */
  let rows = [];
  let offset = 0;
  let hasMore = false;
  /** 竞态防护计数，见文件头第 1 条 */
  let epoch = 0;

  el.innerHTML = shellMarkup();

  /** 给当前所有卡片按钮挂点击。preview 和列表态都复用它。 */
  function bind() {
    $$('[data-ticket]', el).forEach((b) => {
      b.onclick = () =>
        action(b, () =>
          // data-mine='1' 是本人的单 → 带附件/时间线/补充的市民弹窗
          b.dataset.mine === '1'
            ? viewCitizenTicket(b.dataset.ticket, { onChanged: () => load(true) })
            : publicDetails(b.dataset.ticket)
        );
    });
  }

  /**
   * 首页那一单：优先本人的未结单（open / in_progress 各取最近一条再比），
   * 没有本人单子才退到最近一条公开单。
   */
  async function preview() {
    await state.authPending;
    let ticket = null;
    let mine = false;

    if (state.session?.player) {
      const result = await Promise.all(
        ['open', 'in_progress'].map((status) => api('/api/tickets?my=1&status=' + status + '&limit=1'))
      );
      ticket = newestTicket(result.flatMap((d) => d.tickets));
      mine = !!ticket;
    }

    // 两个状态都没查到本人的单，才看公开单
    if (!ticket) ticket = (await api('/api/tickets?public=1&limit=1')).tickets[0];
    return { ticket, mine };
  }

  /**
   * 载入当前页签的内容。
   * @param {boolean} reset true=清空重来（切页签）；false=翻页追加
   */
  async function load(reset = true) {
    const current = ++epoch;
    const selected = mode;

    $('#ticket-more', el).hidden = true;
    $('#ticket-collapse', el).hidden = selected === 'preview';

    if (selected === 'preview') {
      // 预览态只有一条，走 region() 拿 loading 态和失败重试
      await region($('#ticket-feed', el), preview, (d, box) => {
        // region 自己的 token 只能挡住预览态之间的竞态；切页签的竞态要靠 epoch
        if (current !== epoch) return;
        box.innerHTML = d.ticket
          ? ticketCard(d.ticket, d.mine, true)
          : `<div class="empty"><p>暂无已获授权并公开的工单</p></div>`;
        bind();
      });
      return;
    }

    const feed = $('#ticket-feed', el);
    // 作废可能还在飞的预览渲染（见文件头第 2 条），两行都不能删
    feed._load = Symbol();
    feed.removeAttribute('aria-busy');

    if (reset) {
      rows = [];
      offset = 0;
      feed.innerHTML = '<p role="status">正在加载…</p>';
    }

    try {
      const scope = selected === 'my' ? 'my=1' : 'public=1';
      const d = await api('/api/tickets?' + scope + '&limit=100&offset=' + offset);
      // 慢响应撞上新一轮加载就丢弃；页面已经卸载同样不用再画
      if (current !== epoch || !el.isConnected) return;

      // 按 id 去重：翻页期间有新工单插进来时后端可能吐出重复条目
      rows = [...new Map([...rows, ...d.tickets].map((t) => [t.id, t])).values()];
      offset += d.tickets.length;
      hasMore = d.has_more;

      $('#ticket-feed', el).innerHTML = rows.length
        ? rows.map((t) => ticketCard(t, selected === 'my')).join('')
        : `<div class="empty"><p>${selected === 'my' ? '你还没有工单' : '暂无已获授权并公开的工单'}</p></div>`;
      $('#ticket-more', el).hidden = !hasMore;
      bind();
    } catch (error) {
      if (current === epoch) {
        // 追加翻页失败时不要清空已经看到的列表，只提示
        if (reset) feed.innerHTML = '<p class="notice">' + esc(error.message) + '</p>';
        $('#ticket-more', el).hidden = !hasMore;
      }
      // 继续往外抛：action() 靠它弹 toast，见文件头第 4 条
      throw error;
    }
  }

  async function setMode(next) {
    // 切到「我的工单」先确认登录；未登录会弹登录框，mode 保持不变
    if (next === 'my') await requirePlayer();
    mode = next;
    $$('[data-mode]', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    await load(true);
  }

  $('#new-ticket', el).onclick = (e) =>
    action(e.currentTarget, () =>
      // 递完之后自动跳到「我的工单」，让用户马上看到刚递的那一单
      createTicket({ kind: 'message', onCreated: () => setMode('my') })
    );

  $('#admin-directory', el).onclick = (e) => action(e.currentTarget, showAdminDirectory);

  $$('[data-mode]', el).forEach((b) => {
    b.onclick = () => action(b, () => setMode(b.dataset.mode));
  });

  // reset=false：保留已有 rows，只往后翻
  $('#ticket-more', el).onclick = (e) => action(e.currentTarget, () => load(false));
  $('#ticket-collapse', el).onclick = (e) => action(e.currentTarget, () => setMode('preview'));

  await load();
}
