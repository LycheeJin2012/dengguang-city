// v50: 公共留言墙 — 拉 /api/messages (公开接口) 渲染
import { $, esc, fmt, GET, safeRender } from './util.js?v=20260905-v50-0';

export async function loadPublicMessages() {
  const box = $('#publicMessageBoard');
  if (!box) return;
  await safeRender(async () => {
    let list = [];
    try {
      const d = await GET('/api/messages?limit=20');
      list = d.messages || d.items || [];
    } catch (e) { list = []; }
    if (!list.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><p>暂无留言</p><small>成为第一个留言的市民</small></div>';
      return;
    }
    box.innerHTML = list.map(m => `
      <article class="card wall-item">
        <div class="card-head">
          <span class="tag ${m.status === 'replied' ? 'tag-grass' : 'tag-stone'}">${m.status === 'replied' ? '已回复' : '待回复'}</span>
          <span class="card-meta">${esc(fmt(m.created_at))}</span>
        </div>
        <h3 class="card-title">${esc(m.title || (m.username || '匿名') + ' 的留言')}</h3>
        <div class="card-body">${esc(m.body || m.content || '')}</div>
        ${m.admin_reply ? `<div class="card-reply"><b>💬 市政厅回复:</b> ${esc(m.admin_reply)}</div>` : ''}
        <div class="card-meta">— ${esc(m.username || '匿名市民')}</div>
      </article>
    `).join('');
  });
}
