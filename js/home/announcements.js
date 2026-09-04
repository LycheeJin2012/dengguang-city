// v50: 公告列表 — 拉 /api/announcements 渲染为标准 .card
import { $, esc, fmt, GET, safeRender } from './util.js?v=20260905-v50-0';

export async function loadAnnouncements() {
  const box = $('#announcementList');
  if (!box) return;
  await safeRender(async () => {
    let list = [];
    try {
      const d = await GET('/api/announcements?limit=10');
      list = d.announcements || d.items || [];
    } catch (e) {
      // 后端失败 → 显示 empty state, 不报错
      list = [];
    }
    if (!list.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>暂无公告</p><small>市政厅尚未发布正式公告</small></div>';
      return;
    }
    box.innerHTML = list.map(a => `
      <article class="card ann-card">
        <div class="card-head">
          <span class="tag ${a.is_pinned ? 'tag-grass' : 'tag-blue'}">${esc(a.tag || (a.is_pinned ? '置顶' : '公告'))}</span>
          <h3 class="card-title">${esc(a.title || '未命名')}</h3>
        </div>
        <div class="card-meta">📅 ${esc(fmt(a.created_at))} · ✍️ ${esc(a.author || '市政厅')}</div>
        <div class="card-body">${esc(a.summary || a.body || '').slice(0, 200)}${(a.summary || a.body || '').length > 200 ? '…' : ''}</div>
        <a href="${esc(a.url || '#')}" class="card-link">阅读全文 →</a>
      </article>
    `).join('');
  });
}
