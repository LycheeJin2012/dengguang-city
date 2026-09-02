// v47: 工单 tab (admin 后台统一入口, 替代原 messages/license/bookings 3 个 tab)
// 列表支持按 category / status 过滤, 状态切换/回复/派单
import { $, esc, fmt, GET, PATCH, safeRender, cacheClear } from '../core.js?v=v46-fix-modules';

const CAT_LABEL = {
  message: '💬 留言',
  comment: '💭 评论',
  license: '🚗 驾照',
  hotel: '🏨 酒店',
  race: '🏁 赛车',
  kart: '🛞 卡丁车',
  service: '🛎️ 服务',
};
const STATUS_LABEL = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};
const PRIORITY_LABEL = {
  low: '低', normal: '普通', high: '高', urgent: '紧急',
};
const PRIORITY_COLOR = {
  low: '#888', normal: '#3a7ad9', high: '#ffaa00', urgent: '#ff2a2a',
};

let _allAdmins = [];

export async function renderTickets() {
  await safeRender(async () => {
    const cat = $('#ticketCat')?.value || '';
    const status = $('#ticketStatus')?.value || '';
    const q = ($('#ticketSearch')?.value || '').trim();

    const params = new URLSearchParams();
    if (cat) params.set('category', cat);
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    params.set('limit', '200');
    const d = await GET('/api/tickets?' + params.toString());
    const list = d.tickets || [];
    const summary = d.summary || { total_open: 0, by_category: {} };

    // 刷新顶 tab 角标 (sum by_category)
    for (const [c, s] of Object.entries(summary.by_category || {})) {
      const el = document.getElementById('ticketCount_' + c);
      if (el) el.textContent = (s.open || 0) + (s.in_progress || 0) > 0
        ? `(${s.open + s.in_progress})` : '';
    }
    const totalEl = $('#ticketTotalBadge');
    if (totalEl) totalEl.textContent = summary.total_open > 0 ? `(${summary.total_open})` : '';

    const box = $('#ticketList'), empty = $('#ticketEmpty');
    if (!list.length) {
      box.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';

    box.innerHTML = list.map(t => {
      const catL = CAT_LABEL[t.category] || t.category;
      const statusL = STATUS_LABEL[t.status] || t.status;
      const priL = PRIORITY_LABEL[t.priority] || t.priority;
      const priC = PRIORITY_COLOR[t.priority] || '#888';
      const avatar = t.avatar_emoji || '👤';
      const playerTag = t.player_username ? `@${esc(t.player_username)}` : '<span style="color:#999">匿名</span>';
      // 解析 body 快照 (可能是 JSON)
      let bodyHtml = '';
      try {
        const parsed = JSON.parse(t.body);
        if (typeof parsed === 'object' && parsed) {
          bodyHtml = '<div class="ticket-body-kv">' +
            Object.entries(parsed).map(([k, v]) =>
              `<span class="ticket-k"><b>${esc(k)}:</b> ${esc(String(v ?? '—'))}</span>`
            ).join('') + '</div>';
        } else { bodyHtml = esc(String(parsed)); }
      } catch (e) { bodyHtml = esc(t.body || ''); }
      return `<article class="ticket-item ticket-${t.status}" data-id="${t.id}">
        <div class="ticket-head">
          <div class="ticket-head-left">
            <b class="ticket-title">${catL} · ${esc(t.title)}</b>
            <span class="ticket-player">${playerTag} <span class="ticket-avatar">${avatar}</span></span>
          </div>
          <div class="ticket-head-right">
            <span class="ticket-prio" style="background:${priC};color:#fff">${priL}</span>
            <span class="ticket-status ticket-status-${t.status}">${statusL}</span>
            <span class="ticket-time">${fmt(t.created_at)}</span>
          </div>
        </div>
        <div class="ticket-body">${bodyHtml}</div>
        ${t.admin_reply ? `<div class="ticket-reply-box"><b>💬 管理员回复:</b> <div>${esc(t.admin_reply)}</div><small>${fmt(t.replied_at)} · @${esc(t.assignee_username || '—')}</small></div>` : ''}
        <div class="ticket-meta">
          <span>📂 ${esc(t.source_table || '—')}${t.source_id ? '#' + t.source_id : ''}</span>
          <span>👤 派单: ${t.assignee_username ? '@' + esc(t.assignee_username) : '—'}</span>
        </div>
        <div class="ticket-actions book-actions">
          <button class="btn btn-primary btn-sm" data-act="reply">${t.admin_reply ? '✎ 编辑回复' : '💬 回复'}</button>
          ${t.status !== 'in_progress' && t.status !== 'closed' ? '<button class="btn btn-ghost btn-sm" data-act="progress">→ 处理中</button>' : ''}
          ${t.status !== 'closed' ? '<button class="btn btn-ghost btn-sm" data-act="close">关闭</button>' : ''}
          ${t.status === 'closed' || t.status === 'resolved' ? '<button class="btn btn-ghost btn-sm" data-act="reopen">↺ 重新打开</button>' : ''}
          <button class="btn btn-ghost btn-sm" data-act="assignee">👤 派单</button>
        </div>
      </article>`;
    }).join('');

    box.querySelectorAll('.ticket-item').forEach(el => {
      const id = +el.dataset.id;
      el.querySelector('[data-act="reply"]').onclick = () => openReply(id, list);
      el.querySelector('[data-act="progress"]')?.addEventListener('click', () => updateStatus(id, 'in_progress'));
      el.querySelector('[data-act="close"]')?.addEventListener('click', () => updateStatus(id, 'closed'));
      el.querySelector('[data-act="reopen"]')?.addEventListener('click', () => updateStatus(id, 'open'));
      el.querySelector('[data-act="assignee"]').onclick = () => openAssignee(id, list);
    });
  });
}

async function updateStatus(id, status) {
  try {
    await PATCH('/api/tickets?id=' + id, { status });
    if (window._toast) window._toast('已更新为 ' + (STATUS_LABEL[status] || status), 'success');
    renderTickets();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}

function openReply(id, list) {
  const t = list.find(x => x.id === id);
  if (!t) return;
  const old = document.getElementById('ticketReplyBackdrop');
  if (old) old.remove();
  const bd = document.createElement('div');
  bd.id = 'ticketReplyBackdrop';
  bd.className = 'modal-mask';
  bd.innerHTML = `
    <div class="modal" style="max-width:600px">
      <div class="modal-head">
        <h3>💬 回复工单 #${id}</h3>
        <button class="modal-close" id="tktClose">✕</button>
      </div>
      <div class="modal-body">
        <p style="margin:0 0 12px 0;color:var(--c-stone-dark)">${esc(t.title)}</p>
        <textarea id="tktReply" rows="5" style="width:100%;padding:8px;border:2px solid var(--c-stone);font-family:inherit;font-size:14px" placeholder="回复内容...">${esc(t.admin_reply || '')}</textarea>
        <p style="font-size:12px;color:var(--c-stone);margin-top:4px">回复后自动将状态改为"已解决"</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="tktCancel">取消</button>
        <button class="btn btn-primary" id="tktSubmit">提交</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('#tktClose').onclick = close;
  bd.querySelector('#tktCancel').onclick = close;
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#tktSubmit').onclick = async () => {
    const text = (bd.querySelector('#tktReply').value || '').trim();
    if (!text) { if (window._toast) window._toast('回复内容不能为空', 'error'); return; }
    try {
      await PATCH('/api/tickets?id=' + id, { admin_reply: text });
      if (window._toast) window._toast('已回复', 'success');
      close();
      renderTickets();
    } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
  };
  setTimeout(() => bd.querySelector('#tktReply')?.focus(), 50);
}

async function openAssignee(id, list) {
  // 简化: 让 admin 输入 assignee_id (后续可改成下拉选 admin)
  const t = list.find(x => x.id === id);
  if (!t) return;
  const input = prompt(`派单给 admin (输入 admin id, 留空取消派单):\n当前: ${t.assignee_username || '—'}`,
    t.assignee_id ? String(t.assignee_id) : '');
  if (input === null) return;
  const aid = parseInt(input, 10) || null;
  try {
    await PATCH('/api/tickets?id=' + id, { assignee_id: aid });
    if (window._toast) window._toast('已更新派单', 'success');
    renderTickets();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
