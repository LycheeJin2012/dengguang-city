// v45 重写: hotel 子页 - 房型数据加载 + 渲染 + 筛选 + 详情
import { $, escHtml, GET } from '../util.js?v=v46-fix-modules';
import { t, tf } from '../../i18n/core.js?v=n5';

const ROOMS = [];
const ROOM_ICON = cap => cap >= 4 ? '🏨' : (cap >= 2 ? '🛌' : '🛏️');

export function getRooms() { return ROOMS; }

export async function loadRooms() {
  const grid = $('#roomGrid');
  const count = $('#hotelCount');
  if (grid) grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>${t('common.loading', '载入中…')}</p></div>`;
  try {
    // v49-fix-9: 改用公开 /api/homepage-bundle (不过滤 is_active)
    // 之前用 /api/init?action=homepage-bundle 会过滤 is_active=1,
    // 但 DB 里"🏨 树屋酒店"is_active=0 / 房型 is_active=1 → init 端点 hotels=[] → 显示"共 0 间"
    // homepage-bundle 不过滤, 能看到草稿酒店 + 房型, 加 hotelDraft 标记在 UI 显示
    const d = await GET('/api/homepage-bundle');
    const bundle = d.bundle || {};
    const hotels = bundle.hotels || [];
    const allRooms = bundle.rooms || [];
    if (!hotels.length && !allRooms.length) {
      if (grid) grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🏨</div><p>${t('hotel.empty', '酒店正在筹建中, 上线后会在这里显示。')}</p></div>`;
      if (count) count.textContent = tf('hotel.count', { n: 0, total: 0 });
      return;
    }
    // 按 hotel_id 分组
    const roomsByHotel = new Map();
    for (const h of hotels) roomsByHotel.set(h.id, []);
    for (const r of allRooms) {
      if (roomsByHotel.has(r.hotel_id)) roomsByHotel.get(r.hotel_id).push(r);
    }
    ROOMS.length = 0;
    let idx = 0;
    let total = 0;
    for (const arr of roomsByHotel.values()) total += arr.length;
    for (const hotel of hotels) {
      const items = roomsByHotel.get(hotel.id) || [];
      const hotelDraft = !hotel.is_active;
      for (const r of items) {
        ROOMS.push({
          id: r.id,
          hotelId: hotel.id,
          hotelName: hotel.name,
          hotelDraft,
          name: r.name,
          icon: ROOM_ICON(r.capacity || 1),
          // 状态字符串对齐 filter 下拉 (草拟/筹建/拟建)
          // v50-N6: status 用 canonical key, 切换语言时统一查 t() (filter 比较不被 i18n 影响)
          //   hotelDraft → 'building'
          //   r.is_active → 'open'
          //   sort_order === 0 → 'draft'
          //   其余 → 'planned'
          statusKey: hotelDraft ? 'building' : (r.is_active ? 'open' : (r.sort_order === 0 ? 'draft' : 'planned')),
          status: hotelDraft ? t('hotel.filter.building') : (r.is_active ? t('hotel.filter.open') : (r.sort_order === 0 ? t('hotel.filter.draft') : t('hotel.filter.planned'))),
          bed: r.beds || t('hotel.bed.tbd'),
          guests: r.capacity || 1,
          view: t('hotel.view.label'),
          features: [
            r.breakfast_included ? t('hotel.breakfast.yes') : t('hotel.breakfast.no'),
            hotel.address ? t('hotel.address') + hotel.address : null
          ].filter(Boolean),
          price: r.price_per_night,
          recommend: idx === Math.max(0, total - 1),
          image: r.image_url || hotel.image_url || ''
        });
        idx++;
      }
    }
    renderRooms();
  } catch (e) {
    if (grid) grid.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>${t('common.error.load', '加载失败')}: ${escHtml(e.message)}</p></div>`;
    if (count) count.textContent = t('hotel.count.fallback', '— / —');
  }
}

const filters = { status: 'all', guests: 0, view: 'all', sort: 'default' };

function applyFilters() {
  const list = ROOMS.filter(r => {
    // v50-N6: 用 canonical statusKey 比较, 不受 i18n 影响
    if (filters.status !== 'all' && r.statusKey !== filters.status) return false;
    if (filters.guests > 0) {
      if (filters.guests === 3) { if (r.guests < 3) return false; }
      else { if (r.guests !== filters.guests) return false; }
    }
    if (filters.view !== 'all' && r.view !== filters.view) return false;
    return true;
  });
  // v50-N6: 排序 (在 filter 完的 list 上做, 不影响原始 ROOMS 顺序)
  if (filters.sort === 'price-asc') {
    list.sort((a, b) => (a.price || 0) - (b.price || 0));
  } else if (filters.sort === 'price-desc') {
    list.sort((a, b) => (b.price || 0) - (a.price || 0));
  } else if (filters.sort === 'guests-desc') {
    list.sort((a, b) => (b.guests || 0) - (a.guests || 0));
  }
  return list;
}

export function renderRooms() {
  const grid = $('#roomGrid');
  if (!grid) return;
  const list = applyFilters();
  const count = $('#hotelCount');
  if (count) count.textContent = tf('hotel.count', { n: list.length, total: ROOMS.length });
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>${t('hotel.empty.filtered', '没有符合条件的房型，试试调整筛选条件。')}</p></div>`;
    return;
  }
  grid.innerHTML = list.map(r => `
    <article class="room-card ${r.hotelDraft ? 'is-draft' : ''}" data-id="${r.id}">
      ${r.recommend ? `<div class="room-badge">★ ${t('hotel.badge.recommend')}</div>` : ''}
      ${r.hotelDraft ? `<div class="room-badge room-badge-draft">📝 ${t('hotel.badge.building')}</div>` : ''}
      <div class="room-head">
        <span class="room-icon">${r.icon}</span>
        <h3 class="room-name">${escHtml(r.name)}<span class="room-status ${r.statusKey === 'open' ? 'active' : 'draft'}">${escHtml(r.status)}</span></h3>
      </div>
      <ul class="room-features">
        <li>${t('hotel.bedLabel')}: ${escHtml(r.bed)}</li>
        <li>${t('hotel.guestsLabel')}: ${r.guests}+ ${t('common.person', '人')}</li>
        ${r.features.map(f => `<li>${escHtml(f)}</li>`).join('')}
      </ul>
      <div class="room-foot">
        <div class="room-price">
          <span class="room-price-cur">💎</span>
          <span class="room-price-num">${r.price ? r.price + ' / ' + t('hotel.perNight', '晚') : t('hotel.price.tbd', '价格待定')}</span>
        </div>
        <div class="room-actions">
          <button type="button" class="btn btn-ghost btn-small" data-action="detail" data-id="${r.id}">${t('hotel.btn.detail')}</button>
          ${r.statusKey === 'open' && !r.hotelDraft
            ? `<button type="button" class="btn btn-primary btn-small" data-action="book" data-id="${r.id}">📅 ${t('hotel.btn.book')}</button>`
            : `<button type="button" class="btn btn-disabled btn-small" disabled>🚧 ${t('hotel.btn.unavailable')}</button>`
          }
        </div>
      </div>
    </article>`).join('');
  grid.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const room = ROOMS.find(x => x.id === id);
      if (!room) return;
      // v50-N6 fix: detail 调本文件 openRoomDetail, book 按钮才动态 import book.js (避免循环)
      if (btn.dataset.action === 'detail') openRoomDetail(room);
      else import('./book.js').then(m => m.openBookModal(room));
    });
  });
}

