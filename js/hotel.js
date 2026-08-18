/* =====================================================
   树上酒店子页 · 房型浏览 + 筛选器 + 预订
   与主站 index.html 共享 ROOMS 草案
   ===================================================== */
(function () {
  'use strict';

  /* ---------- 1. 房型数据（草案） ---------- */
  const ROOMS = [
    {
      id: 'std',
      name: '树上标间',
      icon: '🛏️',
      status: '草拟',
      bed: '床型待公告',
      guests: 1,
      view: '窗外',
      features: ['家具配置待公告', '窗外景观待公告'],
      price: null,
      recommend: false
    },
    {
      id: 'king',
      name: '树上大床房',
      icon: '🛌',
      status: '草拟',
      bed: '床型待公告',
      guests: 2,
      view: '景观',
      features: ['家具配置待公告', '景观待公告'],
      price: null,
      recommend: false
    },
    {
      id: 'lux',
      name: '树上豪华房',
      icon: '🏨',
      status: '草拟',
      bed: '床型待公告',
      guests: 3,
      view: '景观',
      features: ['家具配置待公告', '景观待公告', '独立阳台待公告'],
      price: null,
      recommend: true
    }
  ];

  /* ---------- 2. 工具 ---------- */
  const $ = (s) => document.querySelector(s);
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 3. 筛选器 ---------- */
  const filters = { status: 'all', guests: 0, view: 'all' };
  function applyFilters() {
    return ROOMS.filter(r => {
      if (filters.status !== 'all' && r.status !== filters.status) return false;
      if (filters.guests > 0) {
        if (filters.guests === 3) { if (r.guests < 3) return false; }
        else { if (r.guests !== filters.guests) return false; }
      }
      if (filters.view !== 'all' && r.view !== filters.view) return false;
      return true;
    });
  }

  /* ---------- 4. 渲染 ---------- */
  function renderRooms() {
    const grid = $('#roomGrid');
    if (!grid) return;
    const list = applyFilters();
    $('#hotelCount').textContent = `共 ${list.length} 间 / 总 ${ROOMS.length} 间`;
    if (list.length === 0) {
      grid.innerHTML = '<div class="hotel-empty">没有符合条件的房型，试试调整筛选条件。</div>';
      return;
    }
    grid.innerHTML = list.map(r => `
      <article class="room-card" data-id="${r.id}">
        ${r.recommend ? '<div class="room-badge">★ 推荐</div>' : ''}
        <div class="room-head">
          <span class="room-icon">${r.icon}</span>
          <h3 class="room-name">${escapeHtml(r.name)}<span class="room-status draft">${escapeHtml(r.status)}</span></h3>
        </div>
        <ul class="room-features">
          <li>床型：${escapeHtml(r.bed)}</li>
          <li>适合：${r.guests}+ 人</li>
          ${r.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
        </ul>
        <div class="room-foot">
          <div class="room-price">
            <span class="room-price-cur">📋</span>
            <span class="room-price-num">价格待公告</span>
          </div>
          <div class="room-actions">
            <button type="button" class="btn btn-ghost btn-small" data-action="detail" data-id="${r.id}">详情</button>
            <button type="button" class="btn btn-primary btn-small" data-action="book" data-id="${r.id}">▶ 意向登记</button>
          </div>
        </div>
      </article>
    `).join('');
    grid.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const room = ROOMS.find(x => x.id === id);
        if (!room) return;
        if (btn.dataset.action === 'detail') openRoomDetail(room);
        else openBookModal(room);
      });
    });
  }

  /* ---------- 5. 房型详情 Modal ---------- */
  const roomMask = $('#roomMask');
  const roomTitle = $('#roomTitle');
  const roomBody = $('#roomBody');
  const roomClose = $('#roomClose');
  function openRoomDetail(r) {
    roomTitle.textContent = `${r.icon} ${r.name}（${r.status}）`;
    roomBody.innerHTML = `
      <div class="rd-summary">
        <p class="rd-line"><b>床型：</b>${escapeHtml(r.bed)}</p>
        <p class="rd-line"><b>适合：</b>${r.guests}+ 人</p>
        <p class="rd-line"><b>景观：</b>${escapeHtml(r.view)}</p>
        <p class="rd-line"><b>价格：</b>待公告</p>
        <ul class="rd-features">
          ${r.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
        </ul>
        <p class="rd-note">房型草案。床型、家具、配置由市政厅与合作社讨论后定稿。</p>
        <div class="rd-cta">
          <button type="button" class="btn btn-primary" id="rdBook">▶ 意向登记</button>
        </div>
      </div>
    `;
    roomMask.style.display = '';
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const b = $('#rdBook');
      if (b) b.addEventListener('click', () => { closeRoomDetail(); openBookModal(r); });
    }, 0);
  }
  function closeRoomDetail() {
    if (!roomMask) return;
    roomMask.style.display = 'none';
    document.body.style.overflow = '';
  }
  if (roomClose) roomClose.addEventListener('click', closeRoomDetail);
  if (roomMask) roomMask.addEventListener('click', (e) => { if (e.target === roomMask) closeRoomDetail(); });

  /* ---------- 6. 预订 Modal（localStorage 持久化） ---------- */
  const bookMask = $('#bookMask');
  const bookTitle = $('#bookTitle');
  const bookSummary = $('#bookSummary');
  const bookIn = $('#bookIn');
  const bookOut = $('#bookOut');
  const bookName = $('#bookName');
  const bookContact = $('#bookContact');
  const bookGuests = $('#bookGuests');
  const bookBreakfast = $('#bookBreakfast');
  const bookNote = $('#bookNote');
  const bookNights = $('#bookNights');
  const bookTotal = $('#bookTotal');
  const bookMsg = $('#bookMsg');
  const bookClose = $('#bookClose');
  const bookCancel = $('#bookCancel');
  const bookForm = $('#bookForm');

  let bookRoom = null;

  function openBookModal(r) {
    if (!bookMask) return;
    bookRoom = r;
    bookTitle.textContent = `预订 · ${r.name}`;
    bookSummary.innerHTML = `
      <div>
        <b>${r.icon} ${r.name}</b><br/>
        <span style="font-size:12px;color:var(--c-stone-dark)">${r.bed} · ${r.guests}+ 人</span>
      </div>
    `;
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);
    bookIn.value = tomorrow.toISOString().slice(0, 10);
    bookOut.value = dayAfter.toISOString().slice(0, 10);
    bookMsg.textContent = '';
    updateBookTotal();
    bookMask.style.display = '';
    document.body.style.overflow = 'hidden';
    setTimeout(() => bookName.focus(), 50);
  }
  function closeBookModal() {
    if (!bookMask) return;
    bookMask.style.display = 'none';
    document.body.style.overflow = '';
  }
  function updateBookTotal() {
    if (!bookIn || !bookOut || !bookRoom) return;
    const inD = new Date(bookIn.value);
    const outD = new Date(bookOut.value);
    if (isNaN(inD) || isNaN(outD) || outD <= inD) {
      bookNights.textContent = '— 请选择有效日期';
      bookTotal.textContent = '';
      return;
    }
    const nights = Math.round((outD - inD) / 86400000);
    const persons = parseInt(bookGuests.value, 10) || 1;
    const wantBf = bookBreakfast && bookBreakfast.checked;
    bookNights.textContent = `${nights} 晚 · ${persons} 人${wantBf ? ' · 含早餐' : ''}`;
    bookTotal.textContent = '房费与早餐价格待市政厅公告';
  }
  if (bookIn) bookIn.addEventListener('change', updateBookTotal);
  if (bookOut) bookOut.addEventListener('change', updateBookTotal);
  if (bookGuests) bookGuests.addEventListener('input', updateBookTotal);
  if (bookBreakfast) bookBreakfast.addEventListener('change', updateBookTotal);
  if (bookClose) bookClose.addEventListener('click', closeBookModal);
  if (bookCancel) bookCancel.addEventListener('click', closeBookModal);
  if (bookMask) bookMask.addEventListener('click', (e) => { if (e.target === bookMask) closeBookModal(); });
  if (bookForm) {
    bookForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inD = new Date(bookIn.value);
      const outD = new Date(bookOut.value);
      if (isNaN(inD) || isNaN(outD) || outD <= inD) {
        bookMsg.textContent = '退房日期必须晚于入住日期';
        return;
      }
      const nights = Math.round((outD - inD) / 86400000);
      const name = bookName.value.trim();
      const contact = bookContact.value.trim();
      if (!name || !contact) {
        bookMsg.textContent = '请填写姓名和联系方式';
        return;
      }
      const note = bookNote.value.trim();
      const wantBreakfast = bookBreakfast && bookBreakfast.checked;
      const persons = parseInt(bookGuests.value, 10) || 1;
      const submitBtn = bookForm.querySelector('button[type="submit"]');
      const origText = submitBtn.textContent;
      submitBtn.textContent = '提交中...';
      submitBtn.disabled = true;
      bookMsg.textContent = '';
      try {
        // v18: 改用 server 端 /api/bookings (跨设备同步, admin 可见)
        const res = await fetch('/api/bookings', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: bookRoom.id,
            room_name: bookRoom.name,
            in_date: bookIn.value,
            out_date: bookOut.value,
            nights,
            persons,
            breakfast: wantBreakfast ? 1 : 0,
            name, contact, note
          })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          submitBtn.textContent = '✓ 已提交（跨设备同步, 管理员会确认）';
          submitBtn.style.background = 'var(--c-emerald)';
          bookForm.reset();
          setTimeout(() => closeBookModal(), 1500);
        } else if (res.status === 401) {
          bookMsg.textContent = '请先登录玩家账号再预订';
          submitBtn.textContent = origText;
          submitBtn.disabled = false;
          setTimeout(() => {
            closeBookModal();
            location.href = 'index.html?action=login&reason=' + encodeURIComponent('请先登录玩家账号再预订酒店');
          }, 1200);
        } else {
          bookMsg.textContent = '✗ ' + (data.error || '提交失败');
          submitBtn.textContent = origText;
          submitBtn.disabled = false;
        }
      } catch (err) {
        bookMsg.textContent = '提交失败：' + err.message;
        submitBtn.textContent = origText;
        submitBtn.disabled = false;
      }
    });
  }

  /* ---------- 7. 筛选器事件 ---------- */
  const fStatus = $('#fStatus');
  const fGuests = $('#fGuests');
  const fView = $('#fView');
  const fReset = $('#fReset');
  if (fStatus) fStatus.addEventListener('change', () => { filters.status = fStatus.value; renderRooms(); });
  if (fGuests) fGuests.addEventListener('change', () => { filters.guests = parseInt(fGuests.value, 10); renderRooms(); });
  if (fView) fView.addEventListener('change', () => { filters.view = fView.value; renderRooms(); });
  if (fReset) fReset.addEventListener('click', () => {
    filters.status = 'all'; filters.guests = 0; filters.view = 'all';
    fStatus.value = 'all'; fGuests.value = '0'; fView.value = 'all';
    renderRooms();
  });

  /* ---------- 8. 顶 nav 移动端 toggle ---------- */
  const navToggle = $('#navToggle');
  const navLinks = $('#navLinks');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
  }

  /* ---------- 9. 回顶 ---------- */
  const backTop = $('#backTop');
  if (backTop) {
    backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  /* ---------- 10. 首屏渲染 ---------- */
  renderRooms();
})();
