// v44 重写: 驾照考试 tab
import { $, esc, fmt, GET, PATCH, DEL, safeRender, cacheClear, EXAM_LABEL, EXAM_BADGE } from '../core.js';

export async function renderLicense() {
  await safeRender(async () => {
    const d = await GET('/api/admin/license');
    const list = d.signups || [];
    const cP = list.filter(x => x.status === 'pending').length;
    const cA = list.filter(x => x.status === 'passed').length;
    const cF = list.filter(x => x.status === 'failed').length;
    $('#cntLicPending').textContent = cP;
    $('#cntLicPassed').textContent = cA;
    $('#cntLicFailed').textContent = cF;
    $('#cntLicAll').textContent = list.length;
    $('#licensePending').textContent = cP > 0 ? `(${cP})` : '';

    const filter = (document.querySelector('input[name="licenseFilter"]:checked') || {}).value || 'pending';
    let shown = list;
    if (filter !== 'all') shown = shown.filter(x => x.status === filter);

    const box = $('#licenseList'), empty = $('#licenseEmpty');
    if (!shown.length) { box.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';

    box.innerHTML = shown.map(x => {
      const exLbl = EXAM_LABEL[x.exam_type] || x.exam_type;
      const stBadge = EXAM_BADGE[x.status] || x.status || '—';
      return `<article class="msg-item" data-id="${x.id}">
        <div class="msg-head"><div class="msg-head-left">
          <span class="msg-type type-book">${esc(exLbl)}</span>
          <b class="msg-name">👤 ${esc(x.player_username || ('#' + x.player_id))} · ${esc(x.contact)}</b>
          <span class="book-status">${esc(stBadge)}</span>
          ${x.exam_date ? `<span class="gallery-num" style="margin-left:4px">📅 ${esc(x.exam_date)}</span>` : ''}
        </div><div class="msg-time">${fmt(x.created_at)}</div></div>
        ${x.note ? `<p class="msg-content" style="font-size:13px;color:var(--c-stone-dark)">📝 ${esc(x.note)}</p>` : ''}
        ${x.result ? `<p class="msg-reply-box" style="font-size:13px">📋 结果: ${esc(x.result)}</p>` : ''}
        <div class="msg-actions book-actions">
          ${x.status === 'pending' ? `
            <button class="btn btn-primary btn-sm" data-act="pass">✓ 通过</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-act="fail">✗ 未通过</button>
          ` : ''}
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
    }).join('');

    box.querySelectorAll('.msg-item').forEach(el => {
      const id = +el.dataset.id;
      el.querySelector('[data-act="pass"]')?.addEventListener('click', () => licAction(id, 'pass'));
      el.querySelector('[data-act="fail"]')?.addEventListener('click', () => licAction(id, 'fail'));
      el.querySelector('[data-act="del"]').onclick = () => licDel(id);
    });
  });
}

export async function licAction(id, act) {
  try {
    await PATCH('/api/admin/license?id=' + id + '&action=' + (act === 'pass' ? 'approve' : 'reject'));
    cacheClear('license:');
    renderLicense();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
export async function licDel(id) {
  if (!confirm('删除该报名？')) return;
  try {
    await DEL('/api/admin/license?id=' + id);
    cacheClear('license:');
    renderLicense();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
