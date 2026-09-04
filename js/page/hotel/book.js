// v50: hotel 预订 modal
import { $, esc, POST } from '../util.js?v=20260905-v50-0';

let _bookRoom = null;

export function bindBook() {
  const mask = $('#bookMask');
  if (!mask) return;
  $('#bookClose')?.addEventListener('click', closeBook);
  $('#bookCancel')?.addEventListener('click', closeBook);
  mask.addEventListener('click', e => { if (e.target === mask) closeBook(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && mask.style.display !== 'none') closeBook(); });

  $('#bookForm')?.addEventListener('submit', onSubmit);

  // 监听日期变化算晚数
  ['#bookIn', '#bookOut', '#bookBreakfast'].forEach(s => $(s)?.addEventListener('change', updateNights));

  // 暴露全局让 rooms.js 调用
  window._openBook = openBook;
}

function openBook(room) {
  _bookRoom = room;
  const mask = $('#bookMask');
  $('#bookTitle').textContent = '📅 预订：' + (room.name || '房型');
  $('#bookSummary').innerHTML = `<div><b>${esc(room.name)}</b><br/><span class="book-sub">${esc(room.view || '')} · 可住 ${esc(String(room.guests || 2))} 人</span></div><div class="summary-price">${esc(room.price || '¥?')}</div>`;
  // 默认日期
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  $('#bookIn').value = today;
  $('#bookOut').value = tomorrow;
  $('#bookBreakfast').checked = false;
  $('#bookMsg').textContent = '';
  updateNights();
  mask.style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeBook() {
  const mask = $('#bookMask');
  if (mask) mask.style.display = 'none';
  document.body.style.overflow = '';
}

function updateNights() {
  const inD = $('#bookIn')?.value;
  const outD = $('#bookOut')?.value;
  const nightsEl = $('#bookNights');
  const totalEl = $('#bookTotal');
  if (!inD || !outD) { if (nightsEl) nightsEl.textContent = '— 晚'; return; }
  const d = (new Date(outD) - new Date(inD)) / 86400000;
  if (d <= 0) { if (nightsEl) nightsEl.textContent = '退房日期需晚于入住日期'; if (totalEl) totalEl.textContent = ''; return; }
  const nights = d;
  if (nightsEl) nightsEl.textContent = `${nights} 晚`;
  // 估算总价
  const breakfast = $('#bookBreakfast')?.checked;
  const guests = Number($('#bookGuests')?.value || 1);
  const priceText = _bookRoom?.price || '¥?';
  const m = String(priceText).match(/(\d+)/);
  if (m && totalEl) {
    const base = Number(m[1]) * nights;
    const bf = breakfast ? 10 * nights * guests : 0;
    totalEl.textContent = `💎 估算总价：${base + bf} 💎${breakfast ? ` (含早餐 ${bf})` : ''}`;
  }
}

async function onSubmit(e) {
  e.preventDefault();
  if (!_bookRoom) return;
  const msg = $('#bookMsg');
  const submit = e.target.querySelector('button[type=submit]');
  const data = {
    room_id: _bookRoom.id,
    room_name: _bookRoom.name,
    in_date: $('#bookIn').value,
    out_date: $('#bookOut').value,
    nights: Math.max(1, Math.round((new Date($('#bookOut').value) - new Date($('#bookIn').value)) / 86400000)),
    persons: Number($('#bookGuests').value || 1),
    breakfast: $('#bookBreakfast').checked ? 1 : 0,
    name: $('#bookName').value.trim(),
    contact: $('#bookContact').value.trim(),
    note: $('#bookNote').value.trim(),
  };
  if (!data.name || !data.contact) { msg.textContent = '请填写姓名和联系方式'; msg.className = 'modal-msg err'; return; }
  submit.disabled = true;
  msg.textContent = '提交中...'; msg.className = 'modal-msg';
  try {
    await POST('/api/bookings', data);
    msg.textContent = '预订成功! 市政厅会尽快确认。'; msg.className = 'modal-msg ok';
    if (window._toast) window._toast('预订已提交', 'success');
    setTimeout(closeBook, 1500);
  } catch (err) {
    msg.textContent = '失败: ' + err.message; msg.className = 'modal-msg err';
    if (window._toast) window._toast('失败: ' + err.message, 'error');
  } finally {
    submit.disabled = false;
  }
}
