// v44 重写: 首页图集 tab
// v50-N6: 加 CSV 导出
import { $, esc, GET, PATCH, safeRender, cacheClear, t } from '../core.js?v=v46-fix-modules';

export async function renderGallery() {
  await safeRender(async () => {
    const d = await GET('/api/gallery');
    const list = (d.items || d.gallery || []);
    const box = $('#galGrid'), empty = $('#galEmpty');
    if (!list.length) { box.innerHTML = ''; box.style.display = 'none'; empty.style.display = 'flex'; return; }
    box.style.display = '';
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
    // v50-N6: 图集导出 CSV
    document.getElementById('galleryExport')?.addEventListener('click', () => exportGalleryCsv(list));
  });
}

// v50-N6: 图集导出 CSV
function exportGalleryCsv(list) {
  if (!list || !list.length) {
    if (window._toast) window._toast(t('admin.gallery.toast.exportEmpty', '当前列表为空，无可导出数据'), 'info');
    return;
  }
  const headers = ['ID', 'Num', 'Label', 'Category', 'Image URL', 'Featured', 'Active', 'Created'];
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = list.map(g => [
    g.id,
    g.num || '',
    g.label || g.title || '',
    g.category || '',
    g.file_url || g.image_url || '',
    g.is_featured ? 'Yes' : 'No',
    g.is_active ? 'Yes' : 'No',
    (g.created_at || '').slice(0, 19).replace('T', ' '),
  ].map(esc).join(','));
  const csv = '\ufeff' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `gallery-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (window._toast) window._toast(t('admin.gallery.toast.exported', '已导出') + ` ${list.length} ` + t('admin.gallery.toast.exportedUnit', '张图'), 'success');
}
