/**
 * 老板自助台：酒店资料 / 房型与房价 / 预订处理，三个 tab 共用一份 /api/hotel-owner。
 *
 * 原来这个文件只有 21 行、最长行 1052 字符：一个 tab 切换器、一张卡片列表、
 * 一个编辑弹窗，全部挤在三个超长函数体里。现在按「外壳 / 列表 / 编辑弹窗」
 * 拆开，模板串按原位置切段。
 *
 * 不能改的行为：
 *   1. `draw()` 读的是外层的 `data[tab]`，而 `data` 是 refresh() 的 region
 *      回填时赋的。切 tab 时不重新请求，只把已有 data 重画一遍 —— 这是刻意的，
 *      避免每点一次 tab 就打一次接口。
 *   2. 切 tab 时先同步 aria-selected，再 `if (data)` 判空重画：首屏 region
 *      可能还在飞，此时 data 是 undefined，画了也白画。
 *   3. 「＋ 新房型」按钮只在 rooms tab 且 data.hotels.length 时出现；没有酒店
 *      就没法选归属，不该给这个入口。
 *   4. 编辑弹窗里 `picker` 是先 `modal(...)` 拿到 dialog、再挂 `attachmentPicker`。
 *      提交时先 `picker.files()` 把上传好的图 URL 写进 d.image_url，**再**
 *      `picker.commit()`。顺序不能反：commit 会清掉待选文件。
 *   5. 操作记录里的 action 码 → 中文映射（post/patch/db.insert/…）原样保留，
 *      认不出的 action 直接显示原始码。
 */

import { $, $$, api, post, patch, esc, text, date, status, title, field, modal, region, action, toast, state, login, session, csv } from '../../core.js';
import { recordCard } from '../../../ui/card.js';
import { attachmentPicker } from '../../attachments.js';

/** tab key → 标题文字 */
const TAB_TITLES = {
  hotels: '酒店资料',
  rooms: '房型与房价',
  bookings: '预订处理',
};

/** 预订状态可选值 */
const BOOKING_STATUS = [
  ['pending', '待确认'],
  ['confirmed', '已确认'],
  ['completed', '已入住'],
  ['cancelled', '已取消'],
];

/** 操作日志里的 action 码 → 中文。认不出的原样显示 action 本身。 */
const ACTION_LABELS = {
  post: '新建',
  patch: '改动',
  'db.insert': '存了一条',
  'db.update': '改了这条',
  'db.delete': '删掉这条',
};

const ownerTabs = () =>
  '<div class="tabs">' +
  '<button data-owner-tab="hotels" aria-selected="true">酒店资料</button>' +
  '<button data-owner-tab="rooms">房型与房价</button>' +
  '<button data-owner-tab="bookings">预订处理</button>' +
  '</div>';

