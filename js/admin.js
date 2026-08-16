/* ============================================
   灯光市 v14 · 管理后台脚本（localStorage 版）
   - 账号/留言/订单/报名 全部走 localStorage（不跨设备）
   - 同一浏览器跨标签页可见
   - 默认超级管理员：LycheeJin / DengGuangWhat20120619（首次访问自动创建）
   - 密码哈希:Web Crypto SHA-256 + per-user salt（基础防护,防明文存）
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

  /* ---------- 0.5 localStorage 存储层 ---------- */
  const LS_KEYS = {
    admins:    'lc_admins_v14',
    sessions:  'lc_sessions_v14',
    messages:  'lc_messages_v14',
    bookings:  'lc_bookings_v14',
    kart:      'lc_kart_v14',
    circuit:   'lc_circuit_v14',
    sessToken: 'lc_session_token_v14'
  };
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
  function save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

  // 首次启动:创建默认超级管理员
  (function bootstrapAdmin() {
    const list = load(LS_KEYS.admins);
    if (list.length === 0) {
      const salt = uid();
      // 异步触发;不 await 也不阻塞 UI（登录时会重新计算）
      sha256('DengGuangWhat20120619').then(hash => {
        list.push({
          id: uid(),
          username: 'LycheeJin',
          password_hash: hash,
          salt: salt,
          role: 'super',
          created_at: nowISO(),
          created_by: 'system'
        });
        save(LS_KEYS.admins, list);
      });
    }
  })();

  /* ---------- 1. API 模拟层（把 fetch 换成 localStorage） ---------- */
  function getSessionAdmin() {
    const tok = localStorage.getItem(LS_KEYS.sessToken);
    if (!tok) return null;
    const sessions = load(LS_KEYS.sessions);
    const sess = sessions.find(s => s.token === tok);
    if (!sess) return null;
    if (sess.expires < Date.now()) return null;
    const admins = load(LS_KEYS.admins);
    return admins.find(a => a.id === sess.admin_id) || null;
  }
  function isSuper() { const a = getSessionAdmin(); return a && a.role === 'super'; }

  // 异步等一下 bootstrap（让首次访问可以登录）
  let _bootReady = null;
  function waitBoot() {
    if (_bootReady) return _bootReady;
    _bootReady = new Promise(resolve => {
      const check = () => {
        const list = load(LS_KEYS.admins);
        if (list.length > 0) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
    return _bootReady;
  }

  async function api(method, path, body) {
    await waitBoot();
    const m = String(method || 'GET').toUpperCase();
    const segs = String(path).split('?')[0].split('/').filter(Boolean);
    // ['', 'api', resource, id?]
    const resource = segs[1];
    const id = segs[2] || null;

    // --- /api/init ---
    if (resource === 'init') {
      return { ok: true, message: 'localStorage 模式,无需 init' };
    }

    // --- /api/auth/me ---
    if (resource === 'auth' && segs[2] === 'me' && m === 'GET') {
      const a = getSessionAdmin();
      return a ? { ok: true, admin: publicAdmin(a) } : { ok: false, error: '未登录' };
    }

    // --- /api/auth/login ---
    if (resource === 'auth' && segs[2] === 'login' && m === 'POST') {
      const { username, password } = body || {};
      const admins = load(LS_KEYS.admins);
      const a = admins.find(x => x.username === username);
      if (!a) throw new Error('用户名或密码错误');
      const hash = await sha256(password);
      if (hash !== a.password_hash) throw new Error('用户名或密码错误');
      const token = uid() + uid();
      const sessions = load(LS_KEYS.sessions);
      sessions.push({ token, admin_id: a.id, expires: Date.now() + 8 * 3600 * 1000 });
      save(LS_KEYS.sessions, sessions);
      localStorage.setItem(LS_KEYS.sessToken, token);
      return { ok: true, admin: publicAdmin(a) };
    }

    // --- /api/auth/logout ---
    if (resource === 'auth' && segs[2] === 'logout' && m === 'POST') {
      const tok = localStorage.getItem(LS_KEYS.sessToken);
      if (tok) {
        let sessions = load(LS_KEYS.sessions);
        sessions = sessions.filter(s => s.token !== tok);
        save(LS_KEYS.sessions, sessions);
        localStorage.removeItem(LS_KEYS.sessToken);
      }
      return { ok: true };
    }

    // 鉴权
    const me = getSessionAdmin();
    if (!me) throw new Error('未登录或会话已过期');

    // --- messages ---
    if (resource === 'messages') {
      const arr = load(LS_KEYS.messages);
      if (!id) {
        if (m === 'GET')  return { ok: true, messages: arr };
        if (m === 'POST') {
          const item = { id: uid(), name: body.name || '', contact: body.contact || '',
            type: body.type || '其他', content: body.content || '', read: 0, created_at: nowISO() };
          arr.unshift(item); save(LS_KEYS.messages, arr);
          return { ok: true, id: item.id };
        }
      } else {
        if (m === 'PATCH')  { const i = arr.findIndex(x => x.id === id); if (i < 0) throw new Error('不存在'); arr[i] = Object.assign(arr[i], body); save(LS_KEYS.messages, arr); return { ok: true }; }
        if (m === 'DELETE') { const i = arr.findIndex(x => x.id === id); if (i < 0) throw new Error('不存在'); arr.splice(i, 1); save(LS_KEYS.messages, arr); return { ok: true }; }
      }
    }

    // --- bookings ---
    if (resource === 'bookings') {
      const arr = load(LS_KEYS.bookings);
      if (!id) {
        if (m === 'GET')  return { ok: true, bookings: arr };
        if (m === 'POST') {
          const item = Object.assign({ id: uid(), status: 'pending', created_at: nowISO() }, body || {});
          arr.unshift(item); save(LS_KEYS.bookings, arr);
          return { ok: true, id: item.id };
        }
      } else {
        if (m === 'PATCH')  { const i = arr.findIndex(x => x.id === id); if (i < 0) throw new Error('不存在'); arr[i] = Object.assign(arr[i], body); save(LS_KEYS.bookings, arr); return { ok: true }; }
        if (m === 'DELETE') { const i = arr.findIndex(x => x.id === id); if (i < 0) throw new Error('不存在'); arr.splice(i, 1); save(LS_KEYS.bookings, arr); return { ok: true }; }
      }
    }

    // --- kart ---
    if (resource === 'kart') {
      const arr = load(LS_KEYS.kart);
      if (!id) {
        if (m === 'GET')  return { ok: true, signups: arr };
        if (m === 'POST') {
          const item = Object.assign({ id: uid(), status: 'pending', created_at: nowISO() }, body || {});
          arr.unshift(item); save(LS_KEYS.kart, arr);
          return { ok: true, id: item.id };
        }
      } else {
        if (m === 'PATCH')  { const i = arr.findIndex(x => x.id === id); if (i < 0) throw new Error('不存在'); arr[i] = Object.assign(arr[i], body); save(LS_KEYS.kart, arr); return { ok: true }; }
        if (m === 'DELETE') { const i = arr.findIndex(x => x.id === id); if (i < 0) throw new Error('不存在'); arr.splice(i, 1); save(LS_KEYS.kart, arr); return { ok: true }; }
      }
    }

    // --- circuit ---
    if (resource === 'circuit') {
      const arr = load(LS_KEYS.circuit);
      if (!id) {
        if (m === 'GET')  return { ok: true, signups: arr };
        if (m === 'POST') {
          const item = Object.assign({ id: uid(), status: 'pending', created_at: nowISO() }, body || {});
          arr.unshift(item); save(LS_KEYS.circuit, arr);
          return { ok: true, id: item.id };
        }
      } else {
        if (m === 'PATCH')  { const i = arr.findIndex(x => x.id === id); if (i < 0) throw new Error('不存在'); arr[i] = Object.assign(arr[i], body); save(LS_KEYS.circuit, arr); return { ok: true }; }
        if (m === 'DELETE') { const i = arr.findIndex(x => x.id === id); if (i < 0) throw new Error('不存在'); arr.splice(i, 1); save(LS_KEYS.circuit, arr); return { ok: true }; }
      }
    }

    // --- admins (仅 super) ---
    if (resource === 'admins') {
      if (!isSuper()) throw new Error('需要超级管理员权限');
      const arr = load(LS_KEYS.admins);
      if (!id) {
        if (m === 'GET')  return { ok: true, admins: arr.map(publicAdmin) };
        if (m === 'POST') {
          if (arr.some(x => x.username === body.username)) throw new Error('用户名已存在');
          const hash = await sha256(body.password);
          const item = { id: uid(), username: body.username, password_hash: hash, salt: uid(), role: body.role || 'admin', created_at: nowISO(), created_by: me.username };
          arr.push(item); save(LS_KEYS.admins, arr);
          return { ok: true, id: item.id };
        }
      } else {
        const i = arr.findIndex(x => x.id === id);
        if (i < 0) throw new Error('管理员不存在');
        if (m === 'PATCH') {
          if (body.new_password) {
            arr[i].password_hash = await sha256(body.new_password);
            arr[i].salt = uid();
          }
          if (body.role && body.role !== arr[i].role) arr[i].role = body.role;
          save(LS_KEYS.admins, arr);
          return { ok: true };
        }
        if (m === 'DELETE') {
          if (arr[i].id === me.id) throw new Error('不能删除自己');
          if (arr[i].role === 'super') {
            const others = arr.filter(x => x.role === 'super');
            if (others.length <= 1) throw new Error('不能删除最后一个超级管理员');
          }
          arr.splice(i, 1); save(LS_KEYS.admins, arr);
          return { ok: true };
        }
      }
    }

    throw new Error('API 路径未实现: ' + path);
  }
  function publicAdmin(a) {
    return { id: a.id, username: a.username, role: a.role, created_at: a.created_at, created_by: a.created_by };
  }
  const GET    = (p)      => api('GET', p);
  const POST   = (p, b)   => api('POST', p, b);
  const PATCH  = (p, b)   => api('PATCH', p, b);
  const DELETE = (p)      => api('DELETE', p);

  /* ---------- 2. 视图切换 ---------- */
  const showView = name => {
    $('#view-login').style.display = (name === 'dash') ? 'none' : '';
    $('#view-dash').style.display  = (name === 'dash') ? '' : 'none';
  };

  /* ---------- 3. 启动：检查登录状态 ---------- */
  async function boot() {
    try {
      const data = await GET('/api/auth/me');
      if (data.ok && data.admin) {
        renderDash(data.admin);
      } else {
        showView('login');
      }
    } catch (e) {
      console.error('启动失败：', e);
      showView('login');
    }
  }

  /* ---------- 4. 登录 ---------- */
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = $('#loginUser').value.trim();
    const p = $('#loginPass').value;
    const errEl = $('#loginError');
    errEl.textContent = '';
    if (!u || !p) { errEl.textContent = '请输入账号和密码'; return; }

    const submitBtn = $('#loginForm button[type="submit"]');
    const origText = submitBtn.textContent;
    submitBtn.textContent = '验证中...';
    submitBtn.disabled = true;

    try {
      const data = await POST('/api/auth/login', { username: u, password: p });
      if (!data.ok) throw new Error(data.error || '登录失败');
      $('#loginUser').value = '';
      $('#loginPass').value = '';
      renderDash(data.admin);
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      submitBtn.textContent = origText;
      submitBtn.disabled = false;
    }
  });

  /* 退登 */
  $('#btnLogout').addEventListener('click', async () => {
    if (!confirm('确认退出登录？')) return;
    try { await POST('/api/auth/logout', {}); } catch (e) {}
    window._currentAdmin = null;
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
    renderKarts();
    renderCircuits();
    renderAdminList();
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
      const data = await GET('/api/messages');
      const all = data.messages || [];
      const cAll = all.length;
      const cUnread = all.filter(m => !m.read).length;
      const cRead = cAll - cUnread;
      $('#cntAll').textContent = cAll;
      $('#cntUnread').textContent = cUnread;
      $('#cntRead').textContent = cRead;
      $('#msgUnread').textContent = cUnread > 0 ? `(${cUnread})` : '';

      const filter = (document.querySelector('input[name="msgFilter"]:checked') || {}).value || 'all';
      const type = $('#msgTypeFilter').value;
      let list = all;
      if (filter === 'unread') list = list.filter(m => !m.read);
      if (filter === 'read')   list = list.filter(m => m.read);
      if (type) list = list.filter(m => m.type === type);

      const box = $('#msgList');
      const empty = $('#msgEmpty');
      if (list.length === 0) { box.innerHTML = ''; empty.style.display = ''; return; }
      empty.style.display = 'none';

      box.innerHTML = list.map(m => `
        <article class="msg-item ${m.read ? 'is-read' : ''}" data-id="${escapeHtml(m.id)}">
          <div class="msg-head">
            <div class="msg-head-left">
              <span class="msg-type type-${escapeHtml(m.type)}">${escapeHtml(m.type)}</span>
              <b class="msg-name">👤 ${escapeHtml(m.name)}${m.contact ? ' · ' + escapeHtml(m.contact) : ''}</b>
              ${m.read ? '<span class="msg-read-tag">已读</span>' : '<span class="msg-unread-tag">新</span>'}
            </div>
            <div class="msg-time">${fmtTime(m.created_at)}</div>
          </div>
          <div class="msg-content">${escapeHtml(m.content)}</div>
          <div class="msg-actions book-actions">
            <button class="btn btn-ghost btn-sm" data-act="toggle">${m.read ? '标为未读' : '标为已读'}</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
          </div>
        </article>
      `).join('');

      box.querySelectorAll('.msg-item').forEach(el => {
        const id = el.dataset.id;
        el.querySelector('[data-act="toggle"]').addEventListener('click', () => toggleRead(id));
        el.querySelector('[data-act="del"]').addEventListener('click', () => deleteMessage(id));
      });
    } catch (e) {
      console.error('加载留言失败:', e);
    }
  }

  async function toggleRead(id) {
    try {
      const m = (await GET('/api/messages')).messages.find(x => x.id === id);
      if (!m) return;
      await PATCH('/api/messages/' + id, { read: !m.read });
      renderMessages();
    } catch (e) { alert('操作失败：' + e.message); }
  }
  async function deleteMessage(id) {
    if (!confirm('确认删除这条留言？')) return;
    try { await DELETE('/api/messages/' + id); renderMessages(); }
    catch (e) { alert('删除失败：' + e.message); }
  }
  $('#btnMarkAll').addEventListener('click', async () => {
    if (!confirm('将所有留言标记为已读？')) return;
    try {
      const all = (await GET('/api/messages')).messages || [];
      for (const m of all) {
        if (!m.read) await PATCH('/api/messages/' + m.id, { read: true });
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
      const data = await GET('/api/bookings');
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
          <article class="msg-item book-item" data-id="${escapeHtml(b.id)}">
            <div class="msg-head">
              <div class="msg-head-left">
                <span class="msg-type type-book">${escapeHtml(b.room_name)}</span>
                <b class="msg-name">👤 ${escapeHtml(b.name)} · ${escapeHtml(b.contact)}</b>
                <span class="book-status ${st.cls}">${st.label}</span>
              </div>
              <div class="msg-time">${fmtTime(b.created_at)}</div>
            </div>
            <div class="book-detail">
              <div>📅 ${escapeHtml(b.check_in)} → ${escapeHtml(b.check_out)}</div>
              <div>🌙 ${b.nights} 晚 × 💎 ${b.price_per_night}${b.breakfast ? ` + 早餐 ${b.persons} 人 × 30` : ''} = <b style="color:var(--c-grass-dark)">💎 ${b.total} 绿宝石</b></div>
              <div>👥 ${escapeHtml(b.guests || '—')}${b.breakfast ? ' · 🍳 含早餐' : ''}</div>
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
        const id = el.dataset.id;
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
    try { await PATCH('/api/bookings/' + id, { status }); renderBookings(); }
    catch (e) { alert('更新失败：' + e.message); }
  }
  async function deleteBooking(id) {
    if (!confirm('确认删除该订单？')) return;
    try { await DELETE('/api/bookings/' + id); renderBookings(); }
    catch (e) { alert('删除失败：' + e.message); }
  }
  $$('input[name="bookFilter"]').forEach(r => r.addEventListener('change', renderBookings));
  $('#bookRoomFilter').addEventListener('change', renderBookings);
  $('#btnBookClearDone').addEventListener('click', async () => {
    if (!confirm('清除已完成/已取消的订单？')) return;
    try {
      const all = (await GET('/api/bookings')).bookings || [];
      for (const b of all) {
        if (b.status === 'completed' || b.status === 'cancelled') {
          await DELETE('/api/bookings/' + b.id);
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
      const data = await GET('/api/kart');
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
    try { await PATCH('/api/kart/' + id, { status }); renderKarts(); }
    catch (e) { alert('更新失败：' + e.message); }
  }
  async function deleteKart(id) {
    if (!confirm('确认删除该报名？')) return;
    try { await DELETE('/api/kart/' + id); renderKarts(); }
    catch (e) { alert('删除失败：' + e.message); }
  }
  $$('input[name="kartFilter"]').forEach(r => r.addEventListener('change', renderKarts));
  $('#kartSessionFilter').addEventListener('change', renderKarts);
  $('#btnKartClearDone').addEventListener('click', async () => {
    if (!confirm('清除已处理报名？')) return;
    try {
      const all = (await GET('/api/kart')).signups || [];
      for (const x of all) {
        if (x.status === 'approved' || x.status === 'rejected') await DELETE('/api/kart/' + x.id);
      }
      renderKarts();
    } catch (e) { alert('失败：' + e.message); }
  });

  /* ============================================
     Tab: 国际赛车场
     ============================================ */
  async function renderCircuits() {
    try {
      const data = await GET('/api/circuit');
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
    try { await PATCH('/api/circuit/' + id, { status }); renderCircuits(); }
    catch (e) { alert('更新失败：' + e.message); }
  }
  async function deleteCircuit(id) {
    if (!confirm('确认删除该报名？')) return;
    try { await DELETE('/api/circuit/' + id); renderCircuits(); }
    catch (e) { alert('删除失败：' + e.message); }
  }
  $$('input[name="circuitFilter"]').forEach(r => r.addEventListener('change', renderCircuits));
  $('#circuitSessionFilter').addEventListener('change', renderCircuits);
  $('#circuitLicenseFilter').addEventListener('change', renderCircuits);
  $('#btnCircuitClearDone').addEventListener('click', async () => {
    if (!confirm('清除已处理报名？')) return;
    try {
      const all = (await GET('/api/circuit')).signups || [];
      for (const x of all) {
        if (x.status === 'approved' || x.status === 'rejected') await DELETE('/api/circuit/' + x.id);
      }
      renderCircuits();
    } catch (e) { alert('失败：' + e.message); }
  });

  /* ============================================
     Tab: 管理员账号
     ============================================ */
  async function renderAdminList() {
    try {
      const data = await GET('/api/admins');
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
    try { await DELETE('/api/admins/' + id); renderAdminList(); }
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
        const data = await POST('/api/admins', { username, password, role });
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
        await PATCH('/api/admins/' + id, { new_password: np });
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
      await POST('/api/auth/login', { username: s.username, password: cur });
      await PATCH('/api/admins/' + s.id, { new_password: np });
      msgEl.classList.add('ok'); msgEl.textContent = '✓ 密码已更新（请记住新密码）';
      $('#pwdForm').reset();
    } catch (err) {
      msgEl.classList.add('err');
      msgEl.textContent = '更新失败：' + (err.message.includes('密码') ? '当前密码错误' : err.message);
    }
  });

  /* ============================================
     Session 缓存（仅用于 UI 显示当前用户）
     - 由 renderDash() 在登录成功时设置，避免异步竞态
     ============================================ */
  function getSession() {
    return window._currentAdmin || null;
  }

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