export function bindFilters() {
  const fStatus = $('#fStatus');
  const fGuests = $('#fGuests');
  const fView = $('#fView');
  const fReset = $('#fReset');
  if (fStatus) fStatus.addEventListener('change', () => { filters.status = fStatus.value; renderRooms(); });
  if (fGuests) fGuests.addEventListener('change', () => { filters.guests = parseInt(fGuests.value, 10); renderRooms(); });
  if (fView) fView.addEventListener('change', () => { filters.view = fView.value; renderRooms(); });
  // v50-N6: 排序按钮组
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filters.sort = btn.dataset.sort;
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderRooms();
    });
  });
  if (fReset) fReset.addEventListener('click', () => {
    filters.status = 'all'; filters.guests = 0; filters.view = 'all'; filters.sort = 'default';
    if (fStatus) fStatus.value = 'all';
    if (fGuests) fGuests.value = '0';
    if (fView) fView.value = 'all';
    document.querySelectorAll('.sort-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    renderRooms();
  });
}

// ============== 房型详情 Modal ==============
const roomMask = () => $('#roomMask');
export function openRoomDetail(r) {
  const mask = roomMask();
  const titleEl = $('#roomTitle');
  const body = $('#roomBody');
  // v50-N6: 用 titleEl 避免 shadow i18n t()
  if (titleEl) titleEl.textContent = `${r.icon} ${r.name}（${r.status}）`;
  if (body) body.innerHTML = `
    <div class="rd-summary">
      <p class="rd-line"><b>${t('hotel.detail.hotel')}:</b> ${escHtml(r.hotelName)}</p>
      <p class="rd-line"><b>${t('hotel.bedLabel')}:</b> ${escHtml(r.bed)}</p>
      <p class="rd-line"><b>${t('hotel.guestsLabel')}:</b> ${r.guests}+ ${t('common.person')}</p>
      <p class="rd-line"><b>${t('hotel.detail.price')}:</b> ${r.price ? '💎 ' + r.price + ' / ' + t('hotel.perNight', '晚') : t('hotel.price.tbd', '待定')}</p>
      <ul class="rd-features">${r.features.map(f => `<li>${escHtml(f)}</li>`).join('')}</ul>
      <div class="rd-cta"><button type="button" class="btn btn-primary" id="rdBook">📅 ${t('hotel.btn.book')}</button></div>
    </div>`;
  if (mask) { mask.style.display = ''; document.body.style.overflow = 'hidden'; }
  setTimeout(() => {
    const b = $('#rdBook');
    if (b) b.addEventListener('click', () => {
      closeRoomDetail();
      import('./book.js').then(m => m.openBookModal(r));
    });
  }, 0);
}
export function closeRoomDetail() {
  const mask = roomMask();
  if (!mask) return;
  mask.style.display = 'none';
  document.body.style.overflow = '';
}
export function bindRoomDetail() {
  $('#roomClose')?.addEventListener('click', closeRoomDetail);
  const mask = roomMask();
  if (mask) mask.addEventListener('click', e => { if (e.target === mask) closeRoomDetail(); });
}
