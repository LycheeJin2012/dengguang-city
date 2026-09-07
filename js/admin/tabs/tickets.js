// v47: 工单 tab (admin 后台统一入口, 替代原 messages/license/bookings 3 个 tab)
// 列表支持按 category / status 过滤, 状态切换/回复/派单
// v50-N6 B6: i18n 化 (CAT/STATUS/PRIORITY 标签 + 按钮 + 弹窗 + toast)
import { $, esc, fmt, GET, PATCH, safeRender, cacheClear, t } from '../core.js?v=v46-fix-modules';

// 工厂函数（每次调用取当前语言，切换语言时自动生效）
function getCatLabel() {
  return {
    message: t('admin.ticket.cat.message'),
    comment: t('admin.ticket.cat.comment'),
    license: t('admin.ticket.cat.license'),
    hotel:  t('admin.ticket.cat.hotel'),
    race:    t('admin.ticket.cat.race'),
    kart:    t('admin.ticket.cat.kart'),
    service: t('admin.ticket.cat.service'),
  };
}
function getStatusLabel() {
  return {
    open:         t('admin.ticket.status.open'),
    in_progress:  t('admin.ticket.status.in_progress'),
    resolved:     t('admin.ticket.status.resolved'),
    closed:       t('admin.ticket.status.closed'),
  };
}
function getPriorityLabel() {
  return {
    low:    t('admin.ticket.priority.low'),
    normal: t('admin.ticket.priority.normal'),
    high:   t('admin.ticket.priority.high'),
    urgent: t('admin.ticket.priority.urgent'),
  };
}
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

    // 取当前语言标签
    const CAT_L   = getCatLabel();
    const STATUS_L = getStatusLabel();
    const PRIO_L  = getPriorityLabel();

    box.innerHTML = list.map(tk => {
      const catL    = CAT_L[tk.category]    || tk.category;
      const statusL = STATUS_L[tk.status]   || tk.status;
      const priL    = PRIO_L[tk.priority]   || tk.priority;
      const priC    = PRIORITY_COLOR[tk.priority] || '#888';
      const avatar  = tk.avatar_emoji || '👤';
      const anonL   = t('admin.ticket.anonymous');
      const playerTag = tk.player_username
        ? `@${esc(tk.player_username)}`
        : `<span style="color:#999">${anonL}</span>`;

      // 解析 body 快照 (可能是 JSON)
      let bodyHtml = '';
      try {
        const parsed = JSON.parse(tk.body);
        if (typeof parsed === 'object' && parsed) {
          bodyHtml = '<div class="ticket-body-kv">' +
            Object.entries(parsed).map(([k, v]) =>
              `<span class="ticket-k"><b>${esc(k)}:</b> ${esc(String(v ?? '—'))}</span>`
            ).join('') + '</div>';
        } else { bodyHtml = esc(String(parsed)); }
      } catch (e) { bodyHtml = esc(tk.body || ''); }

      const replyL = t('admin.ticket.btn.reply');
      const editL  = t('admin.ticket.btn.editReply');
      const progL  = t('admin.ticket.btn.progress');
      const closeL = t('admin.ticket.btn.close');
      const reopenL = t('admin.ticket.btn.reopen');
      const assignL = t('admin.ticket.btn.assign');
      const adminReplyL = t('admin.ticket.adminReply');
      const srcLabel = t('admin.ticket.sourceLabel');
      const asnLabel = t('admin.ticket.assignLabel');

      return `<article class="ticket-item ticket-${tk.status}" data-id="${tk.id}">
        <div class="ticket-head">
          <div class="ticket-head-left">
            <b class="ticket-title">${catL} · ${esc(tk.title)}</b>
            <span class="ticket-player">${playerTag} <span class="ticket-avatar">${avatar}</span></span>
          </div>
          <div class="ticket-head-right">
            <span class="ticket-prio" style="background:${priC};color:#fff">${priL}</span>
            <span class="ticket-status ticket-status-${tk.status}">${statusL}</span>
            <span class="ticket-time">${fmt(tk.created_at)}</span>
          </div>
        </div>
        <div class="ticket-body">${bodyHtml}</div>
        ${tk.admin_reply ? `<div class="ticket-reply-box"><b>💬 ${adminReplyL}:</b> <div>${esc(tk.admin_reply)}</div><small>${fmt(tk.replied_at)} · @${esc(tk.assignee_username || '—')}</small></div>` : ''}
        <div class="ticket-meta">
          <span>${srcLabel} ${esc(tk.source_table || '—')}${tk.source_id ? '#' + tk.source_id : ''}</span>
          <span>${asnLabel} ${tk.assignee_username ? '@' + esc(tk.assignee_username) : '—'}</span>
        </div>
        <div class="ticket-actions book-actions">
          <button class="btn btn-primary btn-sm" data-act="reply">${tk.admin_reply ? editL : replyL}</button>
          ${tk.status !== 'in_progress' && tk.status !== 'closed' ? `<button class="btn btn-ghost btn-sm" data-act="progress">${progL}</button>` : ''}
          ${tk.status !== 'closed' ? `<button class="btn btn-ghost btn-sm" data-act="close">${closeL}</button>` : ''}
          ${tk.status === 'closed' || tk.status === 'resolved' ? `<button class="btn btn-ghost btn-sm" data-act="reopen">${reopenL}</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-act="assignee">${assignL}</button>
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
    // v50-N6: 导出 CSV 按钮
    document.getElementById('ticketExport')?.addEventListener('click', () => exportTicketsCsv(list));
  });
}

