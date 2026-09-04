// v50: 图集 — 拉 /api/gallery 渲染
import { $, esc, GET, safeRender } from './util.js?v=20260905-v50-0';
import { openLightbox } from './ui.js?v=20260905-v50-0';

export async function loadGallery() {
  const box = $('#galleryGrid');
  const filterBar = $('#galleryFilterBar');
  if (!box) return;
  await safeRender(async () => {
    let items = [];
    try {
      const d = await GET('/api/gallery?limit=60');
      items = d.gallery || d.items || [];
    } catch (e) { items = []; }
    if (!items.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">📸</div><p>暂无图集</p><small>市政厅尚未发布实景图</small></div>';
      if (filterBar) filterBar.innerHTML = '';
      return;
    }
    // 分类筛选
    const cats = ['全部', ...new Set(items.map(i => i.category || '其他'))];
    if (filterBar) {
      filterBar.innerHTML = cats.map((c, i) => `<button class="btn btn-ghost btn-sm${i === 0 ? ' active' : ''}" data-cat="${esc(c === '全部' ? '' : c)}">${esc(c)}</button>`).join('');
      filterBar.onclick = e => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        [...filterBar.children].forEach(c => c.classList.toggle('active', c === btn));
        const cat = btn.dataset.cat;
        render(items.filter(i => !cat || i.category === cat));
      };
    }
    render(items);
    function render(list) {
      box.innerHTML = list.map((it, i) => `
        <figure class="card gallery-item" data-i="${i}">
          <div class="gallery-img"><img src="${esc(it.url || it.thumb || '')}" alt="${esc(it.title || '')}" loading="lazy" /></div>
          <figcaption class="gallery-cap">${esc(it.title || '')}</figcaption>
        </figure>
      `).join('');
      box.onclick = e => {
        const fig = e.target.closest('.gallery-item');
        if (!fig) return;
        openLightbox(list.map(it => ({ url: it.url || it.thumb, title: it.title })), +fig.dataset.i);
      };
    }
  });
}
