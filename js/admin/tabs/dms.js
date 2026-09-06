// v44 重写: 私信监管 tab (v50-N6: 全 i18n)
import { $, esc, fmt, GET, POST, safeRender } from '../core.js?v=v46-fix-modules';
import { t } from '../../i18n/core.js?v=n5';

export async function renderDms(query) {
  await safeRender(async () => {
    const d = await POST('/api/init?action=admin-dm-conversations', { q: query || '' });
    const list = d.conversations || [];
    const box = $('#dmList'), empty = $('#dmEmpty');
    if (!list.length) { box.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';
    box.innerHTML = list.map(c => {
      const repliedBy = c.replied_by_admin_username || 'admin';
      const replyTag = c.replied_by_admin_id
        ? `<span class="msg-replied-tag" style="background:#1a1a3a;color:#9cf;border-color:#66f;">👤 ${t('admin.dms.replied').replace('{name}', esc(repliedBy))}</span>`
        : '';
      return `<article class="msg-item" data-from="${c.from_player_id}" data-to="${c.to_player_id}">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">💬 ${esc(c.from_username)} ↔ ${esc(c.to_username)}</b>
          ${c.unread_count > 0 ? `<span class="msg-unread-tag">${t('admin.dms.unread')} ${c.unread_count}</span>` : ''}
          ${replyTag}
        </div><div class="msg-time">${fmt(c.last_at)}</div></div>
        <p class="msg-content" style="font-size:13px;color:var(--c-stone-dark)">${esc((c.last_content || '').slice(0, 200))}${(c.last_content || '').length > 200 ? '…' : ''}</p>
        <div class="msg-actions book-actions">
          <button class="btn btn-primary btn-sm" data-act="open">🔍 ${t('admin.dms.viewThread')}</button>
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el => {
      const f = +el.dataset.from, t2 = +el.dataset.to;
      el.querySelector('[data-act="open"]').onclick = () => openDmThread(f, t2);
    });
  });
}
async function openDmThread(from, to) {
  const d = await GET('/api/init?action=admin-dm-thread&player_id=' + from + '&peer_id=' + to);
  const list = d.messages || [];
  let bd = document.getElementById('dmThreadBackdrop');
  if (bd) bd.remove();
  bd = document.createElement('div');
  bd.id = 'dmThreadBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  bd.innerHTML = `
    <div style="background:#fff;border:3px solid #000;box-shadow:6px 6px 0 #000;padding:24px;max-width:640px;width:100%;max-height:80vh;overflow-y:auto">
      <h3 style="margin:0 0 12px">💬 ${t('admin.dms.dmThread')}</h3>
      <div id="dmThreadBody" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;max-height:50vh;overflow-y:auto"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="dmClose" style="background:#888;color:#fff;border:none;padding:8px 16px;cursor:pointer">${t('admin.dms.close')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  bd.querySelector('#dmThreadBody').innerHTML = list.map(m => {
    const isFrom17 = m.from_player_id === 17;
    return `<div style="padding:8px 12px;background:${isFrom17 ? '#eaf3ff' : '#f5e6c5'};border-left:3px solid ${isFrom17 ? '#39c' : '#c84'}">
      <div style="font-size:12px;color:#888;margin-bottom:4px">${esc(m.from_username)} · ${fmt(m.created_at)}</div>
      <div>${esc(m.content)}</div>
    </div>`;
  }).join('');
  bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });
  bd.querySelector('#dmClose').onclick = () => bd.remove();
}

export async function renderDmAiStruggle() {
  await safeRender(async () => {
    const d = await POST('/api/init?action=admin-dm-ai-struggle', {});
    const list = d.struggles || [];
    const box = $('#dmList');
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><div class="empty-icon">🤖</div><p>${t('admin.dms.noAiFallback')}</p></div>`;
      return;
    }
    box.innerHTML = list.map(m => `
      <article class="msg-item">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">🤖 ${t('admin.dms.aiFallback').replace('#{id}', m.id)}</b>
        </div><div class="msg-time">${fmt(m.created_at)}</div></div>
        <p class="msg-content">${esc((m.content || '').slice(0, 200))}</p>
      </article>
    `).join('');
  });
}
