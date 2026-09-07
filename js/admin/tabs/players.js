// v44 重写: 玩家管理 tab (renderPlayers, playerAction, createPlayerModal)
// v50-N6 B6: i18n 化
import { $, esc, fmt, GET, POST, PATCH, safeRender, cacheClear, STATUS_LABEL, fileToDataURLP, t } from '../core.js?v=v46-fix-modules';

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
        : '<i style="color:#aaa">' + t('admin.players.neverLogin') + '</i>';
      const regL = t('admin.players.regDate');
      const activeL = t('admin.players.lastActive');
      const bioL = p.bio ? esc(p.bio) : '<i>' + t('admin.players.noBio') + '</i>';
      return `<article class="msg-item" data-id="${p.id}">
        <div class="msg-head"><div class="msg-head-left">
          <input type="checkbox" class="pk-check" data-id="${p.id}" />
          <b class="msg-name">${esc(p.avatar_emoji || '👤')} ${esc(p.username)}</b>
          <span style="color:var(--c-stone-dark);font-size:12px;margin-left:6px">${esc(p.email)}</span>
          <span class="msg-player-tag">${STATUS_LABEL[p.status] || p.status}</span>
          ${p.game_id ? `<span class="gallery-num" title="游戏ID" style="margin-left:4px">🎮 ${esc(p.game_id)}</span>` : ''}
        </div><div class="msg-time">${regL}${fmt(p.created_at)}</div></div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--c-stone-dark);padding:4px 0 2px">
          <span title="注册时间">📅 ${regL}${fmt(p.created_at)}</span>
          <span title="最后活跃">🕒 ${activeL}${lastSession}</span>
        </div>
        <p class="msg-content" style="font-size:13px;color:var(--c-stone-dark);margin:6px 0">${bioL}</p>
        <div class="msg-actions book-actions">
          ${isPending ? `<button class="btn btn-primary btn-sm" data-act="approve">${t('admin.players.approve')}</button><button class="btn btn-ghost btn-sm btn-danger" data-act="reject">${t('admin.players.reject')}</button>` : ''}
          ${!isPending ? `<button class="btn btn-ghost btn-sm" data-act="reset-pw">${t('admin.players.resetPw')}</button>` : ''}
          ${isActive ? `<button class="btn btn-ghost btn-sm btn-danger" data-act="reject">${t('admin.players.changeReject')}</button>` : ''}
          ${isRejected ? `<button class="btn btn-ghost btn-sm" data-act="approve">${t('admin.players.changeApprove')}</button>` : ''}
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
      el.querySelector('.pk-check')?.addEventListener('change', updateBatchBar);
    });
    // v50-N6: 导出当前 filter 后的玩家列表
    document.getElementById('playerExport')?.addEventListener('click', () => exportPlayersCsv(shown));
    // v50-N6: 批量操作
    document.getElementById('playerSelectAll')?.addEventListener('change', e => {
      const checked = e.target.checked;
      document.querySelectorAll('.pk-check').forEach(cb => cb.checked = checked);
      updateBatchBar();
    });
    document.getElementById('playerBatchApprove')?.addEventListener('click', () => batchAction('approve'));
    document.getElementById('playerBatchReject')?.addEventListener('click', () => batchAction('reject'));
    document.getElementById('playerBatchClear')?.addEventListener('click', () => {
      document.querySelectorAll('.pk-check').forEach(cb => cb.checked = false);
      const sa = document.getElementById('playerSelectAll'); if (sa) sa.checked = false;
      updateBatchBar();
    });
    updateBatchBar();
  });
}

// v50-N6: 批量操作 — 选中后更新工具条显示 + 计数
function updateBatchBar() {
  const checked = Array.from(document.querySelectorAll('.pk-check:checked'));
  const bar = document.getElementById('playerBatchBar');
  const cnt = document.getElementById('playerBatchCount');
  if (!bar || !cnt) return;
  cnt.textContent = String(checked.length);
  bar.style.display = checked.length ? 'flex' : 'none';
}

// v50-N6: 批量 approve / reject — 并发跑, 单个失败不阻断其他
async function batchAction(act) {
  const ids = Array.from(document.querySelectorAll('.pk-check:checked')).map(cb => +cb.dataset.id);
  if (!ids.length) return;
  const actName = act === 'approve' ? t('admin.players.batch.approveName', '批准') : t('admin.players.batch.rejectName', '拒绝');
  if (!confirm(t('admin.players.batch.confirm', '确认批量{act} {n} 个玩家？').replace('{act}', actName).replace('{n}', String(ids.length)))) return;
  const results = await Promise.allSettled(ids.map(id => PATCH('/api/admin/players?id=' + id + '&action=' + act)));
  const ok = results.filter(r => r.status === 'fulfilled').length;
  const fail = results.length - ok;
  if (window._toast) window._toast(
    (ok > 0 ? `✓ ${t('admin.players.batch.successUnit', '已')} ${actName} ${ok} ` : '') +
    (fail > 0 ? ` ✗ ${fail} ${t('admin.players.batch.failUnit', '失败')}` : ''),
    fail > 0 && ok === 0 ? 'error' : (fail > 0 ? 'info' : 'success')
  );
  cacheClear('players:');
  renderPlayers();
}

// v50-N6: 玩家列表导出 CSV (与 ticket 导出同 pattern)
function exportPlayersCsv(list) {
  if (!list || !list.length) {
    if (window._toast) window._toast(t('admin.players.toast.exportEmpty', '当前列表为空，无可导出数据'), 'info');
    return;
  }
  const headers = ['ID', 'Username', 'Email', 'Game ID', 'Status', 'Created', 'Last Session', 'Bio'];
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const STATUS_EN = { pending: 'Pending', active: 'Active', rejected: 'Rejected' };
  const rows = list.map(p => [
    p.id,
    p.username || '',
    p.email || '',
    p.game_id || '',
    STATUS_EN[p.status] || p.status || '',
    (p.created_at || '').slice(0, 19).replace('T', ' '),
    (p.last_session || '').slice(0, 19).replace('T', ' '),
    (p.bio || '').replace(/\n/g, ' '),
  ].map(esc).join(','));
  const csv = '\ufeff' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `players-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (window._toast) window._toast(t('admin.players.toast.exported', '已导出') + ` ${list.length} ` + t('admin.players.toast.exportedUnit', '名玩家'), 'success');
}

export async function playerAction(id, act) {
  try {
    await PATCH('/api/admin/players?id=' + id + '&action=' + act);
    cacheClear('players:');
    renderPlayers();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export async function playerResetPw(id) {
  const newPw = prompt(t('admin.players.pwPrompt'));
  if (!newPw || newPw.length < 8) { if (window._toast) window._toast(t('admin.players.pwMin'), 'error'); return; }
  try {
    await PATCH('/api/admin/players?id=' + id + '&action=reset', { new_password: newPw });
    if (window._toast) window._toast(t('admin.players.pwReset'), 'success');
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
      <h3 style="margin:0 0 6px;color:#000;font-size:17px;">🆕 ${t('admin.players.createTitle')}</h3>
      <p style="color:#888;font-size:12px;margin:0 0 14px;line-height:1.5">
        ${t('admin.players.createDesc')}
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
