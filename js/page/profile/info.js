// v45 重写: profile 子页 - 公开 profile 展示 + 编辑 + 改密码
import { $, escHtml, GET, POST, PATCH } from '../util.js?v=v45-fix-401';

let _profile = null;
let _isSelf = false;

export function getProfile() { return _profile; }
export function isSelf() { return _isSelf; }

// ============== 拉取 profile ==============
export async function fetchProfile(username) {
  const d = await GET('/api/social?action=profile&username=' + encodeURIComponent(username));
  if (!d.ok) throw new Error(d.error || '载入失败');
  return { profile: d.profile, stats: d.stats };
}

// ============== 渲染 profile ==============
export function renderProfile(me, profile, stats) {
  const pAvatar = $('#pAvatar');
  const pBody = $('#pBody');
  if (pAvatar) pAvatar.textContent = profile.avatar_emoji || '👤';
  const bio = (profile.bio || '').trim();
  const created = (profile.created_at || '').slice(0, 10);
  const actionsHtml = _isSelf
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
    <div class="profile-name">${escHtml(profile.username)}</div>
    <div class="profile-meta">注册日期：${escHtml(created) || '待公告'}</div>
    <div class="profile-bio ${bio ? '' : 'empty'}">${bio ? escHtml(bio) : '这位玩家还没有写个人简介…'}</div>
    <div class="profile-stats">
      <div class="profile-stat"><div class="num">${stats?.messages || 0}</div><div class="lbl">留 言</div></div>
      <div class="profile-stat"><div class="num">${stats?.comments || 0}</div><div class="lbl">评 论</div></div>
    </div>
    ${actionsHtml}`;
  if (_isSelf) {
    $('#btnEdit')?.addEventListener('click', openEditModal);
    $('#btnChangePw')?.addEventListener('click', openChangePwModal);
  }
}

function openEditModal() {
  if (!_profile) return;
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
        <input type="text" id="mAvatar" maxlength="4" value="${escHtml(_profile.avatar_emoji || '👤')}">
        <div class="hint">提示：1-4 个字符，建议是 emoji（如 🏎️ 🐱 🎮）</div>
        <label>个人简介</label>
        <textarea id="mBio" rows="5" maxlength="500" placeholder="介绍一下自己…">${escHtml(_profile.bio || '')}</textarea>
        <div class="hint">最多 500 字。市政厅不对内容做审核，请文明发言。</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="mCancel">取消</button>
          <button class="btn btn-primary" id="mSave">保存</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  $('#mClose').addEventListener('click', close);
  $('#mCancel').addEventListener('click', close);
  $('#mSave').addEventListener('click', async () => {
    const btn = $('#mSave');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      const d = await PATCH('/api/social?action=me', {
        avatar_emoji: $('#mAvatar').value,
        bio: $('#mBio').value
      });
      if (!d.ok) { alert('保存失败：' + (d.error || '')); btn.disabled = false; btn.textContent = '保存'; return; }
      location.reload();
    } catch (e) {
      alert('保存失败：' + e.message);
      btn.disabled = false; btn.textContent = '保存';
    }
  });
}

function openChangePwModal() {
  const old = $('#changePwBackdrop');
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
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  $('#cpClose').addEventListener('click', close);
  $('#cpCancel').addEventListener('click', close);
  $('#cpSave').addEventListener('click', async () => {
    const oldPw = $('#cpOld').value;
    const newPw = $('#cpNew').value;
    const newPw2 = $('#cpNew2').value;
    const msgEl = $('#cpMsg');
    msgEl.textContent = '';
    msgEl.className = 'modal-msg-inline';
    if (!oldPw || !newPw || !newPw2) { msgEl.textContent = '所有字段必填'; msgEl.classList.add('error'); return; }
    if (newPw.length < 8) { msgEl.textContent = '新密码至少 8 位'; msgEl.classList.add('error'); return; }
    if (newPw !== newPw2) { msgEl.textContent = '两次新密码不一致'; msgEl.classList.add('error'); return; }
    const saveBtn = $('#cpSave');
    saveBtn.disabled = true; saveBtn.textContent = '保存中…';
    try {
      const d = await POST('/api/init?action=player-change-password', {
        old_password: oldPw, new_password: newPw
      });
      if (!d.ok) throw new Error(d.error || '保存失败');
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

export function setProfile(p) { _profile = p; }
export function setSelf(s) { _isSelf = s; }
