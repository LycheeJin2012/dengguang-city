// v45 重写: 首页公告区 (list + modal)
import { $, escHtml, fmtDate, relativeTime, GET } from './util.js';

const _annCache = { data: null, ts: 0 };
const CACHE_TTL = 60_000; // 60s, 跟 homepage-bundle 的服务端 cache 一致

export async function loadAnnouncements() {
  const grid = $('.notice-grid') || $('#noticeGrid');
  if (!grid) return;
  try {
    const list = await fetchAnnouncements();
    if (!list.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>暂无公告</p></div>';
      return;
    }
    grid.innerHTML = list.map((a, i) => {
      const isLatest = i === 0;
      const tag = isLatest ? '<span class="tag tag-super">最新</span>' : '<span class="tag tag-info">公告</span>';
      const coverImg = a.image_url
        ? `<img src="${escHtml(a.image_url)}" alt="公告配图" loading="lazy" class="notice-cover-img" onerror="this.style.opacity=0" />`
        : '';
      return `<article class="notice-card">
        <div class="notice-body">
          ${coverImg}
          ${tag}
          <h3>${escHtml(a.title)}</h3>
          <p class="ann-meta">📅 ${relativeTime(a.created_at)}${a.updated_at ? ' · <span class="ann-meta-edited">已编辑</span>' : ''} · ✍️ ${escHtml(a.admin_username || '市政厅')}</p>
          <p class="ann-content-preview">${escHtml(a.content)}</p>
          <a href="#ann-${a.id}" class="read-more" data-id="${a.id}">阅读全文 →</a>
        </div>
      </article>`;
    }).join('');
    grid.querySelectorAll('.read-more').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const id = +a.dataset.id;
        const ann = list.find(x => x.id === id);
        if (ann) showAnnModal(ann);
      });
    });
    grid.querySelectorAll('.notice-card').forEach((c, i) => {
      c.addEventListener('click', () => grid.querySelectorAll('.read-more')[i]?.click());
    });
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>加载失败: ${escHtml(e.message)}</p></div>`;
  }
}

async function fetchAnnouncements() {
  if (_annCache.data && Date.now() - _annCache.ts < CACHE_TTL) return _annCache.data;
  const d = await GET('/api/announcements');
  _annCache.data = d.announcements || [];
  _annCache.ts = Date.now();
  return _annCache.data;
}

export function showAnnModal(ann) {
  // 关旧模态
  const old = document.getElementById('annViewBackdrop');
  if (old) old.remove();
  const bd = document.createElement('div');
  bd.id = 'annViewBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';
  bd.innerHTML = `
    <div class="modal ann-view-modal" style="max-width:640px;width:100%;max-height:90vh;overflow-y:auto">
      <div class="modal-head">
        <h3>${escHtml(ann.title)}</h3>
        <button class="modal-close" id="annClose">✕</button>
      </div>
      <div class="modal-body">
        ${ann.image_url ? `<div class="ann-view-cover-wrap"><img src="${escHtml(ann.image_url)}" class="ann-view-cover" /></div>` : ''}
        <div class="ann-view-meta">📅 ${fmtDate(ann.created_at)}${ann.updated_at ? ' · <span style="color:#a6a">已编辑</span>' : ''} · ✍️ ${escHtml(ann.admin_username || '市政厅')}</div>
        <div class="ann-view-content">${escHtml(ann.content).replace(/\n/g, '<br>')}</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost btn-sm" id="annClose2">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#annClose').onclick = close;
  bd.querySelector('#annClose2').onclick = close;
}
