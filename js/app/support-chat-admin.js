/**
 * 管理端「人工接待台」。
 *
 * 玩家在聊天里点转人工，会自己冒到这里。管理员接进来就能回，但**不会替玩家
 * 开工单** —— 想走工单得点「劝他开工单」，那会先弹一个说明框让人写清楚。
 *
 * 这页有两条独立的拉数据节奏，都带竞态防护，不能简化：
 *
 * 1. 名单每 5 秒轮询一次（tick）
 *    - listEpoch 挡住「慢的旧请求覆盖新的名单」
 *    - listSignature 是整个 chats 数组的 JSON 指纹。指纹没变就一个 DOM 都不碰
 *      —— 不然每 5 秒重建一次按钮，正在点的那一下会丢
 *    - 标签页切到后台时（visibilityState === 'hidden'）跳过这次轮询，省流量
 *
 * 2. 房间详情按需拉（open）
 *    - epoch 换掉就丢弃晚回来的响应
 *    - box._refresh 把 refresh 挂在房间容器上，tick 靠它刷当前房间。
 *      挂在 DOM 上而不是闭包变量上，是为了让每次 open 重建的房间都能自动
 *      拿到最新版；出错时置 null，tick 的可选调用就自然停掉
 *
 * 三个不能改的细节：
 *   - 刷新时不能重画输入框。draw() 只在「最后一条消息 id 变了」时才重画气泡，
 *     光标和没发完的话因此能保住
 *   - 重画前先量离底部多近，贴底才自动滚到底
 *   - is_self 是管理员自己的账号会话：看得到、说不了。canReply 一处判，
 *     输入框禁用、按钮隐藏、错误提示都从它推
 */

import { $, $$, api, post, esc, text, field, modal, action, state, date } from './core.js';

/** 会话状态 → 中文。列表和房间标题共用一份。 */
const STATUS_LABELS = {
  queued: '等着有人接',
  active: '正在回',
  closed: '已收摊',
};

/** 算作「贴底」的像素阈值，和私信线程那边一致 */
const NEAR_BOTTOM = 80;