async function updateStatus(id, status) {
  const STATUS_L = getStatusLabel();
  try {
    await PATCH('/api/tickets?id=' + id, { status });
    if (window._toast) window._toast(t('admin.ticket.toast.updated') + (STATUS_L[status] || status), 'success');
    renderTickets();
  } catch (e) { if (window._toast) window._toast(t('admin.ticket.toast.fail') + e.message, 'error'); }
}

function openReply(id, list) {
  const tk = list.find(x => x.id === id);
  if (!tk) return;
  const old = document.getElementById('ticketReplyBackdrop');
  if (old) old.remove();
  const bd = document.createElement('div');
  bd.id = 'ticketReplyBackdrop';
  bd.className = 'modal-mask';
  const modalTitle = t('admin.ticket.modal.replyTitle');
  const ph = t('admin.ticket.modal.replyPlaceholder');
  const hint = t('admin.ticket.modal.replyHint');
  const cancelL = t('admin.ticket.modal.cancel');
  const submitL = t('admin.ticket.modal.submit');
  bd.innerHTML = `
    <div class="modal" style="max-width:600px">
      <div class="modal-head">
        <h3>${modalTitle} #${id}</h3>
        <button class="modal-close" id="tktClose">✕</button>
      </div>
      <div class="modal-body">
        <p style="margin:0 0 12px 0;color:var(--c-stone-dark)">${esc(tk.title)}</p>
        <textarea id="tktReply" rows="5" style="width:100%;padding:8px;border:2px solid var(--c-stone);font-family:inherit;font-size:14px" placeholder="${ph}">${esc(tk.admin_reply || '')}</textarea>
        <p style="font-size:12px;color:var(--c-stone);margin-top:4px">${hint}</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="tktCancel">${cancelL}</button>
        <button class="btn btn-primary" id="tktSubmit">${submitL}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('#tktClose').onclick = close;
  bd.querySelector('#tktCancel').onclick = close;
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#tktSubmit').onclick = async () => {
    const text = (bd.querySelector('#tktReply').value || '').trim();
    if (!text) { if (window._toast) window._toast(t('admin.ticket.toast.replyEmpty'), 'error'); return; }
    try {
      await PATCH('/api/tickets?id=' + id, { admin_reply: text });
      if (window._toast) window._toast(t('admin.ticket.toast.replied'), 'success');
      close();
      renderTickets();
    } catch (e) { if (window._toast) window._toast(t('admin.ticket.toast.fail') + e.message, 'error'); }
  };
  setTimeout(() => bd.querySelector('#tktReply')?.focus(), 50);
}

// v50-N6: 派单用 modal + select 下拉 (替代 prompt 输入 ID, 体验更好)
async function openAssignee(id, list) {
  const tk = list.find(x => x.id === id);
  if (!tk) return;
  // 拉 admin 列表
  let admins = [];
  try { const d = await GET('/api/admin/admins'); admins = d.admins || []; } catch (e) { console.warn('[tickets] 拉 admins 失败', e); }
  // 移除旧 modal
  const old = document.getElementById('tktAssignBackdrop');
  if (old) old.remove();
  const bd = document.createElement('div');
  bd.id = 'tktAssignBackdrop';
  bd.className = 'modal-mask';
  bd.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-head">
        <h3>${t('admin.ticket.modal.assignTitle', '派单')} #${id}</h3>
        <button class="modal-close" id="asnClose">✕</button>
      </div>
      <div class="modal-body">
        <p style="margin:0 0 12px 0;color:var(--c-stone-dark)">${esc(tk.title || '')}</p>
        <label style="display:block;margin-bottom:8px">
          <span>${t('admin.ticket.assignLabel')}</span>
          <select id="asnSelect" style="width:100%;padding:6px;border:2px solid var(--c-stone);font-family:inherit;background:var(--c-bg-1);margin-top:4px">
            <option value="">${t('admin.ticket.unassign', '— 不派单 —')}</option>
            ${admins.map(a => `<option value="${a.id}" ${a.id === tk.assignee_id ? 'selected' : ''}>${esc(a.username)}${a.role === 'super' ? ' 🛡️' : ''}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="asnCancel">${t('admin.ticket.modal.cancel')}</button>
        <button class="btn btn-primary" id="asnSubmit">${t('admin.ticket.modal.submit')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('#asnClose').onclick = close;
  bd.querySelector('#asnCancel').onclick = close;
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#asnSubmit').onclick = async () => {
    const v = bd.querySelector('#asnSelect').value;
    const aid = v ? parseInt(v, 10) : null;
    try {
      await PATCH('/api/tickets?id=' + id, { assignee_id: aid });
      if (window._toast) window._toast(t('admin.ticket.toast.assigned'), 'success');
      close();
      renderTickets();
    } catch (e) { if (window._toast) window._toast(t('admin.ticket.toast.fail') + e.message, 'error'); }
  };
}

