// v45 重写: hotel 子页 - 预订 modal + 提交
import { $, escHtml, POST, GET } from '../util.js?v=v45-fix-401';

let bookRoom = null;

export function openBookModal(r) {
  const mask = $('#bookMask');
  if (!mask) return;
  bookRoom = r;
  const t = $('#bookTitle'); if (t) t.textContent = `预订 · ${r.name}`;
  const s = $('#bookSummary');
  if (s) s.innerHTML = `
    <div>
      <b>${r.icon} ${r.name}</b>
      <span class="book-room-meta">${escHtml(r.bed)} · ${r.guests}+ 人${r.price ? ' · 💎 ' + r.price + '/晚' : ''}</span>
    </div>`;
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);
  const bi = $('#bookIn'); if (bi) bi.value = tomorrow.toISOString().slice(0, 10);
  const bo = $('#bookOut'); if (bo) bo.value = dayAfter.toISOString().slice(0, 10);
  const m = $('#bookMsg'); if (m) m.textContent = '';
  updateBookTotal();
  mask.style.display = '';
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#bookName')?.focus(), 50);
  // 自动填玩家信息 (登录态有的话)
  prefillFromPlayer();
}

export function closeBookModal() {
  const mask = $('#bookMask');
  if (!mask) return;
  mask.style.display = 'none';
  document.body.style.overflow = '';
}

function updateBookTotal() {
  if (!$('#bookIn') || !$('#bookOut') || !bookRoom) return;
  const inD = new Date($('#bookIn').value);
  const outD = new Date($('#bookOut').value);
  if (isNaN(inD) || isNaN(outD) || outD <= inD) {
    const bn = $('#bookNights'); if (bn) bn.textContent = '— 请选择有效日期';
    const bt = $('#bookTotal'); if (bt) bt.textContent = '';
    return;
  }
  const nights = Math.round((outD - inD) / 86400000);
  const persons = parseInt($('#bookGuests').value, 10) || 1;
  const wantBf = $('#bookBreakfast')?.checked;
  const bn = $('#bookNights');
  if (bn) bn.textContent = `${nights} 晚 · ${persons} 人${wantBf ? ' · 含早餐' : ''}`;
  const bt = $('#bookTotal');
  if (bt) {
    const total = (bookRoom.price || 0) * nights;
    bt.textContent = `💎 ${total}（${nights} 晚 × ${bookRoom.price || 0}）`;
  }
}

async function prefillFromPlayer() {
  try {
    const d = await GET('/api/login');
    if (d && d.ok && d.player) {
      const n = $('#bookName'); if (n && !n.value) n.value = d.player.username;
      const c = $('#bookContact'); if (c && !c.value && d.player.email) c.value = d.player.email;
    }
  } catch (e) {}
}

export function bindBook() {
  $('#bookClose')?.addEventListener('click', closeBookModal);
  $('#bookCancel')?.addEventListener('click', closeBookModal);
  const mask = $('#bookMask');
  if (mask) mask.addEventListener('click', e => { if (e.target === mask) closeBookModal(); });
  $('#bookIn')?.addEventListener('change', updateBookTotal);
  $('#bookOut')?.addEventListener('change', updateBookTotal);
  $('#bookGuests')?.addEventListener('input', updateBookTotal);
  $('#bookBreakfast')?.addEventListener('change', updateBookTotal);
  document.addEventListener('keydown', e => { if (mask?.style.display === '' && e.key === 'Escape') closeBookModal(); });

  $('#bookForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!bookRoom) return;
    const inD = new Date($('#bookIn').value);
    const outD = new Date($('#bookOut').value);
    if (isNaN(inD) || isNaN(outD) || outD <= inD) {
      const m = $('#bookMsg'); if (m) m.textContent = '退房日期必须晚于入住日期';
      return;
    }
    const nights = Math.round((outD - inD) / 86400000);
    const name = $('#bookName').value.trim();
    const contact = $('#bookContact').value.trim();
    if (!name || !contact) { const m = $('#bookMsg'); if (m) m.textContent = '请填写姓名和联系方式'; return; }
    const note = $('#bookNote').value.trim();
    const wantBreakfast = $('#bookBreakfast')?.checked;
    const persons = parseInt($('#bookGuests').value, 10) || 1;
    const submitBtn = $('#bookForm').querySelector('button[type="submit"]');
    const origText = submitBtn.textContent;
    submitBtn.textContent = '提交中...';
    submitBtn.disabled = true;
    const msg = $('#bookMsg'); if (msg) msg.textContent = '';
    try {
      await POST('/api/bookings', {
        room_id: bookRoom.id,
        room_name: bookRoom.name,
        in_date: $('#bookIn').value,
        out_date: $('#bookOut').value,
        nights, persons,
        breakfast: wantBreakfast ? 1 : 0,
        name, contact, note
      });
      submitBtn.textContent = '✓ 已提交（跨设备同步, 管理员会确认）';
      submitBtn.classList.add('btn-success');
      $('#bookForm').reset();
      setTimeout(() => { submitBtn.classList.remove('btn-success'); closeBookModal(); }, 1500);
    } catch (err) {
      if (err.message && /登录|会话/.test(err.message)) {
        const m = $('#bookMsg'); if (m) m.textContent = '请先登录玩家账号再预订';
        submitBtn.textContent = origText;
        submitBtn.disabled = false;
        setTimeout(() => {
          closeBookModal();
          location.href = 'index.html?action=login&reason=' + encodeURIComponent('请先登录玩家账号再预订酒店');
        }, 1200);
      } else {
        const m = $('#bookMsg'); if (m) m.textContent = '✗ ' + err.message;
        submitBtn.textContent = origText;
        submitBtn.disabled = false;
      }
    }
  });
}

// prefillFromPlayer 已在 openBookModal 内自动调用, 不需要额外包装
