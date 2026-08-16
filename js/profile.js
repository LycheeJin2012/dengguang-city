/* ============================================
   玩家个人主页 (profile.html)
   ============================================ */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const escapeHtml = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmtTime = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

  // 从 URL 拿用户名
  const username = decodeURIComponent((location.pathname.split('/').pop() || '').trim()) || (new URLSearchParams(location.search).get('u') || '').trim();
  if (!username) {
    $('#profileHeader').innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>未指定用户名</p></div>';
  } else {
    loadProfile(username);
  }

  async function loadProfile(u) {
    try {
      const data = await GET(`/api/profile/${encodeURIComponent(u)}`);
      const p = data.player;
      const stats = data.stats;
      $('#profileHeader').innerHTML = `
        <div class="profile-card">
          <div class="profile-avatar">${escapeHtml(p.avatar_emoji || '👤')}</div>
          <div class="profile-info">
            <h1 class="profile-name">${escapeHtml(p.username)}</h1>
            <div class="profile-meta">
              <span class="profile-tag">游戏ID: ${escapeHtml(p.game_id || p.username)}</span>
              <span class="profile-tag">${p.status === 'active' ? '✓ 已激活市民' : '⏳ ' + p.status}</span>
            </div>
            <div class="profile-bio">${escapeHtml(p.bio || '（这位市民还没写签名）')}</div>
            <div class="profile-stats">
              <div class="profile-stat"><b>${stats.messages}</b><span>条留言</span></div>
              <div class="profile-stat"><b>${stats.replied}</b><span>已回复</span></div>
              <div class="profile-stat"><b>${fmtTime(p.created_at).slice(0,10)}</b><span>注册</span></div>
            </div>
            <div class="profile-actions" id="profileActions"></div>
          </div>
        </div>
      `;
      // 玩家自己的页面：可编辑 bio
      const me = await GET('/api/login').catch(() => null);
      const isMe = me && me.ok && me.user && me.user.username === p.username;
      if (isMe) {
        $('#profileActions').innerHTML = `<button class="btn btn-primary btn-sm" id="btnEditBio">✎ 编辑签名/头像</button>`;
        $('#btnEditBio').addEventListener('click', () => openEditModal(p));
      } else if (me && me.ok && me.user) {
        $('#profileActions').innerHTML = `<a class="btn btn-primary btn-sm" href="dm.html?to=${encodeURIComponent(p.username)}">📬 私信 ta</a>`;
      }
      // 留言列表
      const msgsBox = $('#profileMsgs');
      if (data.messages.length === 0) {
        msgsBox.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><p>这位市民还没有留言</p></div>';
      } else {
        msgsBox.innerHTML = `
          <h2 class="section-title" style="font-size:18px;margin:30px 0 16px">💬 留言记录 (${data.messages.length})</h2>
          <div class="msg-list">
            ${data.messages.map(m => {
              const hasReply = m.admin_reply && m.admin_reply.length > 0;
              return `
                <article class="msg-item">
                  <div class="msg-head">
                    <div class="msg-head-left">
                      <b>${escapeHtml(m.name)}</b>
                      <span class="msg-read-tag">${m.status === 'new' ? '新' : m.status === 'read' ? '已读' : '已处理'}</span>
                      ${hasReply ? '<span class="msg-replied-tag">💬 已回复</span>' : ''}
                    </div>
                    <div class="msg-time">${fmtTime(m.created_at)}</div>
                  </div>
                  <div class="msg-content">${escapeHtml(m.content)}</div>
                  ${hasReply ? `<div class="msg-reply-box"><b>📣 市政厅回复：</b>${escapeHtml(m.admin_reply)}</div>` : ''}
                </article>
              `;
            }).join('')}
          </div>
        `;
      }
      // 更新 nav
      refreshNav(me);
    } catch (e) {
      $('#profileHeader').innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>${escapeHtml(e.message)}</p><p style="font-size:13px;margin-top:12px"><a href="index.html">← 返回首页</a></p></div>`;
    }
  }

  function openEditModal(p) {
    const html = `
      <form id="bioForm" class="modal-form">
        <label><span>头像 emoji（单个字符，如 🎮 / 👑 / ⭐）</span>
          <input type="text" id="newEmoji" maxlength="4" value="${escapeHtml(p.avatar_emoji || '👤')}" />
        </label>
        <label><span>个人签名（200 字以内）</span>
          <textarea id="newBio" rows="3" maxlength="200" placeholder="一句话介绍自己...">${escapeHtml(p.bio || '')}</textarea>
        </label>
        <div class="modal-msg" id="bioMsg"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="bioCancel">取消</button>
          <button type="submit" class="btn btn-primary">💾 保存</button>
        </div>
      </form>
    `;
    openModal('编辑个人资料', html);
    $('#bioCancel').addEventListener('click', closeModal);
    $('#bioForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = $('#bioMsg'); msgEl.textContent = '';
      try {
        await PATCH('/api/profile/me', {
          avatar_emoji: $('#newEmoji').value.trim(),
          bio: $('#newBio').value.trim()
        });
        closeModal();
        loadProfile(p.username);
      } catch (err) { msgEl.textContent = err.message; }
    });
  }

  function openModal(title, html) {
    const m = document.createElement('div');
    m.className = 'modal-mask';
    m.id = 'tmpModal';
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

  async function refreshNav(me) {
    const slot = $('#navUserSlot'); if (!slot) return;
    if (me && me.ok && me.user && me.user.role === 'player') {
      slot.innerHTML = `
        <span class="nav-user-name">👤 ${escapeHtml(me.user.username)}</span>
        <a href="profile.html?u=${encodeURIComponent(me.user.username)}" class="nav-login-link">个人主页</a>
        <a href="#" id="navLogout" class="nav-logout-link">登出</a>
      `;
      $('#navLogout').addEventListener('click', async (e) => {
        e.preventDefault();
        try { await fetch('/api/login', { method: 'DELETE', credentials: 'include' }); } catch (e) {}
        location.href = 'index.html';
      });
    } else {
      slot.innerHTML = `<a href="index.html" class="nav-login-link">返回首页</a>`;
    }
  }
})();
