// v44 重写: 市民留言 tab (renderMessages, msgAction, reply modal)
// 替换 admin.v2551.js 里 renderMessages (L420-486) + msgAction/L491-505 + openReply/showReplyModal
import { $, $$, esc, fmt, GET, PATCH, DEL, safeRender, cacheClear } from '../core.js';

export async function renderMessages() {
  await safeRender(async () => {
    const d = await GET('/api/admin/messages');
    const all = d.messages || [];
    const cAll = all.length;
    const cNew = all.filter(m => m.status === 'new').length;
    $('#cntAll').textContent = cAll;
    $('#cntUnread').textContent = cNew;
    $('#cntRead').textContent = cAll - cNew;
    $('#msgUnread').textContent = cNew > 0 ? `(${cNew})` : '';

    // 筛选 + 搜索
    const filter = (document.querySelector('input[name="msgFilter"]:checked') || {}).value || 'all';
    const searchQ = ($('#msgSearch')?.value || '').trim().toLowerCase();
    const typeFilter = $('#msgTypeFilter')?.value || '';
    let list = all;
    if (searchQ) {
      list = list.filter(m =>
        (m.content || '').toLowerCase().includes(searchQ) ||
        (m.name || '').toLowerCase().includes(searchQ) ||
        (m.contact || '').toLowerCase().includes(searchQ)
      );
    }
    if (typeFilter) list = list.filter(m => m.type === typeFilter);
    if (filter === 'unread') list = list.filter(m => m.status === 'new');
    if (filter === 'read') list = list.filter(m => m.status !== 'new');

    const box = $('#msgList'), empty = $('#msgEmpty');
    if (!list.length) { box.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';

    box.innerHTML = list.map(m => {
      const hasReply = m.admin_reply && m.admin_reply.length > 0;
      const isAiReply = hasReply && m.admin_reply.startsWith('🤖');
      const previousReply = m.previous_reply || '';
      const hasPreviousAi = previousReply.length > 0;
      // 状态标签
      let chainTag;
      if (!hasReply) {
        chainTag = '<span class="msg-replied-tag" style="background:#3a2a1a;color:#fc6;border-color:#c84;">⏳ 待回复</span>';
      } else if (hasPreviousAi) {
        chainTag = '<span class="msg-replied-tag" style="background:#1a1a3a;color:#9cf;border-color:#66f;" title="AI 先自动回复，后被管理员覆盖">🤖→💬 已被人工覆盖</span>';
      } else if (isAiReply) {
        chainTag = '<span class="msg-replied-tag" style="background:#1a3a1a;color:#9f9;border-color:#6f6;">🤖 AI 已回复</span>';
      } else {
        chainTag = '<span class="msg-replied-tag" style="background:#1a2a3a;color:#9cf;border-color:#6cf;">💬 人工已回复</span>';
      }
      // AI 原回复折叠
      const previousAiBox = hasPreviousAi
        ? `<div class="msg-prev-ai"><details><summary>📋 查看 AI 原回复（已被人工覆盖）</summary><div class="msg-prev-ai-body">${esc(previousReply)}</div></details></div>` : '';
      const chainLine = hasPreviousAi
        ? `<div class="msg-chain-line">📋 回复历程：${esc(previousReply).slice(0, 30)}${previousReply.length > 30 ? '…' : ''} → 人工覆盖 → 现回复</div>` : '';

      return `<article class="msg-item ${m.status !== 'new' ? 'is-read' : ''}" data-id="${m.id}">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">👤 ${esc(m.name)}${m.contact ? ' · ' + esc(m.contact) : ''}</b>
          ${m.player_username ? `<span class="msg-player-tag">@${esc(m.player_username)}</span>` : ''}
          ${m.status === 'done' ? '<span class="msg-read-tag">已处理</span>' : m.status !== 'new' ? '<span class="msg-read-tag">已读</span>' : '<span class="msg-unread-tag">新</span>'}
          ${chainTag}
        </div><div class="msg-time">${fmt(m.created_at)}</div></div>
        <div class="msg-content">${esc(m.content)}</div>
        ${hasReply ? `<div class="msg-reply-box"><b>📣 市政厅回复：</b><div>${esc(m.admin_reply)}</div><small>${fmt(m.replied_at)}</small></div>` : ''}
        ${chainLine}
        ${previousAiBox}
        <div class="msg-actions book-actions">
          <button class="btn btn-primary btn-sm" data-act="reply">${hasReply ? '✎ 编辑回复' : '💬 回复'}</button>
          ${m.status === 'done' ? '' : '<button class="btn btn-ghost btn-sm" data-act="done">标为已处理</button>'}
          <button class="btn btn-ghost btn-sm" data-act="toggle">${m.status !== 'new' && m.status !== 'done' ? '标为未读' : '标为已读'}</button>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
    }).join('');

    box.querySelectorAll('.msg-item').forEach(el => {
      const id = +el.dataset.id;
      el.querySelector('[data-act="reply"]').onclick = () => openReply(id);
      el.querySelector('[data-act="done"]')?.addEventListener('click', () => msgAction(id, 'done'));
      el.querySelector('[data-act="toggle"]').onclick = () => msgToggle(id);
      el.querySelector('[data-act="del"]').onclick = () => msgDel(id);
    });
  });
}

export async function msgAction(id, status) {
  try {
    await PATCH('/api/admin/messages?id=' + id + '&status=' + status);
    cacheClear('messages:');
    renderMessages();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export async function msgToggle(id) {
  try {
    const d = await GET('/api/admin/messages');
    const m = (d.messages || []).find(x => x.id === id);
    if (!m) return;
    const next = m.status === 'new' ? 'read' : 'new';
    await PATCH('/api/admin/messages?id=' + id + '&status=' + next);
    cacheClear('messages:');
    renderMessages();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export async function msgDel(id) {
  if (!confirm('删除该留言？')) return;
  try {
    await DEL('/api/admin/messages?id=' + id);
    cacheClear('messages:');
    renderMessages();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export function openReply(id) {
  GET('/api/admin/messages').then(d => {
    const m = (d.messages || []).find(x => x.id === id);
    if (m) showReplyModal(m);
  });
}
export function showReplyModal(m) {
  // 创建/复用模态
  let bd = document.getElementById('replyBackdrop');
  if (!bd) {
    bd = document.createElement('div');
    bd.id = 'replyBackdrop';
    document.body.appendChild(bd);
  }
  bd.innerHTML = `
    <div class="modal-mask" style="display:flex;align-items:center;justify-content:center">
      <div class="modal" style="max-width:560px;width:90%">
        <div class="modal-head">
          <h3 id="replyTitle">回复留言</h3>
          <button class="modal-close" id="replyClose">✕</button>
        </div>
        <div class="modal-body">
          <div class="reply-msg-preview" id="replyPreview"></div>
          <label class="form-row"><span class="label-text">回复内容</span>
            <textarea id="replyContent" rows="6" placeholder="回复市民..."></textarea>
          </label>
          <div class="modal-msg" id="replyMsg"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-sm" id="replyCancel">取消</button>
          <button class="btn btn-primary btn-sm" id="replySave">💬 保存回复</button>
        </div>
      </div>
    </div>`;
  bd.querySelector('#replyTitle').textContent = m.admin_reply ? '编辑回复' : '回复留言';
  bd.querySelector('#replyPreview').innerHTML = `
    <div class="reply-meta">👤 ${esc(m.name)}${m.contact ? ' · ' + esc(m.contact) : ''} · ${fmt(m.created_at)}</div>
    <div class="reply-content">${esc(m.content)}</div>
    ${m.admin_reply ? `<div class="reply-existing">📣 当前回复: ${esc(m.admin_reply)}</div>` : ''}
  `;
  bd.querySelector('#replyContent').value = m.admin_reply || '';
  bd.querySelector('#replyMsg').textContent = '';
  const close = () => bd.remove();
  bd.querySelector('#replyClose').onclick = close;
  bd.querySelector('#replyCancel').onclick = close;
  bd.querySelector('#replySave').onclick = async () => {
    const content = bd.querySelector('#replyContent').value.trim();
    if (!content) { bd.querySelector('#replyMsg').textContent = '内容不能为空'; return; }
    try {
      await PATCH('/api/admin/messages?id=' + m.id, { admin_reply: content });
      cacheClear('messages:');
      close();
      renderMessages();
    } catch (e) { bd.querySelector('#replyMsg').textContent = '保存失败: ' + e.message; }
  };
  setTimeout(() => bd.querySelector('#replyContent').focus(), 50);
}
