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
          //   hotel 草稿 → '筹建' (酒店整体在筹建, 房型还未对外开放预订)
          //   hotel 上线 + room 上线 → '开放' (用户能订)
          //   hotel 上线 + room 草稿 → '草拟' (酒店运营中, 房型草案)
          //   hotel 上线 + room sort_order>0 未激活 → '拟建' (酒店运营中, 房型规划)
          status: hotelDraft ? '筹建' : (r.is_active ? '开放' : (r.sort_order === 0 ? '草拟' : '拟建')),
          bed: r.beds || '床型待公告',
          guests: r.capacity || 1,
          view: '景观',
          features: [
            r.breakfast_included ? '含早餐' : '不含早餐',
            hotel.address ? '地址: ' + hotel.address : null
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
    if (count) count.textContent = '— / —';
  }
}

const filters = { status: 'all', guests: 0, view: 'all' };

function applyFilters() {
  return ROOMS.filter(r => {
    if (filters.status !== 'all' && r.status !== filters.status) return false;
    if (filters.guests > 0) {
      if (filters.guests === 3) { if (r.guests < 3) return false; }
      else { if (r.guests !== filters.guests) return false; }
    }
    if (filters.view !== 'all' && r.view !== filters.view) return false;
    return true;
  });
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
      ${r.recommend ? '<div class="room-badge">★ 推荐</div>' : ''}
      ${r.hotelDraft ? '<div class="room-badge room-badge-draft">📝 筹建中</div>' : ''}
      <div class="room-head">
        <span class="room-icon">${r.icon}</span>
        <h3 class="room-name">${escHtml(r.name)}<span class="room-status ${r.status === '开放' ? 'active' : 'draft'}">${escHtml(r.status)}</span></h3>
      </div>
      <ul class="room-features">
        <li>床型：${escHtml(r.bed)}</li>
        <li>适合：${r.guests}+ 人</li>
        ${r.features.map(f => `<li>${escHtml(f)}</li>`).join('')}
      </ul>
      <div class="room-foot">
        <div class="room-price">
          <span class="room-price-cur">💎</span>
          <span class="room-price-num">${r.price ? r.price + ' / 晚' : '价格待定'}</span>
        </div>
        <div class="room-actions">
          <button type="button" class="btn btn-ghost btn-small" data-action="detail" data-id="${r.id}">详情</button>
          ${r.status === '开放' && !r.hotelDraft
            ? `<button type="button" class="btn btn-primary btn-small" data-action="book" data-id="${r.id}">📅 预订</button>`
            : `<button type="button" class="btn btn-disabled btn-small" disabled>🚧 暂不开放</button>`
          }
        </div>
      </div>
    </article>`).join('');
  grid.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const room = ROOMS.find(x => x.id === id);
      if (!room) return;
      // 动态 import 避免循环
      import('./book.js').then(m => {
        if (btn.dataset.action === 'detail') m.openRoomDetail(room);
        else m.openBookModal(room);
      });
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
  if (fReset) fReset.addEventListener('click', () => {
    filters.status = 'all'; filters.guests = 0; filters.view = 'all';
    if (fStatus) fStatus.value = 'all';
    if (fGuests) fGuests.value = '0';
    if (fView) fView.value = 'all';
    renderRooms();
  });
}

// ============== 房型详情 Modal ==============
const roomMask = () => $('#roomMask');
export function openRoomDetail(r) {
  const mask = roomMask();
  const t = $('#roomTitle');
  const body = $('#roomBody');
  if (t) t.textContent = `${r.icon} ${r.name}（${r.status}）`;
  if (body) body.innerHTML = `
    <div class="rd-summary">
      <p class="rd-line"><b>所属酒店：</b>${escHtml(r.hotelName)}</p>
      <p class="rd-line"><b>床型：</b>${escHtml(r.bed)}</p>
      <p class="rd-line"><b>适合：</b>${r.guests}+ 人</p>
      <p class="rd-line"><b>价格：</b>${r.price ? '💎 ' + r.price + ' / 晚' : '待定'}</p>
      <ul class="rd-features">${r.features.map(f => `<li>${escHtml(f)}</li>`).join('')}</ul>
      <div class="rd-cta"><button type="button" class="btn btn-primary" id="rdBook">📅 预订</button></div>
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
