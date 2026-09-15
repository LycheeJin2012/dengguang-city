/**
 * Hotel page workspace.
 *
 * v79-2 拆分自原 js/app/hotel.js (79 行)：
 *   - book    → ./booking.js
 *   - roomCards → ./rooms.js
 *   - render  → 本文件
 *
 * 依赖路径相应上移一级。外部（home.js）通过 './rooms.js' 引用 roomCards，
 * 因此本文件 re-export 一下保持兼容。
 */

import { $, $$, api, region, tr, field, title } from '../../core.js';
import { roomCards } from './rooms.js';
import { book } from './booking.js';

// Re-export for pages/home/index.js 的 `import { roomCards } from '../../hotel.js'`。
export { roomCards };
// Re-export 保持 hotel.js forwarder 的 `export { render, book, roomCards }` 兼容。
export { book } from './booking.js';

export async function render(el) {
  el.innerHTML =
    title('树上酒店', 'Treehouse Hotel') +
    `<div class="service-layout"><aside class="service-filters"><div class="toolbar">${field(
      'availability',
      tr('状态', 'Status'),
      'select',
      'all',
      {
        options: [
          ['all', tr('全部', 'All')],
          ['open', tr('可预订', 'Available')],
          ['draft', tr('筹建中', 'Coming soon')],
        ],
      }
    )}${field('guests', tr('至少容纳', 'Minimum capacity'), 'number', 1, { min: 1, max: 6 })}${field(
      'sort',
      tr('排序', 'Sort'),
      'select',
      'default',
      {
        options: [
          ['default', tr('默认', 'Default')],
          ['asc', tr('价格从低到高', 'Price: low to high')],
          ['desc', tr('价格从高到低', 'Price: high to low')],
        ],
      }
    )}</div></aside><section id="rooms" class="service-results"></section></div>`;
  await region($('#rooms', el), () => api('/api/homepage-bundle'), (d, box) => {
    const draw = () => {
      const v = $('[name=availability]', el).value;
      const cap = Number($('[name=guests]', el).value) || 1;
      const s = $('[name=sort]', el).value;
      const hs = new Map(d.bundle.hotels.map((h) => [h.id, h]));
      let rooms = d.bundle.rooms.filter(
        (r) =>
          r.capacity >= cap &&
          (v === 'all' || v === 'open') === !!(r.is_active && hs.get(r.hotel_id)?.is_active)
      );
      if (s !== 'default')
        rooms.sort((a, b) => (a.price_per_night - b.price_per_night) * (s === 'asc' ? 1 : -1));
      roomCards(box, { ...d.bundle, rooms });
    };
    $$('.toolbar input,.toolbar select', el).forEach((x) => (x.onchange = draw));
    draw();
  });
}