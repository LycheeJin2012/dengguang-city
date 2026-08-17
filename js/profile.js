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

  // ========== 通行密钥 (Passkey) 管理（仅自己可见） ==========
  if (me) {
    const passkeyCard = document.getElementById('passkeyCard');
    const passkeyList = document.getElementById('passkeyList');
    const addBtn = document.getElementById('addPasskeyBtn');
    const passkeyMsg = document.getElementById('passkeyMsg');
    passkeyCard.style.display = '';

    function bufToB64url(buf) {
      const b = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function b64urlToBuf(s) {
      s = s.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    }

    async function loadPasskeys() {
      try {
        const r = await fetch('/api/init?action=passkey-list', { credentials: 'include' });
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error || '获取失败');
        const ks = d.passkeys || [];
        if (ks.length === 0) {
          passkeyList.innerHTML = '<p style="color:var(--c-stone);font-size:13px;font-style:italic">还没有通行密钥。点击下方按钮添加。</p>';
          return;
        }
        passkeyList.innerHTML = ks.map(k => {
          const aaguid = (k.aaguid || '').slice(0, 16) + '…';
          const lastUsed = k.last_used_at ? '上次使用: ' + k.last_used_at : '尚未使用';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--c-bg-2,#e8e0c8);border:2px solid var(--c-stone,#7a6a5a);margin-bottom:6px">
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--c-stone-dark,#4a3a2a)">🔑 ${escapeHtml(k.name)}</div>
              <div style="font-size:11px;color:var(--c-stone)">注册于 ${k.created_at} · ${lastUsed}</div>
              <div style="font-size:10px;color:var(--c-stone);font-family:monospace">id: ${aaguid}</div>
            </div>
            <button type="button" data-pkid="${k.id}" class="pk-del-btn" style="background:#a33;color:#fff;border:2px solid var(--c-stone-dark);padding:6px 10px;font-size:12px;cursor:pointer">🗑 删除</button>
          </div>`;
        }).join('');
        passkeyList.querySelectorAll('.pk-del-btn').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm('确认删除此通行密钥？删除后无法再用它登录。')) return;
            try {
              const r2 = await fetch('/api/init?action=passkey-delete', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: parseInt(btn.dataset.pkid, 10) }),
              });
              const d2 = await r2.json();
              if (!r2.ok || d2.error) throw new Error(d2.error || '删除失败');
              passkeyMsg.textContent = '✓ 已删除';
              passkeyMsg.style.color = 'var(--c-emerald)';
              setTimeout(() => passkeyMsg.textContent = '', 2000);
              loadPasskeys();
            } catch (e) {
              passkeyMsg.textContent = '✗ ' + e.message;
              passkeyMsg.style.color = 'var(--c-red, #c33)';
            }
          };
        });
      } catch (e) {
        passkeyList.innerHTML = '<p style="color:#c33">✗ 加载失败: ' + escapeHtml(e.message) + '</p>';
      }
    }
    loadPasskeys();

    addBtn.onclick = async () => {
      if (!window.PublicKeyCredential) { alert('您的浏览器不支持通行密钥'); return; }
      const name = prompt('给这个通行密钥起个名字（例：iPhone 15、MacBook）：', '我的设备');
      if (!name) return;
      addBtn.disabled = true;
      const orig = addBtn.textContent;
      addBtn.textContent = '⏳ 请触摸指纹/Face ID...';
      passkeyMsg.textContent = '';
      try {
        const r1 = await fetch('/api/init?action=passkey-register-start', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const d1 = await r1.json();
        if (!r1.ok || d1.error) throw new Error(d1.error || '获取 challenge 失败');
        const opts = d1.publicKey;
        opts.challenge = b64urlToBuf(opts.challenge);
        opts.user.id = b64urlToBuf(opts.user.id);
        const cred = await navigator.credentials.create({ publicKey: opts });
        if (!cred) throw new Error('未创建凭据');
        const r2 = await fetch('/api/init?action=passkey-register-finish', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challenge_token: d1.challenge_token,
            name,
            credential: {
              id: cred.id,
              rawId: bufToB64url(cred.rawId),
              type: cred.type,
              response: {
                clientDataJSON: bufToB64url(cred.response.clientDataJSON),
                attestationObject: bufToB64url(cred.response.attestationObject),
                transports: cred.response.getTransports ? cred.response.getTransports() : [],
              },
            },
          }),
        });
        const d2 = await r2.json();
        if (!r2.ok || d2.error) throw new Error(d2.error || '保存失败');
        passkeyMsg.textContent = '✓ 通行密钥已添加！';
        passkeyMsg.style.color = 'var(--c-emerald)';
        setTimeout(() => passkeyMsg.textContent = '', 3000);
        loadPasskeys();
      } catch (e) {
        passkeyMsg.textContent = '✗ ' + e.message;
        passkeyMsg.style.color = 'var(--c-red, #c33)';
        setTimeout(() => passkeyMsg.textContent = '', 5000);
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = orig;
      }
    };
  }
})();
