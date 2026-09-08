// v44 重写: 管理员账号 tab (v50-N6: 全 i18n)
import { $, esc, GET, POST, PATCH, DEL, safeRender, cacheClear } from '../core.js?v=v46-fix-modules';
import { t } from '../../i18n/core.js?v=n5';

export async function renderAdminList() {
  await safeRender(async () => {
    const d = await GET('/api/admin/admins');
    const list = d.admins || [];
    const box = $('#adminList'), empty = $('#adminListEmpty');
    if (!list.length) { box.innerHTML = ''; box.style.display = 'none'; empty.style.display = 'flex'; return; }
    box.style.display = '';
    empty.style.display = 'none';
    box.innerHTML = list.map(a => {
      const isSuper = a.role === 'super';
      const linked = a.linked_player_username
        ? `@${esc(a.linked_player_username)}`
        : t('admin.admins.unlinked');
      return `<article class="msg-item" data-id="${a.id}">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">🛡️ ${esc(a.username)}</b>
          <span class="msg-player-tag">${isSuper ? t('admin.admins.role.super') : t('admin.admins.role.admin')}</span>
          ${a.linked_player_id ? `<span class="gallery-num" style="margin-left:6px">${linked}</span>` : ''}
        </div><div class="msg-time">${t('admin.admins.registered')}: ${esc(a.created_at || '—')}</div></div>
        <div class="msg-actions book-actions">
          <button class="btn btn-primary btn-sm" data-act="reset">🔑 ${t('admin.admins.resetPw')}</button>
          ${a.linked_player_id
            ? `<button class="btn btn-ghost btn-sm btn-danger" data-act="unlink">🚫 ${t('admin.admins.unlink')}</button>`
            : `<button class="btn btn-ghost btn-sm" data-act="link">🔗 ${t('admin.admins.link')}</button>`}
          ${isSuper ? '' : `<button class="btn btn-ghost btn-sm btn-danger" data-act="del">${t('admin.admins.delete')}</button>`}
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el => {
      const id = +el.dataset.id;
      el.querySelector('[data-act="reset"]').onclick = () => adminReset(id);
      el.querySelector('[data-act="del"]')?.addEventListener('click', () => adminDel(id));
      el.querySelector('[data-act="link"]')?.addEventListener('click', () => adminLink(id));
      el.querySelector('[data-act="unlink"]')?.addEventListener('click', () => adminDel(id, 'unlink', list.find(a => a.id === id)?.linked_player_id));
    });
  });
}

export async function adminReset(id) {
  const newPw = prompt(t('admin.admins.resetPw.prompt', '输入新密码 (至少 8 位):'));
  if (!newPw || newPw.length < 8) {
    if (window._toast) window._toast(t('admin.admins.pwMin', '密码至少 8 位'), 'error');
    return;
  }
  try {
    await PATCH('/api/admin/admins?id=' + id, { new_password: newPw });
    if (window._toast) window._toast(t('admin.admins.resetPw.success', '密码已重置'), 'success');
  } catch (e) { if (window._toast) window._toast(t('admin.admins.fail', '失败') + ': ' + e.message, 'error'); }
}
export async function adminDel(id, kind, playerId) {
  if (kind === 'unlink') {
    if (!confirm(t('admin.admins.unlink.confirm', '解绑该玩家？'))) return;
    try {
      await POST('/api/init?action=admin-unmerge-account', { admin_id: id, player_id: playerId });
      cacheClear('admins:');
      renderAdminList();
    } catch (e) { if (window._toast) window._toast(t('admin.admins.fail', '失败') + ': ' + e.message, 'error'); }
    return;
  }
  if (!confirm(t('admin.admins.delete.confirm', '删除该管理员？'))) return;
  try {
    await DEL('/api/admin/admins?id=' + id);
    cacheClear('admins:');
    renderAdminList();
  } catch (e) { if (window._toast) window._toast(t('admin.admins.fail', '失败') + ': ' + e.message, 'error'); }
}
export function adminLink(id) {
  const pid = prompt(t('admin.admins.link.prompt', '输入要绑定的玩家 ID:'));
  if (!pid) return;
  const pId = parseInt(pid, 10);
  if (!pId) return;
  showMergePlayerModal(id, pId);
}
export function showMergePlayerModal(adminId, playerId) {
  const msg = t('admin.admins.merge.confirm', '确认将管理员 #{adminId} 绑定到玩家 #{playerId}?')
    .replace('#{adminId}', adminId)
    .replace('#{playerId}', playerId);
  if (!confirm(msg)) return;
  POST('/api/init?action=admin-merge-account', { admin_id: adminId, player_id: playerId })
    .then(() => { cacheClear('admins:'); renderAdminList(); })
    .catch(e => { if (window._toast) window._toast(t('admin.admins.fail', '失败') + ': ' + e.message, 'error'); });
}
