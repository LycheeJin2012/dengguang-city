/**
 * 客栈预订弹窗。
 *
 * v79-2 从原 hotel.js 拆出来的 book() 与 localDay()，逻辑 1:1 迁移。
 *
 * 流程：确认房间和客栈都还在营业 → 用「明天 / 后天」预填日期 →
 * 随表单实时算总价 → 递交。
 */

import { $, api, post, esc, field, modal, requirePlayer, toast } from '../../core.js';

/** 加早餐时每晚每人的加价，单位 💎。 */
const BREAKFAST_PER_PERSON = 10;

/** 表单里人数的上限，同时受房间容量限制。 */
const MAX_PERSONS = 6;

/** 一天多少毫秒 —— 算住宿晚数用，避免除法散落在公式里。 */
const MS_PER_DAY = 86400000;

/** 把 Date 格式成 YYYY-MM-DD：`<input type="date">` 只认这个形状。 */
function localDay(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 在某个日期上加 n 天，返回新对象（不改原对象）。 */
function addDays(date, n) {
  const next = new Date(date);
  next.setDate(next.getDate() + n);
  return next;
}

/** 住宿几晚。退房不晚于入住时算 0。 */
function nightsBetween(inDate, outDate) {
  return (new Date(outDate) - new Date(inDate)) / MS_PER_DAY;
}

/**
 * 每晚房费，Number() 兜住后端偶尔返回字符串的情况。
 */
function nightlyRate(room) {
  return Number(room.price_per_night);
}

/** 早餐加价：房费已含则 0。复选框没勾上也是 0。 */
function breakfastExtra(form, room) {
  if (room.breakfast_included) return 0;
  if (!form.breakfast) return 0;
  return BREAKFAST_PER_PERSON * Number(form.persons);
}

/**
 * 打开预订弹窗。
 *
 * @param {object} room   房间（含 price_per_night / capacity / breakfast_included / is_active）
 * @param {object} hotel  客栈（含 name / is_active）
 */
export async function book(room, hotel) {
  const player = await requirePlayer();

  // 房或客栈下架了就别让人白填一遍表单
  if (!room.is_active || !hotel.is_active) throw new Error('这间还没对外开放，订不了');

  // 默认入住明天、退房后天
  const checkIn = addDays(new Date(), 1);
  const checkOut = addDays(checkIn, 1);

  const dialog = modal(
    '预订 · ' + room.name,
    `<div class="wide notice">${esc(hotel.name)} / ${esc(room.name)} · 💎 ${nightlyRate(room)} ${'/晚'}</div>` +
      field('in_date', '入住', 'date', localDay(checkIn)) +
      field('out_date', '退房', 'date', localDay(checkOut)) +
      field('name', '住客名字', 'text', player.username) +
      field('contact', '怎么联系你', 'text', player.email) +
      field('persons', '住几个人', 'number', 1, {
        min: 1,
        max: Math.min(MAX_PERSONS, room.capacity),
      }) +
      // 房费已含早餐时，这一项只作说明且不可勾
      field(
        'breakfast',
        room.breakfast_included ? '早餐已算在房费里' : `加早餐（${BREAKFAST_PER_PERSON} 💎/晚/人）`,
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

  /** 按当前表单内容刷新总价行。 */
  const refreshTotal = () => {
    const form = Object.fromEntries(new FormData($('form', dialog)));
    const nights = nightsBetween(form.out_date, form.in_date);
    const line = $('#booking-total', dialog);
    if (!(nights > 0)) {
      line.textContent = '退房得比入住晚';
      return;
    }
    const total = nights * (nightlyRate(room) + breakfastExtra(form, room));
    line.textContent = `💎 ${total} · ${nights} 晚`;
  };

  const form = $('form', dialog);
  form.addEventListener('input', refreshTotal);
  refreshTotal();

  // 房费已含早餐：复选框锁死，避免用户以为还能另外加钱
  if (room.breakfast_included) $('[name=breakfast]', dialog).disabled = true;
}
