/* ============================================
   灯光市 v15 · 管理后台脚本（API 版 · 跨设备同步）
   - 所有数据走 /api/* 后端（D1 云数据库）
   - 跨设备/跨浏览器可见（cookie 鉴权）
   - 默认超级管理员：LycheeJin / DengGuangWhat20120619（首次 /api/init 时自动创建）
   ============================================ */
(function () {
  'use strict';

  /* ---------- 0. 工具 ---------- */
  const $  = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => Array.from((p || document).querySelectorAll(s));
  const escapeHtml = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmtTime = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  async function sha256(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const nowISO = () => new Date().toISOString();

  /* ---------- 0.5 真实后端 API（cookie 鉴权 · 跨设备同步） ---------- */
  let _me = null; // 当前登录管理员
  async function api(method, path, body) {
    const m = String(method || 'GET').toUpperCase();
    const opts = { method: m, credentials: 'include' };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data;
    try { data = await res.json(); } catch (e) { data = { ok: false, error: '非 JSON 响应' }; }
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data || {};
  }
  const GET    = (p)        => api('GET', p);
  const POST   = (p, b)     => api('POST', p, b);
  const PATCH  = (p, b)     => api('PATCH', p, b);
  const DELETE = (p)        => api('DELETE', p);
  const QS     = (params)   => '?' + Object.entries(params).filter(([_,v]) => v != null).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  function isSuper() { return _me && _me.role === 'super'; }

  /* ---------- 2. 视图切换 ---------- */
  const showView = name => {
    $('#view-login').style.display = (name === 'dash') ? 'none' : '';
    $('#view-dash').style.display  = (name === 'dash') ? '' : 'none';
  };

  /* ---------- 3. 启动：检查登录状态 ---------- */
  async function boot() {
    try {
      const data = await GET('/api/login');
      if (data.ok && data.user && data.role && data.role !== 'player') {
        _me = data.user;
        renderDash(data.user);
      } else {
        showView('login');
      }
    } catch (e) {
      console.error('启动失败：', e);
      showView('login');
    }
  }

  /* ---------- 4. 登录（按钮 click 触发，避免依赖 form submit 事件） ---------- */
  async function doLogin() {
    const u = $('#loginUser').value.trim();
    const p = $('#loginPass').value;
    const errEl = $('#loginError');
    errEl.textContent = '';
    if (!u || !p) { errEl.textContent = '请输入账号和密码'; return; }

    const submitBtn = $('#loginSubmitBtn');
    const origText = submitBtn ? submitBtn.textContent : '▶ 登录';
    if (submitBtn) { submitBtn.textContent = '验证中...'; submitBtn.disabled = true; }

    try {
      const data = await POST('/api/login', { username: u, password: p });
      if (!data.ok) throw new Error(data.error || '登录失败');
      if (data.role === 'player') throw new Error('这是玩家账号，请到首页登录');
      // 拿到 whoami 拿完整 admin 资料
      const me = await GET('/api/login');
      if (!me.ok) throw new Error('无法获取账号信息');
      _me = me.user;
      $('#loginUser').value = '';
      $('#loginPass').value = '';
      renderDash(me.user);
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      if (submitBtn) { submitBtn.textContent = origText; submitBtn.disabled = false; }
    }
  }
  // 暴露全局，供 admin.html 内联 onclick/onsubmit 触发（内嵌浏览器里 addEventListener 可能不触发，内联最稳）
  window.adminDoLogin = doLogin;

  /* 退登 */
  $('#btnLogout').addEventListener('click', async () => {
    if (!confirm('确认退出登录？')) return;
    try { await DELETE('/api/login'); } catch (e) {}
    _me = null;
    showView('login');
  });

  /* ---------- 5. 后台渲染 ---------- */
  function renderDash(admin) {
    window._currentAdmin = admin; // 缓存给 getSession() 用
    $('#userName').textContent = admin.username;
    const roleEl = $('#userRole');
    roleEl.textContent = admin.role === 'super' ? 'SUPER' : 'ADMIN';
    roleEl.className = 'role-tag role-' + admin.role;
    $('#btnAddAdmin').style.display = admin.role === 'super' ? '' : 'none';
    renderMessages();
    renderBookings();
    renderLicense();
    renderKarts();
    renderCircuits();
    renderAdminList();
    renderPlayers();
    showView('dash');
  }

  /* ---------- 6. Tab 切换 ---------- */
  $$('.admin-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tab;
      $$('.admin-tabs .tab').forEach(b => b.classList.toggle('active', b === btn));
      $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + t));
    });
  });

  /* ============================================
     Tab: 市民留言
     ============================================ */
  async function renderMessages() {
    try {
      const data = await GET('/api/admin/messages');
      const all = data.messages || [];
      const cAll = all.length;
      const cUnread = all.filter(m => m.status === 'new').length;
      const cRead = cAll - cUnread;
      $('#cntAll').textContent = cAll;
      $('#cntUnread').textContent = cUnread;
      $('#cntRead').textContent = cRead;
      $('#msgUnread').textContent = cUnread > 0 ? `(${cUnread})` : '';

      const filter = (document.querySelector('input[name="msgFilter"]:checked') || {}).value || 'all';
      let list = all;
      if (filter === 'unread') list = list.filter(m => m.status === 'new');
      if (filter === 'read')   list = list.filter(m => m.status !== 'new');

      const box = $('#msgList');
      const empty = $('#msgEmpty');
      if (list.length === 0) { box.innerHTML = ''; empty.style.display = ''; return; }
      empty.style.display = 'none';

      box.innerHTML = list.map(m => {
        const isRead = m.status !== 'new';
        const isDone = m.status === 'done';
        const hasReply = m.admin_reply && m.admin_reply.length > 0;
        return `
        <article class="msg-item ${isRead ? 'is-read' : ''}" data-id="${m.id}">
          <div class="msg-head">
            <div class="msg-head-left">
              <b class="msg-name">👤 ${escapeHtml(m.name)}${m.contact ? ' · ' + escapeHtml(m.contact) : ''}</b>
              ${m.player_username ? `<span class="msg-player-tag">@${escapeHtml(m.player_username)}</span>` : ''}
              ${isDone ? '<span class="msg-read-tag">已处理</span>' : isRead ? '<span class="msg-read-tag">已读</span>' : '<span class="msg-unread-tag">新</span>'}
              ${hasReply ? '<span class="msg-replied-tag" title="已回复玩家">💬 已回复</span>' : ''}
            </div>
            <div class="msg-time">${fmtTime(m.created_at)}</div>
          </div>
          <div class="msg-content">${escapeHtml(m.content)}</div>
          ${hasReply ? `
            <div class="msg-reply-box">
              <b>📣 市政厅回复：</b>
              <div>${escapeHtml(m.admin_reply)}</div>
              <small>回复于 ${fmtTime(m.replied_at)}</small>
            </div>
          ` : ''}
          <div class="msg-actions book-actions">
            <button class="btn btn-primary btn-sm" data-act="reply">${hasReply ? '✎ 编辑回复' : '💬 回复'}</button>
            ${isDone ? '' : `<button class="btn btn-ghost btn-sm" data-act="done">标为已处理</button>`}
            <button class="btn btn-ghost btn-sm" data-act="toggle">${isRead && !isDone ? '标为未读' : '标为已读'}</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
          </div>
        </article>
      `;}).join('');

      box.querySelectorAll('.msg-item').forEach(el => {
        const id = +el.dataset.id;
        const m  = list.find(x => x.id === id);
        el.querySelector('[data-act="toggle"]')?.addEventListener('click', () => toggleRead(id));
        el.querySelector('[data-act="done"]')?.addEventListener('click', () => markDone(id));
        el.querySelector('[data-act="del"]')?.addEventListener('click', () => deleteMessage(id));
        el.querySelector('[data-act="reply"]')?.addEventListener('click', () => openReplyModal(m));
      });
    } catch (e) {
      console.error('加载留言失败:', e);
    }
  }

  async function toggleRead(id) {
    try {
      const all = (await GET('/api/admin/messages')).messages || [];
      const m = all.find(x => x.id === id);
      if (!m) return;
      const newStatus = m.status === 'new' ? 'read' : 'new';
      await PATCH('/api/admin/messages?id=' + id + '&status=' + newStatus);
      renderMessages();
    } catch (e) { alert('操作失败：' + e.message); }
  }
  async function markDone(id) {
    try {
      await PATCH('/api/admin/messages?id=' + id + '&status=done');
      renderMessages();
    } catch (e) { alert('操作失败：' + e.message); }
  }
  async function deleteMessage(id) {
    if (!confirm('确认删除这条留言？')) return;
    try { await DELETE('/api/admin/messages?id=' + id); renderMessages(); }
    catch (e) { alert('删除失败：' + e.message); }
  }
  async function openReplyModal(m) {
    openModal(`回复市民留言 - #${m.id}`, `
      <div style="margin-bottom:12px;padding:10px 12px;background:var(--c-bg-2);border:2px solid var(--c-stone);font-size:13px">
        <b>${escapeHtml(m.name)} 说：</b>
        <div style="margin-top:6px;color:var(--c-stone-dark)">${escapeHtml(m.content)}</div>
      </div>
      <form id="replyForm" class="modal-form">
        <label><span>市政厅回复（2000 字以内）</span>
          <textarea id="replyText" rows="5" maxlength="2000" placeholder="正式回复这位市民...">${escapeHtml(m.admin_reply || '')}</textarea>
        </label>
        <div class="modal-msg" id="replyMsg"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="replyCancel">取消</button>
          ${m.admin_reply ? '<button type="button" class="btn btn-ghost btn-danger" id="replyClear">清除回复</button>' : ''}
          <button type="submit" class="btn btn-primary">💬 提交回复</button>
        </div>
      </form>
    `);
    $('#replyCancel').addEventListener('click', closeModal);
    if ($('#replyClear')) $('#replyClear').addEventListener('click', async () => {
      if (!confirm('确定要清除回复？')) return;
      try {
        await PATCH('/api/admin/messages?id=' + m.id, { admin_reply: '' });
        closeModal();
        renderMessages();
      } catch (e) { $('#replyMsg').textContent = e.message; }
    });
    $('#replyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = $('#replyMsg'); msgEl.textContent = '';
      const text = $('#replyText').value.trim();
      if (!text) { msgEl.textContent = '回复内容不能为空'; return; }
      if (text.length > 2000) { msgEl.textContent = '回复内容不能超过 2000 字符'; return; }
      try {
        await PATCH('/api/admin/messages?id=' + m.id, { admin_reply: text });
        closeModal();
        renderMessages();
      } catch (err) { msgEl.textContent = err.message; }
    });
  }
  $('#btnMarkAll').addEventListener('click', async () => {
    if (!confirm('将所有新留言标记为已读？')) return;
    try {
      const all = (await GET('/api/admin/messages')).messages || [];
      for (const m of all) {
        if (m.status === 'new') await PATCH('/api/admin/messages?id=' + m.id + '&status=read');
      }
      renderMessages();
    } catch (e) { alert('失败：' + e.message); }
  });
  $$('input[name="msgFilter"]').forEach(r => r.addEventListener('change', renderMessages));
  $('#msgTypeFilter').addEventListener('change', renderMessages);

  /* ============================================
     Tab: 酒店预订
     ============================================ */
  const BOOK_STATUS = {
    pending:    { label: '待处理',  cls: 'st-pending' },
    confirmed:  { label: '已确认',  cls: 'st-confirmed' },
    checked_in: { label: '已入住',  cls: 'st-checkin' },
    completed:  { label: '已完成',  cls: 'st-completed' },
    cancelled:  { label: '已取消',  cls: 'st-cancelled' }
  };

  async function renderBookings() {
    try {
      const data = await GET('/api/admin/bookings');
      const all = data.bookings || [];
      const cAll = all.length;
      const cPending = all.filter(b => b.status === 'pending').length;
      const cConfirmed = all.filter(b => b.status === 'confirmed').length;
      const cCompleted = all.filter(b => b.status === 'completed').length;
      $('#bookCntAll').textContent = cAll;
      $('#bookCntPending').textContent = cPending;
      $('#bookCntConfirmed').textContent = cConfirmed;
      $('#bookCntCompleted').textContent = cCompleted;
      $('#bookPending').textContent = cPending > 0 ? `(${cPending})` : '';

      const filter = (document.querySelector('input[name="bookFilter"]:checked') || {}).value || 'all';
      const roomId = $('#bookRoomFilter').value;
      let list = all;
      if (filter !== 'all') list = list.filter(b => b.status === filter);
      if (roomId) list = list.filter(b => b.room_id === roomId);

      const box = $('#bookList');
      const empty = $('#bookEmpty');
      if (list.length === 0) { box.innerHTML = ''; empty.style.display = ''; return; }
      empty.style.display = 'none';

      box.innerHTML = list.map(b => {
        const st = BOOK_STATUS[b.status] || BOOK_STATUS.pending;
        const statusOpts = Object.entries(BOOK_STATUS)
          .map(([k, v]) => `<option value="${k}" ${k === b.status ? 'selected' : ''}>${v.label}</option>`).join('');
        return `
          <article class="msg-item book-item" data-id="${b.id}">
            <div class="msg-head">
              <div class="msg-head-left">
                <span class="msg-type type-book">${escapeHtml(b.room_name || b.room_id)}</span>
                <b class="msg-name">👤 ${escapeHtml(b.name)} · ${escapeHtml(b.contact)}</b>
                ${b.player_username ? `<span class="msg-player-tag">@${escapeHtml(b.player_username)}</span>` : ''}
                <span class="book-status ${st.cls}">${st.label}</span>
              </div>
              <div class="msg-time">${fmtTime(b.created_at)}</div>
            </div>
            <div class="book-detail">
              <div>📅 ${escapeHtml(b.in_date)} → ${escapeHtml(b.out_date)}</div>
              <div>🌙 ${b.nights} 晚 · 👥 ${b.persons} 人${b.breakfast ? ' · 🍳 含早餐' : ''}</div>
              ${b.note ? `<div>📝 ${escapeHtml(b.note)}</div>` : ''}
            </div>
            <div class="msg-actions book-actions">
              <select class="book-status-sel">${statusOpts}</select>
              <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
            </div>
          </article>
        `;
      }).join('');

      box.querySelectorAll('.book-item').forEach(el => {
        const id = +el.dataset.id;
        el.querySelector('.book-status-sel').addEventListener('change', (e) => {
          updateBookingStatus(id, e.target.value);
        });
        el.querySelector('[data-act="del"]').addEventListener('click', () => deleteBooking(id));
      });
    } catch (e) {
      console.error('加载订单失败:', e);
    }
  }

  async function updateBookingStatus(id, status) {
    try { await PATCH('/api/admin/bookings?id=' + id + '&status=' + status); renderBookings(); }
    catch (e) { alert('更新失败：' + e.message); }
  }
  async function deleteBooking(id) {
    if (!confirm('确认删除该订单？')) return;
    try { await DELETE('/api/admin/bookings?id=' + id); renderBookings(); }
    catch (e) { alert('删除失败：' + e.message); }
  }
  $$('input[name="bookFilter"]').forEach(r => r.addEventListener('change', renderBookings));
  $('#bookRoomFilter').addEventListener('change', renderBookings);
  $('#btnBookClearDone').addEventListener('click', async () => {
    if (!confirm('清除已完成/已取消的订单？')) return;
    try {
      const all = (await GET('/api/admin/bookings')).bookings || [];
      for (const b of all) {
        if (b.status === 'completed' || b.status === 'cancelled') {
          await DELETE('/api/admin/bookings?id=' + b.id);
        }
      }
      renderBookings();
    } catch (e) { alert('失败：' + e.message); }
  });

  /* ============================================
     Tab: 卡丁车赛道报名
     ============================================ */
  const SIGNUP_STATUS = {
    pending:  { label: '待审核', cls: 'st-pending' },
    approved: { label: '已批准', cls: 'st-checkin' },
    rejected: { label: '已拒绝', cls: 'st-cancelled' }
  };

  async function renderKarts() {
    try {
      const data = await GET('/api/admin/kart');
      const all = data.signups || [];
      const cAll = all.length, cP = all.filter(x => x.status === 'pending').length;
      const cA = all.filter(x => x.status === 'approved').length, cR = all.filter(x => x.status === 'rejected').length;
      $('#kartCntAll').textContent = cAll;
      $('#kartCntPending').textContent = cP;
      $('#kartCntApproved').textContent = cA;
      $('#kartCntRejected').textContent = cR;
      $('#kartPending').textContent = cP > 0 ? `(${cP})` : '';

      const filter = (document.querySelector('input[name="kartFilter"]:checked') || {}).value || 'all';
      const session = $('#kartSessionFilter').value;
      let list = all;
      if (filter !== 'all') list = list.filter(x => x.status === filter);
      if (session) list = list.filter(x => x.session === session);

      const box = $('#kartList');
      const empty = $('#kartEmpty');
      if (list.length === 0) { box.innerHTML = ''; empty.style.display = ''; return; }
      empty.style.display = 'none';

      box.innerHTML = list.map(k => {
        const st = SIGNUP_STATUS[k.status] || SIGNUP_STATUS.pending;
        const statusOpts = Object.entries(SIGNUP_STATUS)
          .map(([v, info]) => `<option value="${v}" ${v === k.status ? 'selected' : ''}>${info.label}</option>`).join('');
        return `
          <article class="msg-item book-item" data-id="${escapeHtml(k.id)}">
            <div class="msg-head">
              <div class="msg-head-left">
                <span class="msg-type type-book">🏁 赛道报名</span>
                <b class="msg-name">👤 ${escapeHtml(k.name)} · ${escapeHtml(k.contact)}</b>
                <span class="book-status ${st.cls}">${st.label}</span>
                ${k.car ? `<span class="gallery-num">车号 #${escapeHtml(k.car)}</span>` : ''}
              </div>
              <div class="msg-time">${fmtTime(k.created_at)}</div>
            </div>
            <div class="book-detail">
              <div>📅 ${escapeHtml(k.session)}</div>
              ${k.note ? `<div>📝 ${escapeHtml(k.note)}</div>` : ''}
            </div>
            <div class="msg-actions book-actions">
              <select class="book-status-sel">${statusOpts}</select>
              <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
            </div>
          </article>
        `;
      }).join('');

      box.querySelectorAll('.book-item').forEach(el => {
        const id = el.dataset.id;
        el.querySelector('.book-status-sel').addEventListener('change', (e) => updateKartStatus(id, e.target.value));
        el.querySelector('[data-act="del"]').addEventListener('click', () => deleteKart(id));
      });
    } catch (e) { console.error('加载失败:', e); }
  }

  async function updateKartStatus(id, status) {
    try { await PATCH('/api/admin/kart?id=' + id, { status }); renderKarts(); }
    catch (e) { alert('更新失败：' + e.message); }
  }
  async function deleteKart(id) {
    if (!confirm('确认删除该报名？')) return;
    try { await DELETE('/api/admin/kart?id=' + id); renderKarts(); }
    catch (e) { alert('删除失败：' + e.message); }
  }
  $$('input[name="kartFilter"]').forEach(r => r.addEventListener('change', renderKarts));
  $('#kartSessionFilter').addEventListener('change', renderKarts);
  $('#btnKartClearDone').addEventListener('click', async () => {
    if (!confirm('清除已处理报名？')) return;
    try {
      const all = (await GET('/api/admin/kart')).signups || [];
      for (const x of all) {
        if (x.status === 'approved' || x.status === 'rejected') await DELETE('/api/admin/kart?id=' + x.id);
      }
      renderKarts();
    } catch (e) { alert('失败：' + e.message); }
  });

  /* ============================================
     Tab: 国际赛车场
     ============================================ */
  async function renderCircuits() {
    try {
      const data = await GET('/api/admin/circuit');
      const all = data.signups || [];
      const cAll = all.length, cP = all.filter(x => x.status === 'pending').length;
      const cA = all.filter(x => x.status === 'approved').length, cR = all.filter(x => x.status === 'rejected').length;
      $('#circuitCntAll').textContent = cAll;
      $('#circuitCntPending').textContent = cP;
      $('#circuitCntApproved').textContent = cA;
      $('#circuitCntRejected').textContent = cR;
      $('#circuitPending').textContent = cP > 0 ? `(${cP})` : '';

      const filter = (document.querySelector('input[name="circuitFilter"]:checked') || {}).value || 'all';
      const session = $('#circuitSessionFilter').value;
      const license = $('#circuitLicenseFilter').value;
      let list = all;
      if (filter !== 'all') list = list.filter(x => x.status === filter);
      if (session) list = list.filter(x => x.session === session);
      if (license) list = list.filter(x => x.license === license);

      const box = $('#circuitList');
      const empty = $('#circuitEmpty');
      if (list.length === 0) { box.innerHTML = ''; empty.style.display = ''; return; }
      empty.style.display = 'none';

      box.innerHTML = list.map(c => {
        const st = SIGNUP_STATUS[c.status] || SIGNUP_STATUS.pending;
        const statusOpts = Object.entries(SIGNUP_STATUS)
          .map(([v, info]) => `<option value="${v}" ${v === c.status ? 'selected' : ''}>${info.label}</option>`).join('');
        return `
          <article class="msg-item book-item" data-id="${escapeHtml(c.id)}">
            <div class="msg-head">
              <div class="msg-head-left">
                <span class="msg-type type-book">🏎️ 国际赛车场</span>
                <b class="msg-name">👤 ${escapeHtml(c.name)} · ${escapeHtml(c.contact)}</b>
                <span class="book-status ${st.cls}">${st.label}</span>
                <span class="gallery-num">${escapeHtml(c.license || '—')}</span>
                ${c.car ? `<span class="gallery-num">车号 #${escapeHtml(c.car)}</span>` : ''}
              </div>
              <div class="msg-time">${fmtTime(c.created_at)}</div>
            </div>
            <div class="book-detail">
              <div>📅 ${escapeHtml(c.session)}</div>
              ${c.note ? `<div>📝 ${escapeHtml(c.note)}</div>` : ''}
            </div>
            <div class="msg-actions book-actions">
              <select class="book-status-sel">${statusOpts}</select>
              <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
            </div>
          </article>
        `;
      }).join('');

      box.querySelectorAll('.book-item').forEach(el => {
        const id = el.dataset.id;
        el.querySelector('.book-status-sel').addEventListener('change', (e) => updateCircuitStatus(id, e.target.value));
        el.querySelector('[data-act="del"]').addEventListener('click', () => deleteCircuit(id));
      });
    } catch (e) { console.error('加载失败:', e); }
  }

  async function updateCircuitStatus(id, status) {
    try { await PATCH('/api/admin/circuit?id=' + id, { status }); renderCircuits(); }
    catch (e) { alert('更新失败：' + e.message); }
  }
  async function deleteCircuit(id) {
    if (!confirm('确认删除该报名？')) return;
    try { await DELETE('/api/admin/circuit?id=' + id); renderCircuits(); }
    catch (e) { alert('删除失败：' + e.message); }
  }
  $$('input[name="circuitFilter"]').forEach(r => r.addEventListener('change', renderCircuits));
  $('#circuitSessionFilter').addEventListener('change', renderCircuits);
  $('#circuitLicenseFilter').addEventListener('change', renderCircuits);
  $('#btnCircuitClearDone').addEventListener('click', async () => {
    if (!confirm('清除已处理报名？')) return;
    try {
      const all = (await GET('/api/admin/circuit')).signups || [];
      for (const x of all) {
        if (x.status === 'approved' || x.status === 'rejected') await DELETE('/api/admin/circuit?id=' + x.id);
      }
      renderCircuits();
    } catch (e) { alert('失败：' + e.message); }
  });

  /* ============================================
     Tab: 管理员账号
     ============================================ */
  async function renderAdminList() {
    try {
      const data = await GET('/api/admin/admins');
      const list = data.admins || [];
      const s = getSession();
      if (!s) return;
      const me = s.username;
      $('#adminList').innerHTML = list.map(a => {
        const isMe = a.username === me;
        const canDel = s.role === 'super' && !isMe;
        return `
          <article class="admin-item" data-id="${escapeHtml(a.id)}">
            <div class="admin-avatar">${a.role === 'super' ? '🛡️' : '👤'}</div>
            <div class="admin-meta">
              <b>${escapeHtml(a.username)} ${isMe ? '<span class="me-tag">我</span>' : ''}</b>
              <span class="role-tag role-${a.role}">${a.role === 'super' ? 'SUPER' : 'ADMIN'}</span>
              <div class="admin-sub">创建于 ${fmtTime(a.created_at)} · 由 ${escapeHtml(a.created_by || '—')} 创建</div>
            </div>
            <div class="admin-actions">
              ${s.role === 'super' ? `<button class="btn btn-ghost btn-sm" data-act="reset">${isMe ? '修改密码' : '重置密码'}</button>` : ''}
              ${canDel ? '<button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>' : ''}
            </div>
          </article>
        `;
      }).join('');

      $$('#adminList .admin-item').forEach(el => {
        const id = el.dataset.id;
        el.querySelector('[data-act="reset"]')?.addEventListener('click', () => openResetPwdModal(id));
        el.querySelector('[data-act="del"]')?.addEventListener('click', () => deleteAdmin(id));
      });
    } catch (e) {
      if (e.status === 403) {
        // 非 super 角色，无权获取
        $('#adminList').innerHTML = '<p class="login-hint" style="text-align:center;color:var(--c-stone-dark)">仅 super 可查看完整管理员列表</p>';
      } else {
        console.error('加载管理员失败:', e);
      }
    }
  }

  async function deleteAdmin(id) {
    if (!confirm('确认删除该管理员？此操作不可恢复。')) return;
    try { await DELETE('/api/admin/admins?id=' + id); renderAdminList(); }
    catch (e) { alert('删除失败：' + e.message); }
  }

  /* ---------- 添加管理员 ---------- */
  $('#btnAddAdmin').addEventListener('click', () => {
    openModal('添加管理员', `
      <form id="addForm" class="modal-form">
        <label><span>用户名（3-20 位字母/数字/下划线）</span>
          <input type="text" id="addUser" required pattern="[A-Za-z0-9_]{3,20}" />
        </label>
        <label><span>密码（至少 8 位）</span>
          <input type="password" id="addPass" required minlength="8" />
        </label>
        <label><span>角色</span>
          <select id="addRole">
            <option value="admin">ADMIN（普通管理员）</option>
            <option value="super">SUPER（超级管理员）</option>
          </select>
        </label>
        <div class="modal-msg" id="addMsg"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="addCancel">取消</button>
          <button type="submit" class="btn btn-primary">▶ 创建</button>
        </div>
      </form>
    `);
    $('#addCancel').addEventListener('click', closeModal);
    $('#addForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#addUser').value.trim();
      const password = $('#addPass').value;
      const role = $('#addRole').value;
      const msgEl = $('#addMsg');
      msgEl.textContent = '';
      try {
        const data = await POST('/api/admin/admins', { username, password, role });
        if (!data.ok) throw new Error(data.error || '创建失败');
        closeModal();
        renderAdminList();
      } catch (err) {
        msgEl.textContent = err.message;
      }
    });
  });

  /* ---------- 重置密码 ---------- */
  function openResetPwdModal(id) {
    const s = getSession();
    if (!s) return;
    if (s.role !== 'super') { alert('仅超级管理员可重置他人密码'); return; }
    openModal(`重置密码`, `
      <form id="resetForm" class="modal-form">
        <label><span>新密码（至少 8 位）</span>
          <input type="password" id="rstNew" required minlength="8" />
        </label>
        <label><span>确认新密码</span>
          <input type="password" id="rstNew2" required minlength="8" />
        </label>
        <div class="modal-msg" id="rstMsg"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="rstCancel">取消</button>
          <button type="submit" class="btn btn-primary">▶ 保存</button>
        </div>
      </form>
    `);
    $('#rstCancel').addEventListener('click', closeModal);
    $('#resetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = $('#rstMsg'); msgEl.textContent = '';
      const np = $('#rstNew').value;
      const np2 = $('#rstNew2').value;
      if (np.length < 8) { msgEl.textContent = '新密码至少 8 位'; return; }
      if (np !== np2) { msgEl.textContent = '两次输入的新密码不一致'; return; }
      try {
        await PATCH('/api/admin/admins?id=' + id, { new_password: np });
        closeModal();
      } catch (err) { msgEl.textContent = err.message; }
    });
  }

  /* ============================================
     Tab: 修改我的密码（独立表单）
     ============================================ */
  $('#pwdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = getSession();
    if (!s) return;
    const np = $('#pwdNew').value;
    const np2 = $('#pwdNew2').value;
    const cur = $('#pwdOld').value;
    const msgEl = $('#pwdMsg');
    msgEl.className = 'pwd-msg'; msgEl.textContent = '';
    if (np.length < 8) { msgEl.classList.add('err'); msgEl.textContent = '新密码至少 8 位'; return; }
    if (np !== np2) { msgEl.classList.add('err'); msgEl.textContent = '两次输入的新密码不一致'; return; }
    try {
      // 用当前密码登录一次获取 token（如果还没有）
      await POST('/api/admin/change-password', { username: s.username, password: cur });
      await PATCH('/api/admin/admins?id=' + s.id, { new_password: np });
      msgEl.classList.add('ok'); msgEl.textContent = '✓ 密码已更新（请记住新密码）';
      $('#pwdForm').reset();
    } catch (err) {
      msgEl.classList.add('err');
      msgEl.textContent = '更新失败：' + (err.message.includes('密码') ? '当前密码错误' : err.message);
    }
  });

  /* ============================================
     Tab: 驾照考试（v16.2）
     ============================================ */
  let _licenseCache = [];
  const EXAM_LABELS = { written: 'B 级笔试', road: 'A 级路考', upgrade: 'S 级升级' };
  async function renderLicense() {
    try {
      const data = await GET('/api/admin/license');
      _licenseCache = data.signups || [];
    } catch (e) { _licenseCache = []; console.error(e); }
    const cP = _licenseCache.filter(x => x.status === 'pending').length;
    const cPa = _licenseCache.filter(x => x.status === 'passed').length;
    const cF = _licenseCache.filter(x => x.status === 'failed').length;
    const cA = _licenseCache.length;
    $('#cntLicPending').textContent  = cP;
    $('#cntLicPassed').textContent   = cPa;
    $('#cntLicFailed').textContent   = cF;
    $('#cntLicAll').textContent      = cA;
    $('#licensePending').textContent = cP > 0 ? `(${cP})` : '';

    const filter = (document.querySelector('input[name="licenseFilter"]:checked') || {}).value || 'pending';
    let list = _licenseCache;
    if (filter !== 'all') list = list.filter(x => x.status === filter);

    const box = $('#licenseList');
    const empty = $('#licenseEmpty');
    if (list.length === 0) { box.innerHTML = ''; empty.style.display = ''; return; }
    empty.style.display = 'none';

    const statusBadge = {
      pending: '<span class="msg-unread-tag">待审</span>',
      passed:  '<span class="msg-read-tag" style="background:#5fb14f;color:#fff">✓ 通过</span>',
      failed:  '<span class="msg-read-tag" style="background:#d33;color:#fff">✗ 未通过</span>'
    };
    box.innerHTML = list.map(x => `
      <article class="msg-item" data-id="${x.id}">
        <div class="msg-head">
          <div class="msg-head-left">
            <b class="msg-name">${escapeHtml(x.player_username || '?')}</b>
            <span style="color:var(--c-stone-dark);font-size:12px;margin-left:6px">${escapeHtml(x.contact || '')}</span>
            <span class="msg-player-tag">${EXAM_LABELS[x.exam_type] || x.exam_type}</span>
            ${statusBadge[x.status] || ''}
          </div>
          <div class="msg-time">${fmtTime(x.created_at)}</div>
        </div>
        <div class="msg-content">
          ${x.exam_date ? `📅 期望日期: ${escapeHtml(x.exam_date)} ${x.exam_session ? '· ' + escapeHtml(x.exam_session) : ''}` : '未指定日期'}
          ${x.note ? `<br><small style="color:var(--c-stone-dark)">📝 ${escapeHtml(x.note)}</small>` : ''}
          ${x.result_note ? `<br><div class="msg-reply-box"><b>📋 评语：</b>${escapeHtml(x.result_note)}${x.reviewer ? ' <small>(by ' + escapeHtml(x.reviewer) + ')</small>' : ''}</div>` : ''}
        </div>
        <div class="msg-actions book-actions">
          ${x.status === 'pending' ? `
            <button class="btn btn-primary btn-sm" data-act="pass">✓ 通过</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-act="fail">✗ 不通过</button>
          ` : '<span style="color:var(--c-stone-dark);font-size:12px">' + (x.reviewer ? 'by ' + escapeHtml(x.reviewer) : '') + '</span>'}
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>
    `).join('');

    box.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => handleLicenseAction(parseInt(btn.closest('.msg-item').dataset.id, 10), btn.dataset.act));
    });
  }
  async function handleLicenseAction(id, action) {
    try {
      if (action === 'pass' || action === 'fail') {
        const note = prompt(action === 'pass' ? '可选：评语 / 通过备注' : '原因说明（玩家可见）') || '';
        await PATCH(`/api/admin/license?id=${id}`, { result: action, result_note: note });
      } else if (action === 'del') {
        if (!confirm('删除这条报名？')) return;
        await DELETE(`/api/admin/license?id=${id}`);
      }
      await renderLicense();
    } catch (e) { alert('操作失败：' + e.message); }
  }
  document.querySelectorAll('input[name="licenseFilter"]').forEach(r => {
    r.addEventListener('change', renderLicense);
  });
  const btnLRefresh = document.getElementById('btnLicenseRefresh');
  if (btnLRefresh) btnLRefresh.addEventListener('click', renderLicense);

  /* ============================================
     Session 缓存（仅用于 UI 显示当前用户）
     - 由 renderDash() 在登录成功时设置，避免异步竞态
     ============================================ */
  function getSession() {
    return window._currentAdmin || null;
  }

  /* ============================================
     Tab: 玩家管理（v16 注册审批 + 重置密码）
     ============================================ */
  let _playerCache = [];

  async function renderPlayers() {
    try {
      const data = await GET('/api/admin/players');
      _playerCache = data.players || [];
    } catch (e) {
      _playerCache = [];
      console.error('加载玩家列表失败：', e);
    }
    // 计数
    const cP = _playerCache.filter(p => p.status === 'pending').length;
    const cA = _playerCache.filter(p => p.status === 'active').length;
    const cR = _playerCache.filter(p => p.status === 'rejected').length;
    const cAll = _playerCache.length;
    $('#cntPlayerPending').textContent  = cP;
    $('#cntPlayerActive').textContent   = cA;
    $('#cntPlayerRejected').textContent = cR;
    $('#cntPlayerAll').textContent      = cAll;
    $('#playerPending').textContent     = cP > 0 ? `(${cP})` : '';

    const filter = (document.querySelector('input[name="playerFilter"]:checked') || {}).value || 'pending';
    let list = _playerCache;
    if (filter !== 'all') list = list.filter(p => p.status === filter);

    const box = $('#playerList');
    const empty = $('#playerEmpty');
    if (list.length === 0) { box.innerHTML = ''; empty.style.display = ''; return; }
    empty.style.display = 'none';

    const statusBadge = {
      pending:  '<span class="msg-unread-tag">待审批</span>',
      active:   '<span class="msg-read-tag">已激活</span>',
      rejected: '<span class="msg-read-tag" style="background:#d33">已拒绝</span>'
    };
    box.innerHTML = list.map(p => `
      <article class="msg-item" data-id="${p.id}" data-status="${p.status}">
        <div class="msg-head">
          <div class="msg-head-left">
            <b class="msg-name">${escapeHtml(p.avatar_emoji || '👤')} ${escapeHtml(p.username)}</b>
            <span style="color:var(--c-stone-dark);font-size:12px;margin-left:6px">${escapeHtml(p.email)}</span>
            ${statusBadge[p.status] || ''}
          </div>
          <div class="msg-time">${fmtTime(p.created_at)}</div>
        </div>
        <p class="msg-content" style="font-size:13px;color:var(--c-stone-dark);margin:6px 0 8px">
          游戏ID = <b>${escapeHtml(p.username)}</b>${p.bio ? ' · ' + escapeHtml(p.bio) : ''}
        </p>
        <div class="msg-actions">
          ${p.status === 'pending' ? `
            <button class="btn btn-primary btn-sm" data-act="approve">✓ 批准</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-act="reject">✗ 拒绝</button>
          ` : ''}
          ${p.status !== 'pending' ? `
            <button class="btn btn-ghost btn-sm" data-act="reset-pw">🔑 重置密码</button>
            ${p.status === 'rejected' ? `<button class="btn btn-ghost btn-sm" data-act="re-approve">↻ 改为批准</button>` : ''}
            ${p.status === 'active' ? `<button class="btn btn-ghost btn-sm btn-danger" data-act="reject">✗ 改为拒绝</button>` : ''}
          `}
        </div>
      </article>
    `).join('');

    box.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => handlePlayerAction(parseInt(btn.closest('.msg-item').dataset.id, 10), btn.dataset.act));
    });
  }

  async function handlePlayerAction(id, action) {
    try {
      if (action === 'approve' || action === 're-approve') {
        if (!confirm('确认批准该玩家注册？批准后他/她可以登录。')) return;
        await PATCH(`/api/admin/players?id=${id}&action=approve`);
      } else if (action === 'reject') {
        if (!confirm('确认拒绝该玩家注册？')) return;
        await PATCH(`/api/admin/players?id=${id}&action=reject`);
      } else if (action === 'reset-pw') {
        openPlayerResetPwdModal(id);
        return;
      } else {
        return;
      }
      await renderPlayers();
    } catch (e) {
      alert('操作失败：' + e.message);
    }
  }

  function openPlayerResetPwdModal(id) {
    const player = _playerCache.find(p => p.id === id);
    if (!player) return;
    const sess = getSession();
    if (!sess || sess.role !== 'super') { alert('仅超级管理员可重置玩家密码'); return; }
    openModal(`重置玩家密码 - ${player.username}`, `
      <form id="pResetForm" class="modal-form">
        <p style="color:var(--c-stone-dark);font-size:13px;margin:0 0 10px">把 <b>${escapeHtml(player.username)}</b>（${escapeHtml(player.email)}）的密码改为：</p>
        <label><span>新密码（至少 8 位）</span>
          <input type="password" id="pRstNew" required minlength="8" />
        </label>
        <label><span>确认新密码</span>
          <input type="password" id="pRstNew2" required minlength="8" />
        </label>
        <div class="modal-msg" id="pRstMsg"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="pRstCancel">取消</button>
          <button type="submit" class="btn btn-primary">▶ 重置</button>
        </div>
      </form>
    `);
    $('#pRstCancel').addEventListener('click', closeModal);
    $('#pResetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = $('#pRstMsg'); msgEl.textContent = '';
      const np  = $('#pRstNew').value;
      const np2 = $('#pRstNew2').value;
      if (np.length < 8)  { msgEl.textContent = '新密码至少 8 位'; return; }
      if (np !== np2)     { msgEl.textContent = '两次输入的新密码不一致'; return; }
      try {
        await PATCH(`/api/admin/players?id=${id}&action=reset`, { new_password: np });
        closeModal();
        await renderPlayers();
      } catch (err) { msgEl.textContent = err.message; }
    });
  }

  // 玩家管理：filter 切换 / 刷新
  document.querySelectorAll('input[name="playerFilter"]').forEach(r => {
    r.addEventListener('change', renderPlayers);
  });
  const btnPRefresh = document.getElementById('btnPlayerRefresh');
  if (btnPRefresh) btnPRefresh.addEventListener('click', renderPlayers);

  /* ============================================
     Modal
     ============================================ */
  function openModal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modalMask').style.display = '';
  }
  function closeModal() { $('#modalMask').style.display = 'none'; }
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalMask').addEventListener('click', e => { if (e.target.id === 'modalMask') closeModal(); });

  /* 启动 */
  boot();
})();
