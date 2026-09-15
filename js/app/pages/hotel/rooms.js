/**
 * Hotel room cards + per-room detail dialog.
 *
 * v79-2 拆分自原 hotel.js 的 roomCards()。
 * 注意：pages/home/index.js 也 import 这个模块，所以保持同名导出。
 */

import { recordCard } from '../../../ui/card.js';
import { $, $$ } from '../../core.js';
import { esc, tr, empty, imageUrl, modal, toast } from '../../core.js';
import { book } from './booking.js';

export function roomCards(el, bundle, { limit } = {}) {
  const hotels = new Map(bundle.hotels.map((h) => [h.id, h]));
  const rooms = bundle.rooms.filter((r) => hotels.has(r.hotel_id)).slice(0, limit);
  el.innerHTML = rooms.length
    ? `<div class="cards">${rooms
        .map((r) => {
          const h = hotels.get(r.hotel_id);
          const open = r.is_active && h.is_active;
          return recordCard({
            title: r.name,
            meta: `<p class="eyebrow">${esc(h.name)}</p>`,
            density: 'compact',
            media: imageUrl(r.image_url || h.image_url)
              ? `<img loading="lazy" src="${esc(imageUrl(r.image_url || h.image_url))}" alt="${esc(r.name)}">`
              : '',
            body: `<p>${esc(r.beds || '')} · ${Number(r.capacity)} ${tr('人', 'guests')}</p><p class="muted">${esc(r.description || tr('房型介绍待公布', 'Details coming soon'))}</p><p class="price">💎 ${Number(r.price_per_night)} / ${tr('晚', 'night')}</p>`,
            actions: `<button data-detail="${r.id}" class="compact">${tr('详情', 'Details')}</button><button data-book="${r.id}" class="primary compact" ${open ? '' : 'disabled'}>${tr(open ? '预订' : '筹建中', open ? 'Book' : 'Coming soon')}</button>`,
          });
        })
        .join('')}</div>`
    : empty();
  $$('[data-book]', el).forEach((b) =>
    b.onclick = () =>
      book(
        rooms.find((r) => r.id === +b.dataset.book),
        hotels.get(rooms.find((r) => r.id === +b.dataset.book).hotel_id)
      ).catch((e) => toast(e.message, true))
  );
  $$('[data-detail]', el).forEach((b) =>
    b.onclick = () => {
      const r = rooms.find((r) => r.id === +b.dataset.detail);
      const h = hotels.get(r.hotel_id);
      modal(
        r.name,
        `<div class="wide"><p>${esc(h.name)} · ${esc(h.address)}</p><p>${esc(r.description)}</p><p>${esc(r.beds)} · ${r.capacity} ${tr('人', 'guests')}</p><p>${tr(r.breakfast_included ? '含早餐' : '不含早餐', r.breakfast_included ? 'Breakfast included' : 'Breakfast not included')}</p><p class="price">💎 ${r.price_per_night} / ${tr('晚', 'night')}</p></div>`
      );
    }
  );
}