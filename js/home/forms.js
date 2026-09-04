// v50: 表单 + 数据加载 (kart specs / license reqs / hotel rooms / scenery)
import { $, esc, GET, POST, safeRender } from './util.js?v=20260905-v50-0';

export function bindAll() {
  bindContactForm();
  bindHotelFilters();
}

export async function loadScenery() {
  const box = $('#sceneryList');
  if (!box) return;
  await safeRender(async () => {
    let items = [];
    try {
      const d = await GET('/api/gallery?category=scenery&limit=6');
      items = d.gallery || d.items || [];
    } catch (e) { items = []; }
    if (!items.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">🏙️</div><p>暂无地标图</p></div>';
      return;
    }
    box.innerHTML = items.map(it => `
      <article class="card scenery-item">
        <div class="scenery-img"><img src="${esc(it.url || it.thumb || '')}" alt="${esc(it.title || '')}" loading="lazy" /></div>
        <div class="card-head"><h3 class="card-title">${esc(it.title || '地标')}</h3></div>
      </article>
    `).join('');
  });
}

export async function loadHotelRooms() {
  const grid = $('#hotelRoomGrid');
  if (!grid) return;
  await safeRender(async () => {
    let rooms = [];
    try {
      // 公开房型: 用 /api/admin/hotel-rooms (v25 起就是公开 GET)
      const d = await GET('/api/admin/hotel-rooms?limit=12');
      rooms = d.rooms || d.items || [];
    } catch (e) { rooms = []; }
    if (!rooms.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🏨</div><p>暂无房型</p></div>';
      return;
    }
    grid.innerHTML = rooms.map(r => `
      <article class="card room-card">
        <div class="card-head">
          <span class="tag tag-blue">${esc(r.is_active ? '上线' : '草拟')}</span>
          <h3 class="card-title">${esc(r.name || '房型')}</h3>
        </div>
        <div class="card-body">${esc(r.description || '')}</div>
        <div class="card-meta">可住 ${esc(String(r.capacity || 2))} 人</div>
        <div class="card-actions">
          <span class="card-price">¥${esc(String(r.price_per_night || '?'))} / 晚</span>
          <button class="btn btn-primary btn-sm" data-open-form="hotelBook">预订</button>
        </div>
      </article>
    `).join('');
    // 房型 select 填充
    fillSelect('#hotelStatus', [...new Set(rooms.map(r => r.is_active ? '上线' : '草拟').filter(Boolean))]);
    fillSelect('#hotelGuests', [...new Set(rooms.map(r => r.capacity).filter(Boolean))].map(String));
    const cnt = $('#hotelCount');
    if (cnt) cnt.textContent = `${rooms.length} / ${rooms.length} 房型`;
  }, grid);
}

export async function loadKartSpecs() {
  const box = $('#kartSpecs');
  if (!box) return;
  await safeRender(async () => {
    // 从 homepage-bundle 拉 tracks (公开, 含 trial_price)
    let track = null;
    try {
      const d = await GET('/api/homepage-bundle');
      const tracks = d.bundle?.tracks || [];
      track = tracks[0] || null;
    } catch (e) { track = null; }
    if (!track) return;
    const map = {
      length: track.length_km ? `${track.length_km} km` : '—',
      lanes: '双车道 (规划)',
      curves: '4 发夹弯 + 2 高速弯',
      tunnel: '—',
      surface: '红石冰面',
      record: '载入中',
      'trial-price': track.trial_price ? `${track.trial_price} 💎` : '—',
    };
    for (const el of box.querySelectorAll('[data-spec]')) {
      const k = el.dataset.spec;
      if (map[k]) el.textContent = map[k];
    }
  });
}

export async function loadLicenseReqs() {
  const grid = $('#licenseGrid');
  if (!grid) return;
  await safeRender(async () => {
    let reqs = [];
    try {
      // 从 homepage-bundle 拉 licenseReqs (公开)
      const d = await GET('/api/homepage-bundle');
      reqs = d.bundle?.licenseReqs || [];
    } catch (e) { reqs = []; }
    if (!reqs.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>暂无驾照要求</p></div>';
      return;
    }
    grid.innerHTML = reqs.map(r => `
      <article class="card license-card">
        <div class="card-head">
          <span class="tag tag-gold">${esc(r.grade || r.level || '')} 级</span>
          <h3 class="card-title">${esc(r.title || r.name || '驾照')}</h3>
        </div>
        <div class="card-body">${esc(r.description || r.requirement || '')}</div>
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" data-open-form="license">📝 报名</button>
        </div>
      </article>
    `).join('');
  }, grid);
}

function bindContactForm() {
  const form = $('#contactForm');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#contactMsg');
    const data = Object.fromEntries(new FormData(form));
    try {
      await POST('/api/messages', { ...data, kind: 'contact' });
      msg.textContent = '已提交，市政厅会尽快回复。';
      msg.className = 'form-msg ok';
      form.reset();
      if (window._toast) window._toast('提交成功', 'success');
    } catch (err) {
      msg.textContent = '提交失败: ' + err.message;
      msg.className = 'form-msg err';
      if (window._toast) window._toast('失败: ' + err.message, 'error');
    }
  });
}

function bindHotelFilters() {
  const reset = $('#hotelReset');
  if (!reset) return;
  reset.addEventListener('click', () => {
    ['#hotelStatus', '#hotelGuests', '#hotelView'].forEach(s => {
      const el = $(s);
      if (el) el.value = '';
    });
  });
}

function fillSelect(sel, opts) {
  const el = $(sel);
  if (!el) return;
  const cur = el.value;
  // 保留第一个 "全部" / "不限"
  const first = el.options[0];
  el.innerHTML = '';
  if (first) el.appendChild(first);
  for (const o of opts) {
    const op = document.createElement('option');
    op.value = o; op.textContent = o;
    el.appendChild(op);
  }
  el.value = cur;
}
