// v44 重写: 公告 tab (super only)
// v50-N6 B6: i18n 化
import { $, esc, fmt, GET, POST, DELETE as DEL, safeRender, cacheClear, t } from '../core.js?v=v46-fix-modules';

export async function renderAnnouncements() {
  await safeRender(async () => {
    // 拉所有公告 (公开端点即可)
    const d = await GET('/api/announcements');
    const list = d.announcements || [];
    const box = $('#annList'), empty = $('#annEmpty');
    if (!list.length) { box.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';
    box.innerHTML = list.map(a => `
      <article class="msg-item" data-id="${a.id}">
        <div class="msg-head"><div class="msg-head-left">
          ${a.id === 1 ? `<span class="msg-unread-tag">${t('admin.ann.latest', '最新')}</span>` : ''}
          <b class="msg-name">📢 ${esc(a.title)}</b>
        </div><div class="msg-time">${fmt(a.created_at)}${a.updated_at ? ' · <span style="color:#a6a">' + t('admin.ann.edited', '已编辑') + '</span>' : ''}</div></div>
        <div class="msg-content">${esc(a.content.slice(0, 200))}${a.content.length > 200 ? '…' : ''}</div>
        <div class="msg-actions book-actions">
          <button class="btn btn-primary btn-sm" data-act="edit">✎ ${t('admin.ann.btn.edit', '编辑')}</button>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">${t('admin.ann.btn.delete', '删除')}</button>
        </div>
      </article>
    `).join('');
    box.querySelectorAll('.msg-item').forEach(el => {
      const id = +el.dataset.id;
      const a = list.find(x => x.id === id);
      el.querySelector('[data-act="edit"]').onclick = () => annEdit(a);
      el.querySelector('[data-act="del"]').onclick = () => annDel(id);
    });
  });
}

export function annEdit(a) {
  let bd = document.getElementById('annEditBackdrop');
  if (bd) bd.remove();
  bd = document.createElement('div');
  bd.id = 'annEditBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  const isNew = !a;
  const newL = t('admin.ann.new', '📢 新公告');
  const editL = t('admin.ann.edit', '✎ 编辑公告');
  const titleL = t('admin.ann.titleLabel', '标题 * (2-80 字)');
  const imgL = t('admin.ann.imgLabel', '封面图 URL (可选, https:// 或 data:image/ 开头)');
  const contentL = t('admin.ann.contentLabel', '内容 * (2-2000 字)');
  const cancelL = t('common.cancel', '取消');
  const publishL = t('admin.ann.publish', '发布');
  const saveL = t('admin.kart.save', '保存');
  bd.innerHTML = `
    <div style="background:#fff;border:3px solid #000;box-shadow:6px 6px 0 #000;padding:24px;max-width:640px;width:100%">
      <h3 style="margin:0 0 12px">${isNew ? newL : editL}</h3>
      <div style="display:grid;gap:10px">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>${titleL}</span><input id="annTitle" type="text" maxlength="80" value="${esc(a?.title || '')}" style="padding:6px 8px;border:1px solid #888">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>${imgL}</span>
          <input id="annImg" type="text" value="${esc(a?.image_url || '')}" style="padding:6px 8px;border:1px solid #888">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>${contentL}</span>
          <textarea id="annContent" rows="10" style="padding:8px;border:1px solid #888;font-family:inherit">${esc(a?.content || '')}</textarea>
        </label>
      </div>
      <div id="annMsg" style="font-size:12px;margin-top:8px;min-height:18px;color:#c33"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button id="annCancel" style="background:#888;color:#fff;border:none;padding:8px 16px;cursor:pointer">${cancelL}</button>
        <button id="annSave" style="background:#6cf;color:#000;border:none;padding:8px 16px;cursor:pointer;font-weight:bold">${isNew ? publishL : saveL}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#annCancel').onclick = close;
  bd.querySelector('#annSave').onclick = async () => {
    const title = bd.querySelector('#annTitle').value.trim();
    const content = bd.querySelector('#annContent').value.trim();
    const image_url = bd.querySelector('#annImg').value.trim();
    if (title.length < 2 || content.length < 2) { bd.querySelector('#annMsg').textContent = t('admin.ann.empty', '标题/内容不能为空'); return; }
    try {
      const body = { title, content, image_url };
      if (isNew) await POST('/api/init?action=announcement-create', body);
      else await POST('/api/init?action=announcement-update&id=' + a.id, body);
      cacheClear('announcements:');
      close();
      renderAnnouncements();
    } catch (e) { bd.querySelector('#annMsg').textContent = t('admin.ann.saveFail', '保存失败: ') + e.message; }
  };
}
export async function annDel(id) {
  if (!confirm(t('admin.ann.confirmDel', '删除该公告？'))) return;
  try {
    await DEL('/api/init?action=announcement-delete&id=' + id);
    cacheClear('announcements:');
    renderAnnouncements();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
