// v50: hotel 房型列表 + 筛选 + 详情 modal
import { $, esc, escHtml, GET, safeRender } from '../util.js?v=20260905-v50-0';

let _allRooms = [];

export async function loadRooms() {
  const grid = $('#roomGrid');
  if (!grid) return;
  await safeRender(async () => {
    let rooms = [];
    try {
      const d = await GET('/api/hotel/rooms?limit=50');
      rooms = d.rooms || d.items || [];
    } catch (e) { rooms = []; }
    if (!rooms.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🏨</div><p>暂无房型</p><small>市政厅尚未发布</small></div>';
      return;
    }
    _allRooms = rooms;
    fillFilters(rooms);
    applyFilters();
  }, grid);
}

export function bindFilters() {
  ['#fStatus', '#fGuests', '#fView'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('change', applyFilters);
  });
  $('#fReset')?.addEventListener('click', () => {
    ['#fStatus', '#fGuests', '#fView'].forEach(sel => { const el = $(sel); if (el) el.value = ''; });
    applyFilters();
  });
}

function applyFilters() {
  const s = $('#fStatus')?.value || '';
  const g = $('#fGuests')?.value || '';
  const v = $('#fView')?.value || '';
  const list = _allRooms.filter(r =>
    (!s || r.status === s) &&
    (!g || String(r.guests) === g || (g === '3' && Number(r.guests) >= 3)) &&
    (!v || r.view === v)
  );
  render(list);
}

function fillFilters(rooms) {
  fillSelect('#fStatus', [...new Set(rooms.map(r => r.status).filter(Boolean))]);
  fillSelect('#fGuests', [...new Set(rooms.map(r => r.guests).filter(Boolean))].map(String));
  fillSelect('#fView', [...new Set(rooms.map(r => r.view).filter(Boolean))]);
}

function fillSelect(sel, opts) {
  const el = $(sel);
  if (!el) return;
  const first = el.options[0];
  el.innerHTML = '';
  if (first) el.appendChild(first);
  for (const o of opts) {
    const op = document.createElement('option');
    op.value = o; op.textContent = o;
    el.appendChild(op);
  }
}

function render(list) {
  const grid = $('#roomGrid');
  if (!grid) return;
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>没有匹配的房型</p><small>试试重置筛选</small></div>';
  } else {
    grid.innerHTML = list.map(r => `
      <article class="card room-card" data-id="${esc(r.id)}">
        <div class="card-head">
          <span class="tag tag-blue">${esc(r.status || '草拟')}</span>
          <h3 class="card-title">${esc(r.name || '房型')}</h3>
        </div>
        <div class="card-body">${esc(r.desc || r.description || '')}</div>
        <div class="card-meta">可住 ${esc(String(r.guests || 2))} 人 · ${esc(r.view || '—')}</div>
        <div class="card-actions">
          <span class="card-price">${esc(r.price || '¥?')} / 晚</span>
          <button class="btn btn-ghost btn-sm" data-act="detail">详情</button>
          <button class="btn btn-primary btn-sm" data-act="book">预订</button>
        </div>
      </article>
    `).join('');
  }
  const cnt = $('#hotelCount');
  if (cnt) cnt.textContent = `${list.length} / ${_allRooms.length} 房型`;

  grid.querySelectorAll('.room-card').forEach(card => {
    const id = card.dataset.id;
    const r = _allRooms.find(x => String(x.id) === id);
    if (!r) return;
    card.querySelector('[data-act="detail"]')?.addEventListener('click', () => showDetail(r));
    card.querySelector('[data-act="book"]')?.addEventListener('click', () => {
      if (window._openBook) window._openBook(r);
    });
  });
}

export function bindRoomDetail() {
  const mask = $('#roomMask');
  if (!mask) return;
  $('#roomClose')?.addEventListener('click', () => { mask.style.display = 'none'; document.body.style.overflow = ''; });
  mask.addEventListener('click', e => { if (e.target === mask) { mask.style.display = 'none'; document.body.style.overflow = ''; } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && mask.style.display !== 'none') { mask.style.display = 'none'; document.body.style.overflow = ''; } });
}

function showDetail(r) {
  const mask = $('#roomMask');
  $('#roomTitle').textContent = r.name || '房型详情';
  $('#roomBody').innerHTML = `
    <div class="card" style="box-shadow:none; border:none; padding:0">
      <div class="card-head">
        <span class="tag tag-blue">${esc(r.status || '草拟')}</span>
        <span class="card-meta">可住 ${esc(String(r.guests || 2))} 人 · ${esc(r.view || '—')}</span>
      </div>
      <div class="card-body">${esc(r.desc || r.description || '暂无说明')}</div>
      ${r.price ? `<div class="section-meta">参考价格：${esc(r.price)} / 晚</div>` : ''}
      ${r.note ? `<div class="section-note">${esc(r.note)}</div>` : ''}
    </div>
  `;
  mask.style.display = '';
  document.body.style.overflow = 'hidden';
}
