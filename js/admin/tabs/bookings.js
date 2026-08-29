// v44 重写: 酒店预订 tab
import { $, esc, fmt, GET, PATCH, DEL, safeRender, cacheClear } from '../core.js?v=v46-fix-modules';

export async function renderBookings() {
  await safeRender(async () => {
    const d = await GET('/api/admin/bookings');
    const list = d.bookings || [];
    const cP = list.filter(b => b.status === 'pending').length;
    const cC = list.filter(b => b.status === 'confirmed').length;
    const cD = list.filter(b => b.status === 'completed').length;
    $('#bookCntAll').textContent = list.length;
    $('#bookCntPending').textContent = cP;
    $('#bookCntConfirmed').textContent = cC;
    $('#bookCntCompleted').textContent = cD;
    $('#bookPending').textContent = cP > 0 ? `(${cP})` : '';

    const filter = (document.querySelector('input[name="bookFilter"]:checked') || {}).value || 'all';
    const roomFilter = $('#bookRoomFilter')?.value || '';
    let list2 = list;
    if (filter !== 'all') list2 = list2.filter(b => b.status === filter);
    if (roomFilter) list2 = list2.filter(b => b.room_id === roomFilter);

    const box = $('#bookList'), empty = $('#bookEmpty');
    if (!list2.length) { box.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';

    box.innerHTML = list2.map(b => {
      const opts = ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled']
        .map(s => `<option value="${s}" ${s === b.status ? 'selected' : ''}>${{ pending: '待处理', confirmed: '已确认', checked_in: '已入住', completed: '已完成', cancelled: '已取消' }[s]}</option>`).join('');
      return `<article class="msg-item" data-id="${b.id}">
        <div class="msg-head"><div class="msg-head-left">
          <span class="msg-type type-book">${esc(b.room_name || b.room_id)}</span>
          <b class="msg-name">👤 ${esc(b.name)} · ${esc(b.contact)}</b>
          <span class="book-status">${esc(b.status)}</span>
        </div><div class="msg-time">${fmt(b.created_at)}</div></div>
        <div class="book-detail">
          <div>📅 ${esc(b.in_date)} → ${esc(b.out_date)}</div>
          <div>🌙 ${b.nights} 晚 · 👥 ${b.persons} 人${b.breakfast ? ' · 🍳 含早餐' : ''}</div>
          ${b.note ? `<div>📝 ${esc(b.note)}</div>` : ''}
        </div>
        <div class="msg-actions book-actions">
          <button class="btn btn-primary btn-sm" data-act="edit">✎ 编辑</button>
          <select class="book-status-sel">${opts}</select>
          <button class="btn btn-ghost btn-sm" data-act="save">保存状态</button>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
    }).join('');

    box.querySelectorAll('.msg-item').forEach(el => {
      const id = +el.dataset.id;
      el.querySelector('[data-act="edit"]').onclick = () => bookEdit(list2.find(x => x.id === id));
      el.querySelector('[data-act="save"]').onclick = () => bookStatus(id, el.querySelector('.book-status-sel').value);
      el.querySelector('[data-act="del"]').onclick = () => bookDel(id);
    });
  });
}

export async function bookStatus(id, status) {
  try {
    await PATCH('/api/admin/bookings?id=' + id + '&status=' + status);
    cacheClear('bookings:');
    renderBookings();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export async function bookDel(id) {
  if (!confirm('删除该预订？')) return;
  try {
    await DEL('/api/admin/bookings?id=' + id);
    cacheClear('bookings:');
    renderBookings();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export function bookEdit(b) {
  let bd = document.getElementById('bookEditBackdrop');
  if (bd) bd.remove();
  bd = document.createElement('div');
  bd.id = 'bookEditBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  bd.innerHTML = `
    <div style="background:#fff;border:3px solid #000;box-shadow:6px 6px 0 #000;padding:24px;max-width:520px;width:100%">
      <h3 style="margin:0 0 12px">✎ 编辑酒店预订</h3>
      <div style="display:grid;gap:10px">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>姓名</span><input id="beName" type="text" value="${esc(b.name)}" style="padding:6px 8px;border:1px solid #888">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>联系方式</span><input id="beContact" type="text" value="${esc(b.contact)}" style="padding:6px 8px;border:1px solid #888">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>入住</span><input id="beIn" type="date" value="${esc(b.in_date)}" style="padding:6px 8px;border:1px solid #888">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>离店</span><input id="beOut" type="date" value="${esc(b.out_date)}" style="padding:6px 8px;border:1px solid #888">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>人数</span><input id="bePersons" type="number" min="1" max="6" value="${b.persons}" style="padding:6px 8px;border:1px solid #888">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>含早</span>
          <select id="beBreakfast" style="padding:6px 8px;border:1px solid #888">
            <option value="0" ${!b.breakfast ? 'selected' : ''}>不含</option>
            <option value="1" ${b.breakfast ? 'selected' : ''}>含</option>
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>备注</span><textarea id="beNote" rows="2" style="padding:6px 8px;border:1px solid #888">${esc(b.note || '')}</textarea>
        </label>
      </div>
      <div id="beMsg" style="font-size:12px;margin-top:8px;min-height:18px;color:#c33"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button id="beCancel" style="background:#888;color:#fff;border:none;padding:8px 16px;cursor:pointer">取消</button>
        <button id="beSave" style="background:#6cf;color:#000;border:none;padding:8px 16px;cursor:pointer;font-weight:bold">保存</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#beCancel').onclick = close;
  bd.querySelector('#beSave').onclick = async () => {
    try {
      await PATCH('/api/admin/bookings?id=' + b.id, {
        name: bd.querySelector('#beName').value.trim(),
        contact: bd.querySelector('#beContact').value.trim(),
        in_date: bd.querySelector('#beIn').value,
        out_date: bd.querySelector('#beOut').value,
        persons: +bd.querySelector('#bePersons').value,
        breakfast: +bd.querySelector('#beBreakfast').value,
        note: bd.querySelector('#beNote').value.trim(),
      });
      cacheClear('bookings:');
      close();
      renderBookings();
    } catch (e) { bd.querySelector('#beMsg').textContent = '保存失败: ' + e.message; }
  };
}
