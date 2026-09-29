/**
 * Hotel booking dialog.
 *
 * v79-2 拆分自原 hotel.js 的 book() + localDay()。
 * 逻辑 1:1 迁移。
 */

import {$,api,post,esc,field,modal,requirePlayer,toast} from '../../core.js'

// 把 Date 格式化成 YYYY-MM-DD（input[type=date] 期望的格式）。
function localDay(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

export async function book(room, hotel) {
  const player = await requirePlayer();
  if (!room.is_active || !hotel.is_active)
    throw new Error('这间还没对外开放，订不了');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const after = new Date(tomorrow);
  after.setDate(after.getDate() + 1);
  const d = modal(
    '预订 · ' + room.name,
    `<div class="wide notice">${esc(hotel.name)} / ${esc(room.name)} · 💎 ${Number(
      room.price_per_night
    )} ${'/晚'}</div>` +
      field('in_date', '入住', 'date', localDay(tomorrow)) +
      field('out_date', '退房', 'date', localDay(after)) +
      field('name', '住客名字', 'text', player.username) +
      field('contact', '怎么联系你', 'text', player.email) +
      field('persons', '住几个人', 'number', 1, {
        min: 1,
        max: Math.min(6, room.capacity),
      }) +
      field(
        'breakfast',
        room.breakfast_included ? '早餐已算在房费里' : '加早餐（10 💎/晚/人）',
        'checkbox',
        room.breakfast_included
      ) +
      field('note', '还想说的', 'textarea', '', { required: false }) +
      '<p id="booking-total" class="wide price"></p>',
    {
      label: '递交预订',
      submit: async (v) => {
        await post('/api/bookings', { ...v, room_id: room.id });
        toast('递交了，等市政厅点头');
      },
    }
  );
  const total = () => {
    const form = $('form', d);
    const v = Object.fromEntries(new FormData(form));
    const nights = (new Date(v.out_date) - new Date(v.in_date)) / 86400000;
    $('#booking-total', d).textContent =
      nights > 0
        ? `💎 ${nights * (Number(room.price_per_night) + (v.breakfast && !room.breakfast_included ? 10 * Number(v.persons) : 0))} · ${nights} ${'晚'}`
        : '退房得比入住晚';
  };
  $('form', d).addEventListener('input', total);
  total();
  if (room.breakfast_included) $('[name=breakfast]', d).disabled = true;
}