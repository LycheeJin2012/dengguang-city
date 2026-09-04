// v44 重写: 管理员账号 tab
import { $, esc, GET, POST, PATCH, DEL, safeRender, cacheClear } from '../core.v50.js?v=v50-fix';

export async function renderAdminList() {
  await safeRender(async () => {
    const d = await GET('/api/admin/admins');
    const list = d.admins || [];
    const box = $('#adminList'), empty = $('#adminListEmpty');
    if (!list.length) { box.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';
    box.innerHTML = list.map(a => {
      const isSuper = a.role === 'super';
      const linked = a.linked_player_username ? `@${esc(a.linked_player_username)}` : '未绑玩家';
      return `<article class="msg-item" data-id="${a.id}">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">🛡️ ${esc(a.username)}</b>
          <span class="msg-player-tag">${isSuper ? 'SUPER' : 'ADMIN'}</span>
          ${a.linked_player_id ? `<span class="gallery-num" style="margin-left:6px">${linked}</span>` : ''}
        </div><div class="msg-time">注册: ${esc(a.created_at || '—')}</div></div>
        <div class="msg-actions book-actions">
          <button class="btn btn-primary btn-sm" data-act="reset">🔑 重置密码</button>
          ${a.linked_player_id
            ? `<button class="btn btn-ghost btn-sm btn-danger" data-act="unlink">🚫 解绑玩家</button>`
            : `<button class="btn btn-ghost btn-sm" data-act="link">🔗 绑玩家</button>`}
          ${isSuper ? '' : `<button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>`}
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el => {
      const id = +el.dataset.id;
      el.querySelector('[data-act="reset"]').onclick = () => adminReset(id);
      el.querySelector('[data-act="del"]')?.addEventListener('click', () => adminDel(id));
      el.querySelector('[data-act="link"]')?.addEventListener('click', () => adminLink(id));
      el.querySelector('[data-act="unlink"]')?.addEventListener('click', () => adminDel(id, 'unlink'));
    });
  });
}

export async function adminReset(id) {
  const newPw = prompt('输入新密码 (至少 8 位):');
  if (!newPw || newPw.length < 8) { if (window._toast) window._toast('密码至少 8 位', 'error'); return; }
  try {
    await PATCH('/api/admin/admins?id=' + id, { new_password: newPw });
    if (window._toast) window._toast('密码已重置', 'success');
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export async function adminDel(id, kind) {
  if (kind === 'unlink') {
    // 解绑
    if (!confirm('解绑该管理员的关联玩家账号？')) return;
    try {
      await POST('/api/init?action=admin-unmerge-account', { admin_id: id, player_id: 0 });
      cacheClear('admins:');
      renderAdminList();
    } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
    return;
  }
  if (!confirm('删除该管理员账号？')) return;
  try {
    await DEL('/api/admin/admins?id=' + id);
    cacheClear('admins:');
    renderAdminList();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export function adminLink(id) {
  // 弹窗: 输入玩家 ID 绑到该 admin
  const pid = prompt('输入要绑定的玩家 ID:');
  if (!pid) return;
  const pId = parseInt(pid, 10);
  if (!pId) return;
  showMergePlayerModal(id, pId);
}
export function showMergePlayerModal(adminId, playerId) {
  if (!confirm(`绑定 admin #${adminId} ↔ player #${playerId}？合并后两边可互相登录。`)) return;
  POST('/api/init?action=admin-merge-account', { admin_id: adminId, player_id: playerId })
    .then(() => { cacheClear('admins:'); renderAdminList(); })
    .catch(e => { if (window._toast) window._toast('失败: ' + e.message, 'error'); });
}