// v50-N6: 工单列表导出 CSV
function exportTicketsCsv(list) {
  if (!list || !list.length) {
    if (window._toast) window._toast(t('admin.ticket.toast.exportEmpty', '当前列表为空，无可导出数据'), 'info');
    return;
  }
  // 表头: 工单 ID / 类型 / 标题 / 状态 / 优先级 / 提交人 / 联系方式 / 派单人 / 创建时间 / 回复 / 回复时间
  const headers = ['ID', 'Category', 'Title', 'Status', 'Priority', 'Player', 'Contact', 'Assignee', 'Created', 'Reply', 'Replied At'];
  // CSV 转义: 含 , " \n 的字段用 " 包, 内部 " 转 ""
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = list.map(tk => [
    tk.id,
    tk.category || '',
    tk.title || '',
    tk.status || '',
    tk.priority || '',
    tk.player_username || '',
    tk.contact || '',
    tk.assignee_username || '',
    (tk.created_at || '').slice(0, 19).replace('T', ' '),
    (tk.admin_reply || '').replace(/\n/g, ' '),
    (tk.replied_at || '').slice(0, 19).replace('T', ' '),
  ].map(esc).join(','));
  // 加 UTF-8 BOM 让 Excel 正确识别中文
  const csv = '\ufeff' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `tickets-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (window._toast) window._toast(t('admin.ticket.toast.exported', '已导出') + ` ${list.length} ` + t('admin.ticket.toast.exportedUnit', '条工单'), 'success');
}
