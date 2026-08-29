// v45 重写: 首页图集 (gallery + lightbox)
import { $, escHtml, GET } from './util.js?v=v46-fix-modules';

let _lbImages = [];
let _lbIdx = 0;

export async function loadGallery() {
  const grid = $('#galleryGrid');
  if (!grid) return;
  try {
    const d = await GET('/api/gallery');
    const list = d.items || d.gallery || [];
    if (!list.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🖼️</div><p>暂无图集</p></div>';
      return;
    }
    grid.innerHTML = list.map((g, i) => {
      const url = g.file_url || g.image_url || '';
      const label = g.label || g.title || '';
      return `<div class="gallery-item" data-i="${i}">
        <img src="${escHtml(url)}" alt="${escHtml(label)}" class="gallery-thumb" loading="lazy" />
        <div class="gallery-meta">
          <span class="gallery-label">${escHtml(label)}</span>
          <span class="gallery-num">#${g.num || g.id}</span>
        </div>
      </div>`;
    }).join('');
    _lbImages = list.map(g => g.file_url || g.image_url).filter(Boolean);
    grid.querySelectorAll('.gallery-item').forEach(el => {
      el.addEventListener('click', () => openLb(+el.dataset.i));
    });
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><p>加载失败: ${escHtml(e.message)}</p></div>`;
  }
}

export function openLb(i) {
  if (!_lbImages.length) return;
  _lbIdx = i;
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.className = 'lightbox';
    lb.innerHTML = `
      <button class="lb-close" id="lbClose">✕</button>
      <button class="lb-prev" id="lbPrev">‹</button>
      <button class="lb-next" id="lbNext">›</button>
      <img id="lbImg" alt="" />
      <div class="lb-counter" id="lbCounter"></div>`;
    document.body.appendChild(lb);
    lb.querySelector('#lbClose').onclick = closeLb;
    lb.querySelector('#lbPrev').onclick = () => navLb(-1);
    lb.querySelector('#lbNext').onclick = () => navLb(1);
    lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', e => {
      if (lb.classList.contains('visible')) {
        if (e.key === 'Escape') closeLb();
        else if (e.key === 'ArrowLeft') navLb(-1);
        else if (e.key === 'ArrowRight') navLb(1);
      }
    });
  }
  updateLb();
  lb.classList.add('visible');
  document.body.style.overflow = 'hidden';
}
export function closeLb() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.classList.remove('visible');
  document.body.style.overflow = '';
}
export function navLb(delta) {
  _lbIdx = (_lbIdx + delta + _lbImages.length) % _lbImages.length;
  updateLb();
}
function updateLb() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.querySelector('#lbImg').src = _lbImages[_lbIdx];
  lb.querySelector('#lbCounter').textContent = `${_lbIdx + 1} / ${_lbImages.length}`;
}
