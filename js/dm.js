/* ============================================
   站内私信页面 (dm.html)
   ============================================ */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const escapeHtml = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmtTime = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return `今天 ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    return `${d.getMonth()+1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  async function api(method, path, body) {
    const opts = { method: method.toUpperCase(), credentials: 'include' };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data;
    try { data = await res.json(); } catch (e) { data = { ok: false, error: '非 JSON 响应' }; }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  const GET    = p => api('GET', p);
  const POST   = (p, b) => api('POST', p, b);
  const PATCH  = (p, b) => api('PATCH', p, b);

  let _me = null;
  let _box = 'inbox';
  let _currentChat = null; // username
  let _dmCache = [];

  // 启动
  (async () => {
    const me = await GET('/api/login').catch(() => null);
    if (!me || !me.ok || me.role !== 'player') {
      $('#dmMain').innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><p>请先<a href="index.html">登录</a>后查看私信</p></div>';
      return;
    }
    _me = me.user;
    refreshNav();
    // URL ?to=xxx 自动打开会话
    const url = new URL(location.href);
    const to = url.searchParams.get('to');
    if (to) {
      openChat(decodeURIComponent(to));
    }
    loadList();
  })();

  // 顶栏
  function refreshNav() {
    const slot = $('#navUserSlot'); if (!slot) return;
    slot.innerHTML = `
      <span class="nav-user-name">📬 私信</span>
      <a href="profile.html?u=${encodeURIComponent(_me.username)}" class="nav-login-link">个人主页</a>
      <a href="#" id="navLogout" class="nav-logout-link">登出</a>
    `;
    $('#navLogout').addEventListener('click', async (e) => {
      e.preventDefault();
      try { await fetch('/api/login', { method: 'DELETE', credentials: 'include' }); } catch (e) {}
      location.href = 'index.html';
    });
  }

  // 加载列表
  async function loadList() {
    try {
      const data = await GET(`/api/dm?box=${_box}`);
      _dmCache = data.messages || [];
      renderList();
    } catch (e) {
      $('#dmList').innerHTML = `<div class="empty-state"><p style="color:#d33">${escapeHtml(e.message)}</p></div>`;
    }
  }
  function renderList() {
    const box = $('#dmList'); const empty = $('#dmListEmpty');
    if (_dmCache.length === 0) { box.innerHTML = ''; empty.style.display = ''; return; }
    empty.style.display = 'none';
    // 聚合：每条会话只显示一个最新条目
    const seen = new Set();
    const items = [];
    for (const m of _dmCache) {
      const otherUsername = _box === 'inbox' ? m.from_username : (_box === 'sent' ? m.to_username : (m.from_username === _me.username ? m.to_username : m.from_username));
      if (!otherUsername) continue;
      if (seen.has(otherUsername)) continue;
      seen.add(otherUsername);
      const otherAvatar = _box === 'inbox' ? m.from_avatar : (_box === 'sent' ? m.to_avatar : (m.from_username === _me.username ? m.to_avatar : m.from_avatar));
      items.push({ m, otherUsername, otherAvatar });
    }
    box.innerHTML = items.map(({ m, otherUsername, otherAvatar }) => {
      const isActive = _currentChat === otherUsername;
      const isUnread = _box === 'inbox' && m.to_player_id === _me.id && !m.read_at;
      return `
        <div class="dm-list-item ${isActive ? 'active' : ''} ${isUnread ? 'unread' : ''}" data-user="${escapeHtml(otherUsername)}">
          <div class="dm-list-avatar">${escapeHtml(otherAvatar || '👤')}</div>
          <div class="dm-list-body">
            <div class="dm-list-name">${escapeHtml(otherUsername)}${isUnread ? ' <span class="dm-unread-dot">●</span>' : ''}</div>
            <div class="dm-list-preview">${escapeHtml((m.content || '').slice(0, 30))}</div>
          </div>
          <div class="dm-list-time">${fmtTime(m.created_at)}</div>
        </div>
      `;
    }).join('');
    box.querySelectorAll('.dm-list-item').forEach(el => {
      el.addEventListener('click', () => openChat(el.dataset.user));
    });
  }

  // 打开某个会话
  async function openChat(username) {
    _currentChat = username;
    renderList();
    $('#dmMain').innerHTML = '<div class="empty-state"><p>加载中...</p></div>';
    try {
      const data = await GET(`/api/dm?with=${encodeURIComponent(username)}`);
      renderChat(data);
    } catch (e) {
      $('#dmMain').innerHTML = `<div class="empty-state"><p style="color:#d33">${escapeHtml(e.message)}</p></div>`;
    }
  }
  function renderChat(data) {
    const other = data.other;
    const msgs = data.messages || [];
    const main = $('#dmMain');
    main.innerHTML = `
      <div class="dm-chat-head">
        <a class="dm-chat-avatar" href="profile.html?u=${encodeURIComponent(other.username)}">${escapeHtml(other.avatar_emoji || '👤')}</a>
        <div>
          <b>${escapeHtml(other.username)}</b>
          <small style="color:var(--c-stone-dark);font-size:12px">与 ta 的对话 (${msgs.length} 条消息)</small>
        </div>
      </div>
      <div class="dm-chat-body" id="dmChatBody">
        ${msgs.length === 0 ? '<div class="empty-state"><p>还没有消息 · 发个招呼吧</p></div>' : msgs.map(m => {
          const fromMe = m.from_player_id === _me.id;
          return `
            <div class="dm-msg ${fromMe ? 'from-me' : 'from-other'}">
              <div class="dm-msg-bubble">${escapeHtml(m.content)}</div>
              <div class="dm-msg-meta">${fmtTime(m.created_at)} ${m.read_at && !fromMe ? '· 已读' : ''}</div>
            </div>
          `;
        }).join('')}
      </div>
      <form class="dm-chat-form" id="dmChatForm">
        <textarea id="dmContent" rows="2" required maxlength="2000" placeholder="输入私信内容..."></textarea>
        <button type="submit" class="btn btn-primary">▶ 发送</button>
      </form>
    `;
    // 滚到底部
    const body = $('#dmChatBody');
    body.scrollTop = body.scrollHeight;
    // 提交
    $('#dmChatForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ta = $('#dmContent');
      const text = ta.value.trim();
      if (!text) return;
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = '发送中...';
      try {
        await POST('/api/dm', { to: other.username, content: text });
        ta.value = '';
        openChat(other.username); // 重新加载
        loadList(); // 刷新左侧列表
      } catch (err) {
        alert('发送失败：' + err.message);
      } finally {
        btn.disabled = false; btn.textContent = '▶ 发送';
      }
    });
  }

  // tab 切换
  $$('.dm-tab').forEach(t => t.addEventListener('click', () => {
    $$('.dm-tab').forEach(x => x.classList.toggle('active', x === t));
    _box = t.dataset.box;
    loadList();
  }));

  // 新建私信
  $('#btnNewDM').addEventListener('click', () => {
    const html = `
      <form id="newDmForm" class="modal-form">
        <label><span>收件人用户名 / 游戏ID</span>
          <input type="text" id="newDmTo" required maxlength="32" placeholder="输入对方用户名" />
        </label>
        <label><span>内容</span>
          <textarea id="newDmContent" required rows="3" maxlength="2000" placeholder="说点什么..."></textarea>
        </label>
        <div class="modal-msg" id="newDmMsg"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="newDmCancel">取消</button>
          <button type="submit" class="btn btn-primary">▶ 发送</button>
        </div>
      </form>
    `;
    openModal('✉️ 新建私信', html);
    $('#newDmCancel').addEventListener('click', closeModal);
    $('#newDmForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const to = $('#newDmTo').value.trim();
      const content = $('#newDmContent').value.trim();
      if (!to || !content) return;
      try {
        const res = await POST('/api/dm', { to, content });
        closeModal();
        location.href = `dm.html?to=${encodeURIComponent(res.to)}`;
      } catch (err) {
        $('#newDmMsg').textContent = err.message;
      }
    });
  });

  // modal helpers
  function openModal(title, html) {
    const m = document.createElement('div'); m.className = 'modal-mask'; m.id = 'tmpModal';
    m.style.display = '';
    m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-close" id="tmpClose">×</button><h3 style="text-align:center;margin-bottom:16px">${escapeHtml(title)}</h3>${html}</div>`;
    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    $('#tmpClose').addEventListener('click', closeModal);
  }
  function closeModal() {
    const m = $('#tmpModal'); if (m) m.remove();
    document.body.style.overflow = '';
  }
})();
