/**
 * 酒店房型卡列表 + 单个房型的详情弹窗。
 *
 * 原来这个文件 50 行、最长行 272 字符：卡片模板、预订按钮绑定、详情弹窗挤在
 * 一个函数里。现在把「一张卡」和「详情正文」提成两个纯函数。
 *
 * 注意：pages/home/index.js 也 import 这个模块（首页只取 3 张做预览），
 * 所以 roomCards 的签名和导出名必须保持原样。
 *
 * 不能改的行为：
 *   1. **先按 hotel_id 过滤再 slice(limit)**。顺序不能反：先 slice 会取到
 *      挂在已下架酒店下的房型，首页就会露出点不动的卡片。
 *   2. `open = r.is_active && h.is_active` —— 房型和酒店**都**在营业才算可订。
 *      只看房型会让「整家酒店歇业了但房型还挂着 active」的房间还能点预订。
 *   3. 卡的图优先用房型自己的图，没有才回退到酒店的图（`r.image_url || h.image_url`）。
 *   4. 房型没有介绍时用兜底文案「这间还没写介绍，房主大概在赶工」，不是空段落。
 */

import { recordCard } from '../../../ui/card.js';
import { $, $$, esc, empty, imageUrl, modal, toast } from '../../core.js';
import { book } from './booking.js';

/** 一张房型卡。h 是它所属的酒店。 */
function roomCard(r, h) {
  const open = r.is_active && h.is_active;
  // 房型没图就借酒店的图；两张都没有就不出 img
  const photo = imageUrl(r.image_url || h.image_url);

  return recordCard({
    title: r.name,
    meta: `<p class="eyebrow">${esc(h.name)}</p>`,
    density: 'compact',
    media: photo ? `<img loading="lazy" src="${esc(photo)}" alt="${esc(r.name)}">` : '',
    body:
      `<p>${esc(r.beds || '')} · ${Number(r.capacity)} 人</p>` +
      `<p class="muted">${esc(r.description || '这间还没写介绍，房主大概在赶工')}</p>` +
      `<p class="price">💎 ${Number(r.price_per_night)} / 晚</p>`,
    actions:
      `<button data-detail="${r.id}" class="compact">细看</button>` +
      `<button data-book="${r.id}" class="primary compact" ${open ? '' : 'disabled'}>` +
      `${open ? '预订' : '筹建中'}</button>`,
  });
}

/** 「细看」弹窗的正文 */
function detailMarkup(r, h) {
  return (
    '<div class="wide">' +
    `<p>${esc(h.name)} · ${esc(h.address)}</p>` +
    `<p>${esc(r.description)}</p>` +
    `<p>${esc(r.beds)} · ${r.capacity} 人</p>` +
    `<p>${r.breakfast_included ? '早餐已含' : '早餐另加'}</p>` +
    `<p class="price">💎 ${r.price_per_night} / 晚</p></div>`
  );
}

export function roomCards(el, bundle, { limit } = {}) {
  // 建索引是为了 O(1) 找所属酒店
  const hotels = new Map(bundle.hotels.map((h) => [h.id, h]));
  // 先剔掉挂不到酒店的孤儿房型，再限量
  const rooms = bundle.rooms.filter((r) => hotels.has(r.hotel_id)).slice(0, limit);

  el.innerHTML = rooms.length
    ? `<div class="cards">${rooms.map((r) => roomCard(r, hotels.get(r.hotel_id))).join('')}</div>`
    : empty();

  $$('[data-book]', el).forEach((b) => {
    b.onclick = () => {
      const r = rooms.find((r) => r.id === +b.dataset.book);
      book(r, hotels.get(r.hotel_id)).catch((e) => toast(e.message, true));
    };
  });

  $$('[data-detail]', el).forEach((b) => {
    b.onclick = () => {
      const r = rooms.find((r) => r.id === +b.dataset.detail);
      modal(r.name, detailMarkup(r, hotels.get(r.hotel_id)));
    };
  });
}
