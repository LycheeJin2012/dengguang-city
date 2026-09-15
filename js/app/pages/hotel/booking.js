/**
 * Hotel booking dialog.
 *
 * v79-2 拆分自原 hotel.js 的 book() + localDay()。
 * 逻辑 1:1 迁移。
 */

import {
  $,
  api,
  post,
  tr,
  esc,
  field,
  modal,
  requirePlayer,
  toast,
} from '../../core.js';

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
    throw new Error(tr('此房型暂未开放预订', 'Room not available'));
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const after = new Date(tomorrow);
  after.setDate(after.getDate() + 1);
  const d = modal(
    tr('预订 · ', 'Book · ') + room.name,
    `<div class="wide notice">${esc(hotel.name)} / ${esc(room.name)} · 💎 ${Number(
      room.price_per_night
    )} ${tr('/晚', '/night')}</div>` +
      field('in_date', tr('入住日期', 'Check-in'), 'date', localDay(tomorrow)) +
      field('out_date', tr('退房日期', 'Check-out'), 'date', localDay(after)) +
      field('name', tr('入住人', 'Guest'), 'text', player.username) +
      field('contact', tr('联系方式', 'Contact'), 'text', player.email) +
      field('persons', tr('入住人数', 'Guests'), 'number', 1, {
        min: 1,
        max: Math.min(6, room.capacity),
      }) +
      field(
        'breakfast',
        tr(
          room.breakfast_included ? '房费已含早餐' : '加早餐（10 💎/晚/人）',
          room.breakfast_included ? 'Breakfast included' : 'Breakfast (10 💎 per guest/night)'
        ),
        'checkbox',
        room.breakfast_included
      ) +
      field('note', tr('备注', 'Notes'), 'textarea', '', { required: false }) +
      '<p id="booking-total" class="wide price"></p>',
    {
      label: tr('提交预订', 'Submit booking'),
      submit: async (v) => {
        await post('/api/bookings', { ...v, room_id: room.id });
        toast(tr('预订已提交，等待市政厅确认', 'Booking submitted for confirmation'));
      },
    }
  );
  const total = () => {
    const form = $('form', d);
    const v = Object.fromEntries(new FormData(form));
    const nights = (new Date(v.out_date) - new Date(v.in_date)) / 86400000;
    $('#booking-total', d).textContent =
      nights > 0
        ? `💎 ${nights * (Number(room.price_per_night) + (v.breakfast && !room.breakfast_included ? 10 * Number(v.persons) : 0))} · ${nights} ${tr('晚', 'night(s)')}`
        : tr('退房日期必须晚于入住日期', 'Checkout must follow check-in');
  };
  $('form', d).addEventListener('input', total);
  total();
  if (room.breakfast_included) $('[name=breakfast]', d).disabled = true;
}