export async function renderSupportChat(el) {
  /** 当前选中的会话 id；null = 没选 */
  let selected = null;
  /** 当前房间详情，来自 /api/admin/support-chat?id= */
  let room = null;
  /** 房间请求的版本号，用来丢弃晚到的旧响应 */
  let epoch = 0;
  /** 名单请求的版本号，和房间那条线互不干扰 */
  let listEpoch = 0;
  /** 上次名单的 JSON 指纹，用来跳过无变化的重画 */
  let listSignature = '';

  el.innerHTML =
    '<h2>人工接待台</h2>' +
    '<p class="notice">这里接着灯灯的班，玩家一转人工就自己冒出来。点开能看，接进来就能回；不会顺手替玩家开工单。</p>' +
    '<button id="support-list-refresh">再看一次</button>' +
    '<p id="support-list-state" role="status"></p>' +
    '<div class="split">' +
    '<aside class="panel" id="support-chat-list"></aside>' +
    '<section class="panel" id="support-chat-room">正在搬椅子…</section>' +
    '</div>';

  /**
   * 拉一次名单并按需重画。
   * 指纹没变就不动列表 DOM；选中的会话没了就清空并提示。
   */
  async function list() {
    const version = ++listEpoch;
    try {
      const d = await api('/api/admin/support-chat');
      // 慢的旧请求：丢掉，别让它覆盖新一轮
      if (version !== listEpoch || !el.isConnected) return;

      const signature = JSON.stringify(d.chats);
      if (signature !== listSignature) {
        listSignature = signature;
        const box = $('#support-chat-list', el);
        box.innerHTML =
          d.chats
            .map(
              (c) =>
                `<button class="conversation ${c.id === selected ? 'selected' : ''}" data-chat="${c.id}">` +
                `<b>${esc(c.username)}</b>` +
                `<small>${STATUS_LABELS[c.status]} ${esc(c.admin_name || '')}${c.is_self ? ' · 你自己的（只读）' : ''}</small>` +
                // 摘要在 120 字处截断，防止有人贴一整篇进来把侧栏撑爆
                `<span>${esc((c.last_question || '玩家还没开口').slice(0, 120))}</span>` +
                `</button>`
            )
            .join('') || '<p>现在没人排队，市民一转人工就会自己出现。</p>';
        $$('[data-chat]', box).forEach((b) => {
          b.onclick = () => action(b, () => open(Number(b.dataset.chat)));
        });
      }

      $('#support-list-state', el).textContent = '';

      // 选中的那桌已经结摊了：清空，别让人对着一个已关闭的会话发呆
      if (selected && !d.chats.some((c) => c.id === selected)) {
        selected = null;
        room = null;
        // 作废在途的房间请求，否则它回来会把已清空的房间又填上
        epoch++;
        $('#support-chat-room', el).innerHTML = '<p>刚才那桌客人走了，换一桌。</p>';
      }

      if (!selected && d.chats.length) {
        // 自动落座：先找排队的、其次找别人在回的、最后才退而求其次。
        // 自己的会话永远排最后 —— 管理员自己点进来的不算「等着有人接」。
        const first =
          d.chats.find((c) => c.status === 'queued' && !c.is_self) ||
          d.chats.find((c) => c.status === 'active' && !c.is_self) ||
          d.chats[0];
        await open(first.id);
      } else if (!selected) {
        $('#support-chat-room', el).innerHTML = '<p>没人在等。玩家点转人工，这里会自己亮起来。</p>';
      }
    } catch (e) {
      if (el.isConnected) $('#support-list-state', el).textContent = '名单没拉下来：' + e.message;
    }
  }

  /** 打开一桌会话：画房间、挂按钮、设好回复权限 */
  async function open(id) {
    selected = id;
    const version = ++epoch;
    const box = $('#support-chat-room', el);
    try {
      const d = await api('/api/admin/support-chat?id=' + id);
      if (version !== epoch || !el.isConnected) return;
      room = d.chat;

      box.innerHTML =
        `<h3>${esc(room.player_name)}</h3>` +
        `<p id="human-state"></p>` +
        `<div class="messages" id="human-messages"></div>` +
        `<form id="human-reply">${field('content', '回玩家的话', 'textarea')}<button class="primary">发出去</button></form>` +
        `<div class="actions">` +
        `<button id="human-claim">我来接</button>` +
        `<button id="human-ticket">劝他开工单</button>` +
        `<button id="human-close">收摊</button>` +
        `<button id="human-refresh">再看一次</button>` +
        `</div>` +
        `<p id="human-error" role="status"></p>`;

      // 侧栏高亮跟到当前房间
      $$('[data-chat]', el).forEach((b) =>
        b.classList.toggle('selected', Number(b.dataset.chat) === id)
      );

      let lastId = -1;

      /** 只重画「变了」的部分：气泡 + 权限态。输入框的值不在重画范围内。 */
      function draw(data) {
        room = data.chat;
        const statusText = STATUS_LABELS[room.status];
        $('#human-state', box).textContent = room.is_self
          ? '这是你自己账号的对话，看得到、说不了——得换个人来。'
          : statusText + (room.status === 'queued' ? ' · 点“我来接”就能回。' : '');

        // 最后一条 id 没变就不碰气泡 DOM —— 否则管理员没发完的字会被冲掉
        const last = data.messages.at(-1)?.id || 0;
        if (lastId !== last) {
          lastId = last;
          const target = $('#human-messages', box);
          const nearBottom =
            target.scrollHeight - target.scrollTop - target.clientHeight < NEAR_BOTTOM;
          target.innerHTML =
            data.messages
              .map((m) => {
                const fromPlayer = m.from_player_id === room.player_id;
                // 发送方署名分三种：玩家本人 / 人工客服 #id / 灯灯
                const who = fromPlayer
                  ? esc(room.player_name)
                  : m.replied_by_admin_id
                  ? '市政厅 #' + m.replied_by_admin_id + ' ' + esc(m.reply_author_name || '')
                  : '灯灯';
                return (
                  `<div class="bubble ${fromPlayer ? '' : 'mine'}">` +
                  `<small>${who} · ${date(m.created_at)}</small>` +
                  `<p>${text(m.content)}</p>` +
                  `</div>`
                );
              })
              .join('') || '<p>还没人开口。</p>';
          // 只在原本贴着底时才跟着滚，不把人正在翻的历史拽回来
          if (nearBottom) target.scrollTop = target.scrollHeight;
        }

        // 回复权三条件：不是自己的会话 + 人工已接入 + 是承办人或超管
        const canReply =
          !room.is_self &&
          room.status === 'active' &&
          (room.assigned_admin_id === state.session.user.id || state.session.user.role === 'super');
        $('[name=content]', box).disabled = !canReply;
        $('[name=content]', box).placeholder = room.is_self
          ? '自己的对话，只能看'
          : canReply
          ? '写下要回的话'
          : '先点“我来接”';
        $('button', $('#human-reply', box)).disabled = !canReply;
        $('#human-claim', box).hidden = room.status !== 'queued' || room.is_self;
        $('#human-ticket', box).hidden = !canReply;
        $('#human-close', box).hidden = !canReply;
        $('#human-error', box).textContent = '';
      }

      /** 重拉当前房间。提交回复前先调它，为的是拿到最新 revision（乐观锁）。 */
      async function refresh() {
        const d = await api('/api/admin/support-chat?id=' + id);
        if (version === epoch && el.isConnected) draw(d);
      }

      // Keep the composer in place during refresh, preserving unfinished staff replies.
      // refresh 挂到容器上（而不是闭包变量）→ tick 能拿到当前这一间的最新版；
      // 出错时置 null，tick 里的 ?.() 就自然跳过。
      box._refresh = refresh;

      draw(d);

      $('#human-claim', box).onclick = (e) =>
        action(e.currentTarget, async () => {
          await post('/api/admin/support-chat', { id, action: 'claim' });
          await refresh();
          await list();
        });

      // 发消息前先 refresh 拿最新 revision —— 别人可能刚在同一个会话里回过，
      // 拿着旧 revision 发会被后端拒掉（乐观锁）。
      $('#human-reply', box).onsubmit = (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        action($('button', form), async () => {
          const content = $('[name=content]', form).value;
          await refresh();
          await post('/api/admin/support-chat', {
            id,
            action: 'reply',
            revision: room.revision,
            content,
          });
          $('[name=content]', form).value = '';
          await refresh();
        });
      };

      $('#human-ticket', box).onclick = () =>
        modal(
          '劝玩家开工单',
          field('summary', '写给玩家看的说明，会带进工单', 'textarea', '', { maxlength: 2000 }),
          {
            label: '给他一个开工单的按钮',
            submit: async (v) => {
              await refresh();
              await post('/api/admin/support-chat', {
                id,
                action: 'suggest-ticket',
                revision: room.revision,
                summary: v.summary,
              });
              await refresh();
            },
          }
        );

      $('#human-close', box).onclick = (e) =>
        action(e.currentTarget, async () => {
          await refresh();
          await post('/api/admin/support-chat', {
            id,
            action: 'close',
            revision: room.revision,
          });
          await refresh();
          await list();
        });

      $('#human-refresh', box).onclick = (e) => action(e.currentTarget, refresh);
    } catch (e) {
      if (version === epoch && el.isConnected) {
        box.innerHTML = '<p class="notice">' + esc(e.message) + '</p>';
        box._refresh = null;
      }
    }
  }

  /**
   * 5 秒一轮的轮询。
   * 切到后台标签页时跳过；出错就把回复区整个锁死，避免在断线状态下白打一段话。
   * setTimeout 放在递归末尾 —— 用它而不是 setInterval，这样一次慢请求
   * 不会把下一轮提前叠上来。
   */
  async function tick() {
    if (!el.isConnected) return;
    try {
      if (document.visibilityState !== 'hidden') {
        await list();
        if (el.isConnected && selected) await $('#support-chat-room', el)._refresh?.();
      }
    } catch (e) {
      if (el.isConnected) {
        $('#support-list-state', el).textContent = e.message;
        const form = $('#human-reply', el);
        if (form) $$('textarea,button', form).forEach((x) => (x.disabled = true));
      }
    }
    if (el.isConnected) setTimeout(tick, 5000);
  }

  $('#support-list-refresh', el).onclick = (e) => action(e.currentTarget, list);
  await list();
  if (el.isConnected) setTimeout(tick, 5000);
}
