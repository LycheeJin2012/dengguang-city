// 私信页面逻辑
(async function() {
  const app = document.getElementById('app');
  const navUserSlot = document.getElementById('navUserSlot');

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function shortTime(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.includes('Z') ? '' : 'Z'));
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toTimeString().slice(0, 5);
    return d.toISOString().slice(5, 10); // MM-DD
  }

  // 检查登录态
  let me = null;
  try {
    const r = await fetch('/api/login', { credentials: 'include' });
    const d = await r.json();
    if (r.ok && d.ok && d.role === 'player') me = d.user;
  } catch (e) {}

  // 顶栏
  if (navUserSlot) {
    if (me) {
      navUserSlot.innerHTML = `
        <span class="nav-user-name">👤 ${escapeHtml(me.username)}</span>
        <a href="dm.html" class="nav-logout-link" style="color:var(--c-emerald);">📨 私信</a>
        <a href="profile.html" class="nav-logout-link" style="color:var(--c-emerald);">主页</a>
        <a href="#" id="navLogout" class="nav-logout-link">登出</a>
      `;
      const lo = document.getElementById('navLogout');
      if (lo) lo.addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/login', { method: 'DELETE', credentials: 'include' });
        location.href = 'dm.html';
      });
    } else {
      navUserSlot.innerHTML = `<a href="index.html" class="nav-login-link">返回首页登录</a>`;
    }
  }

  if (!me) {
    app.innerHTML = `
      <div class="dm-login-hint">
        <div style="font-size:48px;margin-bottom:12px;">📨</div>
        <h2 style="color:var(--c-stone-dark);margin:0 0 8px;">请先登录玩家账号</h2>
        <p style="font-size:13px;line-height:1.6;">私信是玩家之间的私人交流，<br>需要登录后才能使用。</p>
        <a href="index.html" class="btn btn-primary" style="display:inline-block;margin-top:12px;text-decoration:none;background:var(--c-emerald);color:white;padding:8px 20px;border:3px solid var(--c-stone-dark);box-shadow:2px 2px 0 var(--c-stone-dark);">返回首页</a>
      </div>
    `;
    return;
  }

  // 已登录 - 渲染主界面
  app.innerHTML = `
    <div class="dm-wrap">
      <div class="dm-panel dm-list-panel">
        <div class="dm-head">
          <span>📨 私信收件箱</span>
          <button class="dm-new-btn" id="dmNewBtn">+ 写新私信</button>
        </div>
        <div class="dm-list" id="dmList">
          <div class="dm-empty">载入中…</div>
        </div>
      </div>
      <div class="dm-panel dm-thread">
        <div id="dmThreadArea">
          <div class="dm-empty" style="padding:60px 20px;">← 选择左侧会话查看<br>或点击右上"写新私信"</div>
        </div>
      </div>
    </div>
  `;

  const dmList = document.getElementById('dmList');
  const dmThreadArea = document.getElementById('dmThreadArea');
  let conversations = [];
  let currentPeer = null; // {id, username, avatar_emoji}
  let messages = [];

  async function loadList() {
    try {
      const r = await fetch('/api/social?action=dm-list', { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        dmList.innerHTML = '<div class="dm-empty">载入失败：' + escapeHtml(d.error || '') + '</div>';
        return;
      }
      conversations = d.conversations || [];
      if (conversations.length === 0) {
        dmList.innerHTML = '<div class="dm-empty">还没有私信<br>点右上角"写新私信"开始</div>';
        return;
      }
      dmList.innerHTML = conversations.map(c => `
        <div class="dm-conv ${currentPeer && currentPeer.username === c.peer.username ? 'active' : ''}" data-username="${escapeHtml(c.peer.username)}">
          <div class="avatar">${escapeHtml(c.peer.avatar_emoji || '👤')}</div>
          <div class="info">
            <div class="name">${escapeHtml(c.peer.username)}</div>
            <div class="preview">${escapeHtml(c.last_content || '').slice(0, 40)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
            <span class="ts">${shortTime(c.last_at)}</span>
            ${c.unread > 0 ? `<span class="unread">${c.unread}</span>` : ''}
          </div>
        </div>
      `).join('');
      // 绑定点击
      dmList.querySelectorAll('.dm-conv').forEach(el => {
        el.addEventListener('click', () => {
          const u = el.getAttribute('data-username');
          openThread(u);
        });
      });
    } catch (e) {
      dmList.innerHTML = '<div class="dm-empty">载入失败</div>';
    }
  }

  async function openThread(username) {
    currentPeer = conversations.find(c => c.peer.username === username)?.peer || { username };
    // 重新渲染列表高亮
    dmList.querySelectorAll('.dm-conv').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-username') === username);
    });
    // 标记已读
    try {
      await fetch('/api/social?action=dm-read&peer=' + encodeURIComponent(username), {
        method: 'PATCH', credentials: 'include'
      });
    } catch (e) {}
    // 载入消息
    dmThreadArea.innerHTML = '<div class="dm-empty">载入中…</div>';
    try {
      const r = await fetch('/api/social?action=dm-thread&peer=' + encodeURIComponent(username), { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        dmThreadArea.innerHTML = '<div class="dm-empty">载入失败：' + escapeHtml(d.error || '') + '</div>';
        return;
      }
      currentPeer = d.peer; // 同步完整 peer 信息
      messages = d.messages || [];
      renderThread();
    } catch (e) {
      dmThreadArea.innerHTML = '<div class="dm-empty">载入失败</div>';
    }
  }

  function renderThread() {
    if (!currentPeer) return;
    dmThreadArea.innerHTML = `
      <div class="dm-thread-head">
        <span class="avatar">${escapeHtml(currentPeer.avatar_emoji || '👤')}</span>
        <div>
          <div class="name">${escapeHtml(currentPeer.username)}</div>
          <div style="font-size:11px;color:var(--c-stone);">私信对话</div>
        </div>
        <a href="profile.html?u=${encodeURIComponent(currentPeer.username)}">查看对方主页 →</a>
      </div>
      <div class="dm-messages" id="dmMessages"></div>
      <div class="dm-input">
        <textarea id="dmInput" placeholder="输入私信内容（最多 2000 字）…"></textarea>
        <button id="dmSend">发送</button>
      </div>
    `;
    const dmMessages = document.getElementById('dmMessages');
    if (messages.length === 0) {
      dmMessages.innerHTML = '<div class="dm-empty">还没有消息，发起对话吧！</div>';
    } else {
      dmMessages.innerHTML = messages.map(m => {
        const mine = m.from_player_id === me.id;
        return `
          <div class="dm-msg ${mine ? 'mine' : ''}">
            <div class="bubble">${escapeHtml(m.content)}</div>
            <div class="ts">${shortTime(m.created_at)}${!mine && !m.read_at ? ' · 未读' : ''}</div>
          </div>
        `;
      }).join('');
      dmMessages.scrollTop = dmMessages.scrollHeight;
    }
    document.getElementById('dmSend').addEventListener('click', sendMessage);
    document.getElementById('dmInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  async function sendMessage() {
    const inp = document.getElementById('dmInput');
    const btn = document.getElementById('dmSend');
    const content = inp.value.trim();
    if (!content) return;
    if (!currentPeer) return;
    btn.disabled = true; btn.textContent = '发送中…';
    try {
      const r = await fetch('/api/social?action=dm-send', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_username: currentPeer.username, content })
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        alert('发送失败：' + (d.error || ''));
        return;
      }
      inp.value = '';
      // 重新拉线程 + 列表
      await openThread(currentPeer.username);
      await loadList();
    } catch (e) {
      alert('发送失败：' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '发送';
    }
  }

  // 写新私信
  function openNewDM() {
    const username = prompt('收件人用户名（对方必须是已激活的玩家）:');
    if (!username || !username.trim()) return;
    const content = prompt('私信内容:');
    if (!content || !content.trim()) return;
    fetch('/api/social?action=dm-send', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_username: username.trim(), content: content.trim() })
    }).then(r => r.json()).then(d => {
      if (d.ok) {
        openThread(username.trim());
        loadList();
      } else {
        alert('发送失败：' + (d.error || ''));
      }
    }).catch(e => alert('发送失败：' + e.message));
  }
  document.getElementById('dmNewBtn').addEventListener('click', openNewDM);

  // 启动
  await loadList();

  // URL ?peer=X 自动打开
  const url = new URL(location.href);
  const peerQ = url.searchParams.get('peer');
  if (peerQ) openThread(peerQ);
})();
