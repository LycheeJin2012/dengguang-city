// 玩家个人主页（公开 profile + 自己可编辑）
(async function() {
  const app = document.getElementById('app');
  const pAvatar = document.getElementById('pAvatar');
  const pBody = document.getElementById('pBody');
  const navUserSlot = document.getElementById('navUserSlot');

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // 1. 当前登录态（用于判断"是不是自己"）
  let me = null;
  try {
    const r = await fetch('/api/login', { credentials: 'include' });
    const d = await r.json();
    if (r.ok && d.ok && d.role === 'player') me = d.user;
  } catch (e) {}

  // 2. 顶栏
  if (navUserSlot) {
    if (me) {
      navUserSlot.innerHTML = `
        <span class="nav-user-name">👤 ${escapeHtml(me.username)}</span>
        <a href="dm.html" class="nav-logout-link" style="color:var(--c-emerald);">📨 私信</a>
        <a href="profile.html" class="nav-logout-link" style="color:var(--c-emerald);">我的主页</a>
        <a href="#" id="navLogout" class="nav-logout-link">登出</a>
      `;
      const lo = document.getElementById('navLogout');
      if (lo) lo.addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/login', { method: 'DELETE', credentials: 'include' });
        location.href = 'index.html';
      });
    } else {
      navUserSlot.innerHTML = `<a href="index.html" class="nav-login-link">返回首页</a>`;
    }
  }

  // 3. 决定要查看谁
  const url = new URL(location.href);
  let viewUsername = url.searchParams.get('u');
  let isSelf = false;

  if (!viewUsername) {
    // 没传 ?u= ：如果已登录则看自己，否则提示登录
    if (me) {
      viewUsername = me.username;
      isSelf = true;
    } else {
      pBody.innerHTML = `
        <div class="profile-login-hint">
          <div style="font-size:48px;margin-bottom:12px;">👤</div>
          <h2 style="color:var(--c-stone-dark);margin:0 0 8px;">请先登录查看个人主页</h2>
          <p style="font-size:13px;">登录后自动跳转到你的个人主页</p>
          <a href="index.html" class="btn btn-primary" style="display:inline-block;margin-top:12px;text-decoration:none;background:var(--c-emerald);color:white;padding:8px 20px;border:3px solid var(--c-stone-dark);box-shadow:2px 2px 0 var(--c-stone-dark);">返回首页</a>
        </div>
      `;
      return;
    }
  } else if (me && me.username === viewUsername) {
    isSelf = true;
  }

  // 4. 拉取 profile
  let profile = null, stats = null;
  try {
    const r = await fetch('/api/social?action=profile&username=' + encodeURIComponent(viewUsername), { credentials: 'include' });
    const d = await r.json();
    if (!r.ok || !d.ok) {
      pBody.innerHTML = `<div class="profile-login-hint"><h2>${escapeHtml(d.error || '载入失败')}</h2><p>该玩家可能不存在或账号未激活</p></div>`;
      return;
    }
    profile = d.profile;
    stats = d.stats;
  } catch (e) {
    pBody.innerHTML = '<div class="profile-login-hint"><h2>载入失败</h2></div>';
    return;
  }

  pAvatar.textContent = profile.avatar_emoji || '👤';
  const bio = (profile.bio || '').trim();
  const created = (profile.created_at || '').slice(0, 10);
  const actionsHtml = isSelf
    ? `<div class="profile-actions">
         <button id="btnEdit" class="btn-gold">✏️ 编辑我的主页</button>
       </div>`
    : (me
        ? `<div class="profile-actions">
             <a href="dm.html?peer=${encodeURIComponent(profile.username)}">📨 发私信</a>
             <a href="dm.html" class="btn-gold">📨 我的私信</a>
           </div>`
        : `<div class="profile-actions">
             <a href="index.html">登录后发私信</a>
           </div>`);

  pBody.innerHTML = `
    <div class="profile-name">${escapeHtml(profile.username)}</div>
    <div class="profile-meta">
      注册日期：${escapeHtml(created) || '待公告'}
    </div>
    <div class="profile-bio ${bio ? '' : 'empty'}">${bio ? escapeHtml(bio) : '这位玩家还没有写个人简介…'}</div>
    <div class="profile-stats">
      <div class="profile-stat">
        <div class="num">${stats?.messages || 0}</div>
        <div class="lbl">留 言</div>
      </div>
      <div class="profile-stat">
        <div class="num">${stats?.comments || 0}</div>
        <div class="lbl">评 论</div>
      </div>
    </div>
    ${actionsHtml}
  `;

  // 5. 编辑自己主页
  if (isSelf) {
    document.getElementById('btnEdit').addEventListener('click', openEditModal);
  }

  function openEditModal() {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <span>✏️ 编辑个人主页</span>
          <button class="modal-close" id="mClose">×</button>
        </div>
        <div class="modal-body">
          <label>头像（一个 emoji）</label>
          <input type="text" id="mAvatar" maxlength="4" value="${escapeHtml(profile.avatar_emoji || '👤')}">
          <div class="hint">提示：1-4 个字符，建议是 emoji（如 🏎️ 🐱 🎮）</div>
          <label style="margin-top:14px;">个人简介</label>
          <textarea id="mBio" rows="5" maxlength="500" placeholder="介绍一下自己…">${escapeHtml(profile.bio || '')}</textarea>
          <div class="hint">最多 500 字。市政厅不对内容做审核，请文明发言。</div>
          <div class="modal-actions">
            <button class="btn-cancel" id="mCancel">取消</button>
            <button id="mSave">保存</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    document.getElementById('mClose').addEventListener('click', close);
    document.getElementById('mCancel').addEventListener('click', close);
    document.getElementById('mSave').addEventListener('click', async () => {
      const btn = document.getElementById('mSave');
      btn.disabled = true; btn.textContent = '保存中…';
      try {
        const r = await fetch('/api/social?action=me', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            avatar_emoji: document.getElementById('mAvatar').value,
            bio: document.getElementById('mBio').value
          })
        });
        const d = await r.json();
        if (!r.ok || !d.ok) {
          alert('保存失败：' + (d.error || ''));
          btn.disabled = false; btn.textContent = '保存';
          return;
        }
        // 刷新页面
        location.reload();
      } catch (e) {
        alert('保存失败：' + e.message);
        btn.disabled = false; btn.textContent = '保存';
      }
    });
  }
})();
