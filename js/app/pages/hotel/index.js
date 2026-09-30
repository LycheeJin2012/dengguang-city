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

import {$,$$,api,region,field,title} from '../../core.js'
import { roomCards } from './rooms.js';
import { book } from './booking.js';

export async function render(el) {
  el.innerHTML =
    title('树上酒店') +
    `<div class="service-layout"><aside class="service-filters"><div class="toolbar">${field(
      'availability',
      '房态',
      'select',
      'all',
      {
        options: [
          ['all', '全部'],
          ['open', '可预订'],
          ['draft', '筹建中'],
        ],
      }
    )}${field('guests', '住得下几口', 'number', 1, { min: 1, max: 6 })}${field(
      'sort',
      '排序',
      'select',
      'default',
      {
        options: [
          ['default', '默认'],
          ['asc', '价低在前'],
          ['desc', '价高在前'],
        ],
      }
    )}</div></aside><section id="rooms" class="service-results"></section></div>`;
  await region($('#rooms', el), () => api('/api/homepage-bundle'), (d, box) => {
    const draw = () => {
      const v = $('[name=availability]', el).value;
      const cap = Number($('[name=guests]', el).value) || 1;
      const s = $('[name=sort]', el).value;
      const hs = new Map(d.bundle.hotels.map((h) => [h.id, h]));
      // 房态这一句是三项条件的合并：
      //   住得下（capacity >= cap）
      //   且 ——「全部」和「可预订」都放行可订的房间；「筹建中」只放行不可订的
      //        那个布尔值取反就是这里写的 === 比较，两侧都是布尔值才成立。
      //      房型和酒店都 active 才算可订，和 rooms.js 里的判定保持一致。
      let rooms = d.bundle.rooms.filter(
        (r) =>
          r.capacity >= cap &&
          (v === 'all' || v === 'open') === !!(r.is_active && hs.get(r.hotel_id)?.is_active)
      );
      // 价格是字符串也能直接相减，这里保持原样不做 Number() 转换
      if (s !== 'default')
        rooms.sort((a, b) => (a.price_per_night - b.price_per_night) * (s === 'asc' ? 1 : -1));
      roomCards(box, { ...d.bundle, rooms });
    };
    $$('.toolbar input,.toolbar select', el).forEach((x) => (x.onchange = draw));
    draw();
  });
}