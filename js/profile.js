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
  // v17.9: combined session (玩家绑定了管理员) 也算登录态, data.player 始终存在
  let me = null;
  let isCombined = false;  // 是否有 admin 身份
  try {
    const r = await fetch('/api/login', { credentials: 'include' });
    const d = await r.json();
    if (r.ok && d.ok && d.player) {
      me = d.player;
      isCombined = !!d.combined;
    }
  } catch (e) {}

  // 2. 顶栏
  if (navUserSlot) {
    if (me) {
      const adminLink = isCombined
        ? `<a href="admin.html" class="nav-logout-link nav-admin-link">🛡️ 管理后台</a>`
        : '';
      navUserSlot.innerHTML = `
        <span class="nav-user-name">👤 ${escapeHtml(me.username)}</span>
        ${adminLink}
        <a href="dm.html" class="nav-logout-link">📨 私信</a>
        <a href="profile.html" class="nav-logout-link">我的主页</a>
        <a href="#" id="navLogout" class="nav-logout-link">登出</a>
      `;
      const lo = document.getElementById('navLogout');
      if (lo) lo.addEventListener('click', async (e) => {
        e.preventDefault();
        // v17.9: combined 时只清 admin 身份, 保留 player 身份(回玩家首页)
        if (isCombined) {
          try {
            await fetch('/api/init?action=admin-logout', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
          } catch (e2) {}
          location.href = 'index.html';
        } else {
          await fetch('/api/login', { method: 'DELETE', credentials: 'include' });
          location.href = 'index.html';
        }
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
          <div class="big-icon">👤</div>
          <h2>请先登录查看个人主页</h2>
          <p>登录后自动跳转到你的个人主页</p>
          <a href="index.html" class="btn btn-primary" style="margin-top:12px;">返回首页</a>
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
         <button id="btnEdit" class="btn btn-primary">✏️ 编辑我的主页</button>
         <button id="btnChangePw" class="btn btn-primary">🔑 修改密码</button>
       </div>`
    : (me
        ? `<div class="profile-actions">
             <a href="dm.html?peer=${encodeURIComponent(profile.username)}" class="btn btn-primary">📨 发私信</a>
             <a href="dm.html" class="btn btn-ghost">📨 我的私信</a>
           </div>`
        : `<div class="profile-actions">
             <a href="index.html" class="btn btn-ghost">登录后发私信</a>
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

  // v37.7: 自己主页加"我的最近留言" 卡片 (仅本人)
  if (isSelf) {
    loadMyMessages();
    loadMyBookings();
  }

  // 5. 编辑自己主页
  if (isSelf) {
    document.getElementById('btnEdit').addEventListener('click', openEditModal);
    document.getElementById('btnChangePw').addEventListener('click', openChangePwModal);
  }

  function openEditModal() {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <h3>✏️ 编辑个人主页</h3>
          <button class="modal-close" id="mClose">×</button>
        </div>
        <div class="modal-body">
          <label>头像（一个 emoji）</label>
          <input type="text" id="mAvatar" maxlength="4" value="${escapeHtml(profile.avatar_emoji || '👤')}">
          <div class="hint">提示：1-4 个字符，建议是 emoji（如 🏎️ 🐱 🎮）</div>
          <label>个人简介</label>
          <textarea id="mBio" rows="5" maxlength="500" placeholder="介绍一下自己…">${escapeHtml(profile.bio || '')}</textarea>
          <div class="hint">最多 500 字。市政厅不对内容做审核，请文明发言。</div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="mCancel">取消</button>
            <button class="btn btn-primary" id="mSave">保存</button>
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

  // v17.9: 修改玩家密码 modal
  function openChangePwModal() {
    const old = document.getElementById('changePwBackdrop');
    if (old) old.remove();
    const mask = document.createElement('div');
    mask.id = 'changePwBackdrop';
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-head">
          <h3>🔑 修改我的密码</h3>
          <button class="modal-close" id="cpClose">×</button>
        </div>
        <div class="modal-body">
          <label>当前密码</label>
          <input type="password" id="cpOld" autocomplete="current-password" placeholder="至少 8 位">
          <label>新密码</label>
          <input type="password" id="cpNew" autocomplete="new-password" placeholder="至少 8 位">
          <label>再输一次新密码</label>
          <input type="password" id="cpNew2" autocomplete="new-password" placeholder="再输一次">
          <div class="hint">注: 合并账号时, 玩家密码与管理员密码<strong>互不影响</strong>。改这里只改玩家。</div>
          <div id="cpMsg" class="modal-msg-inline"></div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="cpCancel">取消</button>
            <button class="btn btn-primary" id="cpSave">保存</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    document.getElementById('cpClose').addEventListener('click', close);
    document.getElementById('cpCancel').addEventListener('click', close);
    const saveBtn = document.getElementById('cpSave');
    saveBtn.addEventListener('click', async () => {
      const oldPw = document.getElementById('cpOld').value;
      const newPw = document.getElementById('cpNew').value;
      const newPw2 = document.getElementById('cpNew2').value;
      const msgEl = document.getElementById('cpMsg');
      msgEl.textContent = '';
      msgEl.className = 'modal-msg-inline';
      if (!oldPw || !newPw || !newPw2) { msgEl.textContent = '所有字段必填'; msgEl.classList.add('error'); return; }
      if (newPw.length < 8) { msgEl.textContent = '新密码至少 8 位'; msgEl.classList.add('error'); return; }
      if (newPw !== newPw2) { msgEl.textContent = '两次新密码不一致'; msgEl.classList.add('error'); return; }
      saveBtn.disabled = true; saveBtn.textContent = '保存中…';
      try {
        const r = await fetch('/api/init?action=player-change-password', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || '保存失败');
        msgEl.textContent = '✓ 密码已更新';
        msgEl.classList.add('success');
        setTimeout(() => mask.remove(), 1200);
      } catch (e) {
        msgEl.textContent = '✗ ' + e.message;
        msgEl.classList.add('error');
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = '保存';
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

    // v37.7: 我的最近留言 (profile 页加卡片)
    async function loadMyMessages() {
      const wrap = document.getElementById('myMessagesCard');
      if (!wrap) return;
      try {
        const r = await fetch('/api/messages?my=1', { credentials: 'include' });
        const d = await r.json();
        if (!r.ok || !d.ok) { wrap.style.display = 'none'; return; }
        const msgs = d.messages || [];
        if (msgs.length === 0) { wrap.style.display = 'none'; return; }
        wrap.innerHTML = '<div class="pmm-head">📜 我最近的市民留言</div>' + msgs.slice(0, 3).map(m => {
          const hasReply = m.admin_reply && m.admin_reply.length > 0;
          const isAi = hasReply && m.admin_reply.startsWith('🤖');
          const tag = isAi ? '<span class="msg-replied-tag" style="background:#1a3a1a;color:#9f9;border-color:#6f6">🤖 AI 已回复</span>'
                    : hasReply ? '<span class="msg-replied-tag" style="background:#1a2a3a;color:#9cf;border-color:#6cf">💬 已回复</span>'
                    : '<span class="msg-replied-tag" style="background:#3a2a1a;color:#fc6;border-color:#c84">⏳ 待回复</span>';
          return `<article class="pmm-item">
            <div class="pmm-head-row">${tag}<span class="pmm-time">${(m.created_at || '').slice(0, 16).replace('T', ' ')}</span></div>
            <div class="pmm-content">${escapeHtml(m.content)}</div>
            ${hasReply ? `<div class="pmm-reply">📣 ${escapeHtml(m.admin_reply)}</div>` : ''}
          </article>`;
        }).join('');
        wrap.style.display = '';
      } catch (e) { wrap.style.display = 'none'; }
    }

    // v40: 我的最近报名 (酒店/驾照/赛道/电路) — 4 个端点并发拉, 取最近 3 条
    async function loadMyBookings() {
      const wrap = document.getElementById('myBookingsCard');
      if (!wrap) return;
      try {
        const [b, l, k, c] = await Promise.all([
          fetch('/api/bookings', { credentials: 'include' }).then(r => r.ok ? r.json() : { bookings: [] }),
          fetch('/api/license',  { credentials: 'include' }).then(r => r.ok ? r.json() : { signups: [] }),
          fetch('/api/kart',     { credentials: 'include' }).then(r => r.ok ? r.json() : { signups: [] }),
          fetch('/api/circuit',  { credentials: 'include' }).then(r => r.ok ? r.json() : { signups: [] }),
        ]);
        const all = [];
        (b.bookings || []).forEach(x => all.push({ type: '酒店', icon: '🏨', text: `${x.room_name || '房型'} · ${x.in_date} → ${x.out_date} (${x.nights} 晚${x.breakfast ? ' · 含早餐' : ''})`, time: x.created_at }));
        (l.signups  || []).forEach(x => all.push({ type: '驾照', icon: '🚗', text: `${({written:'笔试',road:'路考',upgrade:'升级'})[x.exam_type] || x.exam_type} · ${x.exam_date || '日期待定'}`, time: x.created_at }));
        (k.signups  || []).forEach(x => all.push({ type: '赛道', icon: '🏁', text: `试跑 · ${x.session || '场次待定'}${x.car ? ' · ' + x.car : ''}`, time: x.created_at }));
        (c.signups  || []).forEach(x => all.push({ type: '赛车场', icon: '🏎️', text: `国际赛车场试车`, time: x.created_at }));
        if (all.length === 0) { wrap.style.display = 'none'; return; }
        all.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
        wrap.innerHTML = '<div class="pmm-head">📋 我最近的报名</div>' + all.slice(0, 3).map(it => `
          <article class="pmm-item">
            <div class="pmm-head-row"><span class="pmm-type-tag">${it.icon} ${it.type}</span><span class="pmm-time">${(it.time || '').slice(0, 16).replace('T', ' ')}</span></div>
            <div class="pmm-content">${escapeHtml(it.text)}</div>
          </article>
        `).join('');
        wrap.style.display = '';
      } catch (e) { wrap.style.display = 'none'; }
    }

    async function loadPasskeys() {
      try {
        // v17.10: passkey-list 端点只接受 POST (init.js 路由都在 onRequestPost)
        const r = await fetch('/api/init?action=passkey-list', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error || '获取失败');
        const ks = d.passkeys || [];
        if (ks.length === 0) {
          passkeyList.innerHTML = '<p class="passkey-empty">还没有通行密钥。点击下方按钮添加。</p>';
          return;
        }
        passkeyList.innerHTML = ks.map(k => {
          const lastUsed = k.last_used_at ? '上次使用: ' + k.last_used_at : '尚未使用';
          return `<div class="passkey-item">
            <div class="passkey-item-info">
              <div class="passkey-item-name">🔑 ${escapeHtml(k.name)}</div>
              <div class="passkey-item-detail">注册于 ${k.created_at} · ${lastUsed}</div>
              <div class="passkey-item-cred">cred_id: ${escapeHtml((k.credential_id || '').slice(0, 16))}…</div>
            </div>
            <div class="passkey-item-actions">
              <button type="button" data-pkcred="${escapeHtml(k.credential_id || '')}" class="pk-test-btn">🧪 测试</button>
              <button type="button" data-pkid="${k.id}" class="pk-del-btn">🗑</button>
            </div>
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
              setPasskeyMsg('✓ 已删除', 'success');
              setTimeout(() => setPasskeyMsg('', 'muted'), 2000);
              loadPasskeys();
            } catch (e) {
              setPasskeyMsg('✗ ' + e.message, 'error');
            }
          };
        });
        // v17.10: 测试通行密钥 — 注册后用 navigator.credentials.get 验证一次
        passkeyList.querySelectorAll('.pk-test-btn').forEach(btn => {
          btn.onclick = async () => {
            const credId = btn.dataset.pkcred;
            if (!credId) { setPasskeyMsg('✗ 该密钥无 credential_id', 'error'); return; }
            const orig = btn.textContent;
            btn.disabled = true; btn.textContent = '⏳ 验证中…';
            setPasskeyMsg('正在验证通行密钥, 请触摸指纹/Face ID...', 'muted');
            try {
              const r1 = await fetch('/api/init?action=passkey-test-start', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential_id: credId }),
              });
              const d1 = await r1.json();
              if (!r1.ok || d1.error) throw new Error(d1.error || '获取挑战失败');
              const opts = d1.publicKey;
              opts.challenge = b64urlToBuf(opts.challenge);
              // WebAuthn 要求 allowCredentials[].id 必须是 BufferSource
              if (opts.allowCredentials) {
                opts.allowCredentials = opts.allowCredentials.map((c) => ({ ...c, id: b64urlToBuf(c.id) }));
              }
              const cred = await navigator.credentials.get({ publicKey: opts });
              if (!cred) throw new Error('未选择凭据');
              const r2 = await fetch('/api/init?action=passkey-test-finish', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  challenge_token: d1.challenge_token,
                  credential: {
                    id: cred.id,
                    rawId: bufToB64url(cred.rawId),
                    type: cred.type,
                    response: {
                      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
                      authenticatorData: bufToB64url(cred.response.authenticatorData),
                      signature: bufToB64url(cred.response.signature),
                    }
                  }
                }),
              });
              const d2 = await r2.json();
              if (!r2.ok || !d2.ok) throw new Error(d2.error || '验证失败');
              setPasskeyMsg('✓ 通行密钥有效! ' + (d2.message || ''), 'success');
              setTimeout(() => setPasskeyMsg('', 'muted'), 4000);
              loadPasskeys();
            } catch (e) {
              setPasskeyMsg('✗ ' + e.message, 'error');
              setTimeout(() => setPasskeyMsg('', 'muted'), 5000);
            } finally {
              btn.disabled = false; btn.textContent = orig;
            }
          };
        });
      } catch (e) {
        passkeyList.innerHTML = '<p class="passkey-msg error">✗ 加载失败: ' + escapeHtml(e.message) + '</p>';
      }
    }
    function setPasskeyMsg(text, kind) {
      passkeyMsg.textContent = text;
      passkeyMsg.className = 'passkey-msg ' + (kind || 'muted');
    }
    loadPasskeys();

    addBtn.onclick = async () => {
      if (!window.PublicKeyCredential) { alert('您的浏览器不支持通行密钥'); return; }
      const name = prompt('给这个通行密钥起个名字（例：iPhone 15、MacBook）：', '我的设备');
      if (!name) return;
      addBtn.disabled = true;
      const orig = addBtn.textContent;
      addBtn.textContent = '⏳ 请触摸指纹/Face ID...';
      setPasskeyMsg('', 'muted');
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
        setPasskeyMsg('✓ 通行密钥已添加！', 'success');
        setTimeout(() => setPasskeyMsg('', 'muted'), 3000);
        loadPasskeys();
      } catch (e) {
        setPasskeyMsg('✗ ' + e.message, 'error');
        setTimeout(() => setPasskeyMsg('', 'muted'), 5000);
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = orig;
      }
    };
  }
})();