export async function render(el) {
  if (!state.session?.hotel_owner) {
    el.innerHTML =
      title('酒店自助台') +
      '<div class="panel"><h2>老板自助台</h2>' +
      '<p>经营账户由超管开好，再把能管的酒店分给你。已经绑上经营账户的玩家，进来直接开门。</p>' +
      '<button id="owner-login" class="primary">我是老板</button></div>';
    $('#owner-login', el).onclick = async () => {
      await login(false, 'hotel_owner');
      await session();
      if (state.session?.hotel_owner) render(el);
    };
    return;
  }

  el.innerHTML = title('我的酒店') + ownerTabs() + '<div id="owner-body"></div>';

  let tab = 'hotels';
  let data;

  const refresh = () =>
    region($('#owner-body', el), () => api('/api/hotel-owner'), (d, box) => {
      data = d;
      draw(box);
    });

  /** 一张卡片的标题：预订用房型名，酒店/房型用 name，都没有就退回 #id */
  const cardTitle = (r) => r.name || r.room_name || '#' + r.id;

  /** 预订卡和资料卡的正文结构完全不同，分开写 */
  function cardBody(r) {
    if (tab === 'bookings') {
      return (
        `<p>${esc(r.player_username || r.name)} · ${esc(r.contact)}</p>` +
        `<p>${esc(r.in_date)} → ${esc(r.out_date)}</p>` +
        status(r.status)
      );
    }
    // 房型卡第二行是房价，酒店卡第二行是地址
    const second = tab === 'rooms' ? '<p>💎 ' + r.price_per_night + ' / 晚</p>' : `<p>${esc(r.address)}</p>`;
    return `<p>${text(r.description || '')}</p>${second}` + status(r.is_active ? 'active' : 'pending');
  }

  function draw(box) {
    const list = data[tab];

    // 「＋ 新房型」只在房型 tab 且名下有酒店时给
    const add = tab === 'rooms' && data.hotels.length ? '<button id="owner-new">＋ 新房型</button>' : '';

    const cards = list.length
      ? '<div class="cards">' +
        list
          .map((r) =>
            recordCard({
              title: cardTitle(r),
              body: cardBody(r),
              actions:
                `<button data-edit="${r.id}">${tab === 'bookings' ? '处理预订' : '改一改'}</button>` +
                '<button data-history="' + r.id + '">操作记录</button>',
            })
          )
          .join('') +
        '</div>'
      : `<div class="empty">${data.hotels.length ? '这儿还空着' : '超管还没把酒店分给你，找他开一间。'}</div>`;

    box.innerHTML =
      '<div class="section-head"><h2>' +
      TAB_TITLES[tab] +
      '</h2><div class="actions compact">' +
      '<button id="owner-refresh">重新载入</button>' +
      add +
      '</div></div>' +
      cards;

    $('#owner-refresh', box).onclick = refresh;
    $('#owner-new', box)?.addEventListener('click', () => edit({}));

    $$('[data-history]', box).forEach((b) => {
      b.onclick = () =>
        action(b, async () => {
          const d = await api(`/api/hotel-owner?history=1&entity=${tab}&id=${b.dataset.history}`);
          const events =
            d.events
              .map(
                (e) =>
                  '<div class="row">' +
                  `<b>${esc(e.actor_name)} #${e.actor_id}</b>` +
                  `<p>${esc(ACTION_LABELS[e.action] || e.action)} · ${date(e.created_at)}</p></div>`
              )
              .join('') || '还没人动过';
          modal('谁动过这条', `<div class="wide">${events}</div>`);
        });
    });

    $$('[data-edit]', box).forEach((b) => {
      b.onclick = () => edit(list.find((r) => r.id === +b.dataset.edit));
    });
  }

  /** 预订 tab 只能改状态，走一个更小的弹窗 */
  function editBooking(record) {
    modal(
      '处理这条预订',
      `<div class="notice wide">${esc(record.room_name)} · ${esc(record.in_date)} → ${esc(record.out_date)}</div>` +
        field('status', '这条预订', 'select', record.status, { options: BOOKING_STATUS }),
      {
        submit: async (d) => {
          await patch('/api/hotel-owner?entity=bookings&id=' + record.id, d);
          await refresh();
        },
      }
    );
  }

  /** 酒店 / 房型的编辑弹窗。record 为空表示新建。 */
  function edit(record) {
    if (tab === 'bookings') return editBooking(record);

    const room = tab === 'rooms';
    let picker;

    // 房型多一组字段：归属酒店 / 容量 / 床型 / 房价 / 早餐；酒店则是地址
    const basics =
      (room
        ? field('hotel_id', '挂在哪家', 'select', record.hotel_id || data.hotels[0].id, {
            options: data.hotels.map((h) => [h.id, h.name]),
          })
        : '') +
      field('name', '名字', 'text', record.name || '') +
      (room
        ? field('capacity', '住几人', 'number', record.capacity || 2, { min: 1, max: 6 }) +
          field('beds', '床型', 'text', record.beds || '', { required: false }) +
          field('price_per_night', '一晚多少 💎', 'number', record.price_per_night || 0, { min: 0 }) +
          field('breakfast_included', '含早餐', 'checkbox', record.breakfast_included ?? 1)
        : field('address', '地址', 'text', record.address || '', { required: false }));

    const content =
      basics +
      field('description', '介绍', 'textarea', record.description || '', { required: false }) +
      field('image_url', '图片 URL（也能在下方传）', 'text', record.image_url || '', { required: false }) +
      field('is_active', '在营业', 'checkbox', record.is_active ?? 1);

    const dialog = modal('改这条信息', content, {
      wide: true,
      submit: async (d) => {
        // 先把已上传的图片 URL 取出来写进表单，再提交，最后才 commit
        const images = picker.files();
        if (images.length) d.image_url = images[0].url;
        await (record.id
          ? patch(`/api/hotel-owner?entity=${tab}&id=${record.id}`, d)
          : post('/api/hotel-owner?entity=rooms', d));
        picker.commit();
        await refresh();
        toast('存下了');
      },
    });

    picker = attachmentPicker(dialog, { purpose: 'public-image', max: 1 });
  }

  $$('[data-owner-tab]', el).forEach((b) => {
    b.onclick = () => {
      tab = b.dataset.ownerTab;
      $$('[data-owner-tab]', el).forEach((x) => x.setAttribute('aria-selected', x === b));
      // 切 tab 不重新请求：直接拿已有的 data 重画
      if (data) draw($('#owner-body', el));
    };
  });

  await refresh();
}
