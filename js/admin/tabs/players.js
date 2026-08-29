// v44 重写: 玩家管理 tab (renderPlayers, playerAction, createPlayerModal)
import { $, esc, fmt, GET, POST, PATCH, safeRender, cacheClear, STATUS_LABEL, fileToDataURLP } from '../core.js?v=v46-fix-modules';

export async function renderPlayers() {
  await safeRender(async () => {
    const d = await GET('/api/admin/players');
    const list = d.players || [];
    const cP = list.filter(p => p.status === 'pending').length;
    const cA = list.filter(p => p.status === 'active').length;
    const cR = list.filter(p => p.status === 'rejected').length;
    $('#cntPlayerPending').textContent = cP;
    $('#cntPlayerActive').textContent = cA;
    $('#cntPlayerRejected').textContent = cR;
    $('#cntPlayerAll').textContent = list.length;
    $('#playerPending').textContent = cP > 0 ? `(${cP})` : '';

    const filter = (document.querySelector('input[name="playerFilter"]:checked') || {}).value || 'pending';
    let shown = list;
    if (filter !== 'all') shown = shown.filter(p => p.status === filter);

    const box = $('#playerList'), empty = $('#playerEmpty');
    if (!shown.length) { box.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';

    // 排序: pending 在前
    const _ord = { pending: 0, active: 1, rejected: 2 };
    shown = [...shown].sort((a, b) =>
      (_ord[a.status] ?? 9) - (_ord[b.status] ?? 9) || (b.id - a.id)
    );

    box.innerHTML = shown.map(p => {
      const isPending = p.status === 'pending';
      const isActive = p.status === 'active';
      const isRejected = p.status === 'rejected';
      const lastSession = p.last_session
        ? fmt(p.last_session)
        : '<i style="color:#aaa">从未登录</i>';
      return `<article class="msg-item" data-id="${p.id}">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">${esc(p.avatar_emoji || '👤')} ${esc(p.username)}</b>
          <span style="color:var(--c-stone-dark);font-size:12px;margin-left:6px">${esc(p.email)}</span>
          <span class="msg-player-tag">${STATUS_LABEL[p.status] || p.status}</span>
          ${p.game_id ? `<span class="gallery-num" title="游戏ID" style="margin-left:4px">🎮 ${esc(p.game_id)}</span>` : ''}
        </div><div class="msg-time">注册：${fmt(p.created_at)}</div></div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--c-stone-dark);padding:4px 0 2px">
          <span title="注册时间">📅 已注册：${fmt(p.created_at)}</span>
          <span title="最后活跃">🕒 最后活跃：${lastSession}</span>
        </div>
        <p class="msg-content" style="font-size:13px;color:var(--c-stone-dark);margin:6px 0">${p.bio ? esc(p.bio) : '<i>暂无简介</i>'}</p>
        <div class="msg-actions book-actions">
          ${isPending ? '<button class="btn btn-primary btn-sm" data-act="approve">✓ 批准</button><button class="btn btn-ghost btn-sm btn-danger" data-act="reject">✗ 拒绝</button>' : ''}
          ${!isPending ? '<button class="btn btn-ghost btn-sm" data-act="reset-pw">🔑 重置密码</button>' : ''}
          ${isActive ? '<button class="btn btn-ghost btn-sm btn-danger" data-act="reject">✗ 改为拒绝</button>' : ''}
          ${isRejected ? '<button class="btn btn-ghost btn-sm" data-act="approve">↻ 改为批准</button>' : ''}
        </div>
      </article>`;
    }).join('');

    box.querySelectorAll('.msg-item').forEach(el => {
      const id = +el.dataset.id;
      const p = shown.find(x => x.id === id);
      el.querySelector('[data-act="approve"]')?.addEventListener('click', () => playerAction(id, 'approve'));
      el.querySelector('[data-act="reject"]')?.addEventListener('click', () => playerAction(id, 'reject'));
      el.querySelector('[data-act="reset-pw"]')?.addEventListener('click', () => playerResetPw(id));
      el.querySelector('[data-act="rename"]')?.addEventListener('click', () => playerRename(id, p?.username));
    });
  });
}

export async function playerAction(id, act) {
  try {
    await PATCH('/api/admin/players?id=' + id + '&action=' + act);
    cacheClear('players:');
    renderPlayers();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export async function playerResetPw(id) {
  const newPw = prompt('输入新密码 (至少 8 位):');
  if (!newPw || newPw.length < 8) { if (window._toast) window._toast('密码至少 8 位', 'error'); return; }
  try {
    await PATCH('/api/admin/players?id=' + id + '&action=reset', { new_password: newPw });
    if (window._toast) window._toast('密码已重置', 'success');
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export async function playerRename(id, currentName) {
  const newName = prompt('改玩家账号名 (2-32 字符, 不含 @):', currentName);
  if (!newName || newName === currentName) return;
  try {
    await PATCH('/api/admin/players?id=' + id + '&action=rename', { new_username: newName });
    cacheClear('players:');
    renderPlayers();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export function showCreatePlayerModal() {
  // super 代注册
  if (!window._me || window._me.role !== 'super') return;
  const old = document.getElementById('createPlayerBackdrop');
  if (old) old.remove();
  const bd = document.createElement('div');
  bd.id = 'createPlayerBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  bd.innerHTML = `
    <div style="background:var(--c-cream,#f5e6c5);border:3px solid #000;box-shadow:6px 6px 0 #000;padding:24px;max-width:520px;width:100%">
      <h3 style="margin:0 0 6px;color:#000;font-size:17px;">🆕 代注册玩家账号</h3>
      <p style="color:#888;font-size:12px;margin:0 0 14px;line-height:1.5">
        由 super 管理员直接创建账号，无需玩家本人注册和审批。账号立即激活可用。
      </p>
      <div style="display:grid;gap:10px">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#333">
          <span>玩家用户名 * <small>(2-32 字符)</small></span>
          <input id="cpUser" type="text" placeholder="如：SIM_漫画家" style="padding:8px 10px;border:1px solid #444;background:#0f0f1a;color:#eee;border-radius:4px;font-family:inherit;font-size:14px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#333">
          <span>邮箱 *</span>
          <input id="cpEmail" type="email" placeholder="player@example.com" style="padding:8px 10px;border:1px solid #444;background:#0f0f1a;color:#eee;border-radius:4px;font-family:inherit;font-size:14px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#333">
          <span>游戏 ID (可选)</span>
          <input id="cpGame" type="text" placeholder="Minecraft 游戏内 ID" style="padding:8px 10px;border:1px solid #444;background:#0f0f1a;color:#eee;border-radius:4px;font-family:inherit;font-size:14px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#333">
          <span>初始密码 * <small>(至少 8 位)</small></span>
          <input id="cpPass" type="text" placeholder="可填临时密码" style="padding:8px 10px;border:1px solid #444;background:#0f0f1a;color:#eee;border-radius:4px;font-family:inherit;font-size:14px">
        </label>
      </div>
      <div id="cpMsg" style="font-size:12px;margin-top:8px;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button id="cpCancel" type="button" style="background:#555;color:#fff;border:none;padding:9px 16px;border-radius:4px;cursor:pointer;font-size:13px">取消</button>
        <button id="cpSave" type="button" style="background:#6cf;color:#000;border:none;padding:9px 16px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px">✓ 创建账号</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#cpCancel').onclick = close;
  setTimeout(() => bd.querySelector('#cpUser').focus(), 50);
  bd.querySelector('#cpSave').onclick = async () => {
    const username = bd.querySelector('#cpUser').value.trim();
    const email = bd.querySelector('#cpEmail').value.trim();
    const game_id = bd.querySelector('#cpGame').value.trim();
    const password = bd.querySelector('#cpPass').value.trim();
    if (!username || !email || !password) { bd.querySelector('#cpMsg').textContent = '请填必填项'; return; }
    try {
      await POST('/api/init?action=admin-player-create', { username, email, game_id, password });
      cacheClear('players:');
      close();
      renderPlayers();
    } catch (e) { bd.querySelector('#cpMsg').textContent = '创建失败: ' + e.message; }
  };
}
