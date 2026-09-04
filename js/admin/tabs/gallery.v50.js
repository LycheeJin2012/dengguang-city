// v44 重写: 首页图集 tab
import { $, esc, GET, PATCH, safeRender, cacheClear } from '../core.v50.js?v=v50-fix';

export async function renderGallery() {
  await safeRender(async () => {
    // 暂时用公开端点 (公开 GET 包含 is_featured 等字段)
    const d = await GET('/api/gallery');
    const list = (d.items || d.gallery || []);
    const box = $('#galGrid'), empty = $('#galEmpty');
    if (!list.length) { box.innerHTML = ''; empty.style.display = 'flex'; return; }
    empty.style.display = 'none';
    box.innerHTML = list.map(g => `
      <article class="gallery-item" data-id="${g.id}">
        <img src="${esc(g.file_url || g.image_url || '')}" alt="${esc(g.label || g.title || '')}" class="gallery-thumb" loading="lazy" />
        <div class="gallery-meta">
          <div class="gallery-label">${esc(g.label || g.title || '')}</div>
          <div class="gallery-num">#${g.num || g.id}</div>
        </div>
      </article>
    `).join('');
    box.querySelectorAll('.gallery-item').forEach(el => {
      el.onclick = () => { window.open(el.querySelector('img').src, '_blank'); };
    });
  });
}
