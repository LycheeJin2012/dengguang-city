/* 灯光市 v27 · admin 3 个 manage subview 完整重写
 * 之前依赖 window.__manageData 全局 + 嵌套 IIFE + 跨 scope 引用, 改用同步 XHR 拿数据
 * 现在每个 subview 独立 fetch 独立端点, 错误直接显示在 list 容器, 不静默吞
 * 挂 window.renderHotelManage / renderTrackManage / renderLicenseManage 给 sub-tab click handler
 * 挂 window.addHotelBtn / addTrackBtn / addLicReqBtn 给 + 按钮
 */
(function () {
'use strict';

const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])
);

const isSuper = () => (window._me || {}).role === 'super';

async function getJSON(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'API 错误');
  return d;
}

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}

async function patchJSON(url, body) {
  const r = await fetch(url, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}

async function delJSON(url) {
  const r = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}

function showError(listId, err) {
  const el = document.getElementById(listId);
  if (!el) return;
  el.innerHTML = '<div class="empty-state" style="color:#c44"><div class="empty-icon">⚠️</div><p>加载失败: ' + (err.message || err) + '</p><p style="font-size:12px;color:#888">按 F12 看 Console 详细错误</p></div>';
}

function showLoading(listId) {
  const el = document.getElementById(listId);
  if (!el) return;
  el.innerHTML = '<p class="empty-state">⏳ 加载中...</p>';
}

// ============================================================
// 酒店管理 render
// ============================================================
async function renderHotelManage() {
  const listId = 'hotelManageList';
  const emptyId = 'hotelManageEmpty';
  const list = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  if (!list || !empty) { console.error('[renderHotelManage] DOM 缺失', listId, emptyId); return; }
  showLoading(listId);
  try {
    const d = await getJSON('/api/admin/manage-hotel');
    const hotels = d.hotels || [];
    const rooms = d.rooms || [];
    if (hotels.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';
    const me = isSuper();
    list.innerHTML = hotels.map((h) => {
      const hrs = rooms.filter((r) => r.hotel_id === h.id);
      return '<article class="msg-item ann-item">' +
        '<div class="msg-head"><div class="msg-head-left"><b class="msg-name">🏨 ' + esc(h.name) + '</b>' +
        (h.is_active ? '' : ' <span class="msg-read-tag">已下架</span>') +
        ' <span class="gallery-num">' + hrs.length + ' 房型</span></div>' +
        '<div class="msg-time">sort=' + esc(h.sort_order || 0) + '</div></div>' +
        (h.image_url ? '<div style="margin:8px 0;"><img src="' + esc(h.image_url) + '" loading="lazy" onerror="this.style.opacity=\'0.25\'" style="max-width:240px;max-height:120px;border:2px solid var(--c-stone);" alt="酒店图片" /></div>' : '') +
        (h.address ? '<div class="msg-content">📍 ' + esc(h.address) + '</div>' : '') +
        (h.description ? '<div class="msg-content" style="white-space:pre-wrap">' + esc(h.description) + '</div>' : '') +
        (hrs.length > 0 ? '<div style="margin:8px 0;padding:8px;background:var(--c-bg-2);border:1px solid var(--c-stone);">' +
          hrs.map((r) =>
            '<div style="display:flex;gap:6px;align-items:center;font-family:var(--font-pixel);font-size:11px;padding:4px 0;">' +
              '<span style="flex:1;">🛏️ ' + esc(r.name) + ' · ' + r.capacity + '人 · ' + (r.breakfast_included ? '🍳' : '—') + '</span>' +
              '<span style="color:var(--c-grass-dark);font-weight:700;">💎 ' + r.price_per_night + '/晚</span>' +
              (me ? '<button data-act="edit-room" data-id="' + r.id + '" class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 6px;">✎</button>' +
              '<button data-act="del-room" data-id="' + r.id + '" class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 6px;">🗑</button>' : '') +
            '</div>'
          ).join('') + '</div>' : '') +
        (me ? '<div class="msg-actions book-actions">' +
          '<button data-act="edit-hotel" data-id="' + h.id + '" class="btn btn-primary btn-sm">✎ 编辑酒店</button>' +
          '<button data-act="add-room" data-id="' + h.id + '" class="btn btn-primary btn-sm">+ 房型</button>' +
          '<button data-act="del-hotel" data-id="' + h.id + '" class="btn btn-ghost btn-sm" style="background:#c33;color:white;">🗑 删除</button>' +
        '</div>' : '') +
        '</article>';
    }).join('');
  } catch (e) {
    showError(listId, e);
  }
}

// ============================================================
// 赛车场管理 render
// ============================================================
async function renderTrackManage() {
  const listId = 'trackManageList';
  const emptyId = 'trackManageEmpty';
  const list = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  if (!list || !empty) { console.error('[renderTrackManage] DOM 缺失', listId, emptyId); return; }
  showLoading(listId);
  try {
    const d = await getJSON('/api/admin/manage-track');
    const tracks = d.tracks || [];
    if (tracks.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';
    const me = isSuper();
    list.innerHTML = tracks.map((t) =>
      '<article class="msg-item ann-item">' +
        '<div class="msg-head"><div class="msg-head-left"><b class="msg-name">🏁 ' + esc(t.name) + '</b></div>' +
        '<div class="msg-time">' + (t.length_km || '?') + ' km / ' + (t.laps || '?') + ' 圈</div></div>' +
        (t.image_url ? '<div style="margin:8px 0;"><img src="' + esc(t.image_url) + '" loading="lazy" onerror="this.style.opacity=\'0.25\'" style="max-width:240px;max-height:120px;" alt="赛道图片" /></div>' : '') +
        (t.trial_price ? '<div class="msg-content" style="background:#fff8e0;">💎 试车价格: ' + esc(t.trial_price) + ' 💎/次</div>' : '') +
        (t.difficulty ? '<div class="msg-content">难度: ' + esc(t.difficulty) + '</div>' : '') +
        (t.description ? '<div class="msg-content" style="white-space:pre-wrap">' + esc(t.description) + '</div>' : '') +
        (me ? '<div class="msg-actions book-actions">' +
          '<button data-act="edit-track" data-id="' + t.id + '" class="btn btn-primary btn-sm">✎ 编辑</button>' +
          '<button data-act="del-track" data-id="' + t.id + '" class="btn btn-ghost btn-sm" style="background:#c33;color:white;">🗑 删除</button>' +
        '</div>' : '') +
        '</article>'
    ).join('');
  } catch (e) {
    showError(listId, e);
  }
}

// ============================================================
// 驾照考试要求管理 render
// ============================================================
async function renderLicenseManage() {
  const listId = 'licenseManageList';
  const emptyId = 'licenseManageEmpty';
  const list = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  if (!list || !empty) { console.error('[renderLicenseManage] DOM 缺失', listId, emptyId); return; }
  showLoading(listId);
  try {
    const d = await getJSON('/api/admin/manage-license-req');
    const items = d.items || [];
    if (items.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';
    const me = isSuper();
    list.innerHTML = items.map((l) =>
      '<article class="msg-item ann-item">' +
        '<div class="msg-head"><div class="msg-head-left"><b class="msg-name">🎫 ' + esc(l.exam_type) + ' 级 · ' + esc(l.title) + '</b></div>' +
        '<div class="msg-time">' + (l.min_age || 16) + '+ · ' + (l.duration_minutes || 30) + ' 分钟</div></div>' +
        (l.description ? '<div class="msg-content" style="white-space:pre-wrap">' + esc(l.description) + '</div>' : '') +
        (l.requirements ? '<div class="msg-content" style="background:#fff8e0;">📋 ' + esc(l.requirements) + '</div>' : '') +
        (me ? '<div class="msg-actions book-actions">' +
          '<button data-act="edit-license" data-id="' + l.id + '" class="btn btn-primary btn-sm">✎ 编辑</button>' +
          '<button data-act="del-license" data-id="' + l.id + '" class="btn btn-ghost btn-sm" style="background:#c33;color:white;">🗑 删除</button>' +
        '</div>' : '') +
        '</article>'
    ).join('');
  } catch (e) {
    showError(listId, e);
  }
}

// ============================================================
// sub-tab 切换 (切到 manage 子 tab 时调对应 render)
// ============================================================
document.addEventListener('click', async (e) => {
  const tab = e.target.closest('.subtab');
  if (!tab) return;
  const nav = tab.closest('.subtabs');
  if (!nav) return;
  const pane = nav.dataset.pane;
  const sub = tab.dataset.sub;
  nav.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b === tab));
  document.querySelectorAll('.subview[data-subview^="' + pane + '-"]').forEach((sv) => {
    sv.classList.toggle('active', sv.dataset.subview === pane + '-' + sub);
  });
  if (sub === 'manage') {
    if (pane === 'bookings') await renderHotelManage();
    else if (pane === 'license') await renderLicenseManage();
    else if (pane === 'kart') await renderTrackManage();
  }
});

// ============================================================
// + 新建 / ✎ 编辑 / 🗑 删除 / + 房型 按钮
// 用 inline 简单 form, alert 错误, 不用 _attachFileUpload (避免依赖)
// ============================================================

// --- 通用 helper ---
function buildForm(opts) {
  const fields = opts.fields.map((f) =>
    '<label style="display:block;margin:6px 0;font-size:13px;">' +
      '<span style="display:block;font-weight:700;margin-bottom:2px;">' + esc(f.label) + (f.required ? ' *' : '') + '</span>' +
      (f.type === 'textarea'
        ? '<textarea data-f="' + f.name + '" rows="3" style="width:100%;padding:6px;border:2px solid var(--c-black);font-family:var(--font-cn);">' + esc(f.value == null ? '' : f.value) + '</textarea>'
        : '<input data-f="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(f.value == null ? '' : f.value) + '"' + (f.required ? ' required' : '') + ' style="width:100%;padding:6px;border:2px solid var(--c-black);font-family:var(--font-cn);" />') +
    '</label>'
  ).join('');
  return '<div data-form-wrap="' + esc(opts.formKey) + '" style="background:#fffbe5;border:3px solid var(--c-black);padding:12px;margin:8px 0;box-shadow:4px 4px 0 var(--c-stone-dark);">' +
    '<div style="font-weight:700;color:var(--c-grass-dark);margin-bottom:8px;">' + esc(opts.title) + '</div>' +
    fields +
    '<div style="margin-top:8px;display:flex;gap:6px;">' +
      '<button data-act="save" class="btn btn-primary btn-sm">💾 保存</button>' +
      '<button data-act="cancel" class="btn btn-ghost btn-sm">取消</button>' +
    '</div></div>';
}

function formValues(form) {
  const out = {};
  form.querySelectorAll('[data-f]').forEach((inp) => { out[inp.dataset.f] = inp.value; });
  return out;
}

// --- + 新建按钮 ---
function setupAddButton(btnId, listId, opts) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const list = document.getElementById(listId);
    if (!list) return;
    const old = list.querySelector('[data-form-wrap]');
    if (old) old.remove();
    const div = document.createElement('div');
    div.innerHTML = buildForm(opts.formDef);
    list.insertBefore(div.firstChild, list.firstChild);
    const form = list.firstChild;
    form.querySelector('[data-act="cancel"]').onclick = () => form.remove();
    form.querySelector('[data-act="save"]').onclick = async function () {
      const body = { ...opts.defaultBody, ...formValues(form) };
      this.disabled = true; this.textContent = '⏳ 保存中...';
      try {
        await postJSON(opts.apiUrl, body);
        form.remove();
        opts.onSaved();
      } catch (e) {
        alert('保存失败: ' + e.message);
        this.disabled = false; this.textContent = '💾 保存';
      }
    };
  });
}

setupAddButton('btnAddHotel', 'hotelManageList', {
  apiUrl: '/api/admin/hotels',
  defaultBody: { is_active: 1 },
  formDef: {
    title: '🏨 新建酒店', formKey: 'add-hotel',
    fields: [
      { name: 'name', label: '酒店名', required: true },
      { name: 'address', label: '地址' },
      { name: 'description', label: '介绍', type: 'textarea' },
      { name: 'image_url', label: '图片 URL' },
      { name: 'sort_order', label: '排序', type: 'number', value: '99' },
    ],
  },
  onSaved: () => renderHotelManage(),
});

setupAddButton('btnAddTrack', 'trackManageList', {
  apiUrl: '/api/admin/race-tracks',
  defaultBody: { is_active: 1 },
  formDef: {
    title: '🏁 新建赛车场', formKey: 'add-track',
    fields: [
      { name: 'name', label: '赛车场名', required: true },
      { name: 'length_km', label: '长度 (km)', type: 'number', value: '1.0' },
      { name: 'laps', label: '圈数', type: 'number', value: '8' },
      { name: 'difficulty', label: '难度' },
      { name: 'description', label: '介绍', type: 'textarea' },
      { name: 'image_url', label: '图片 URL' },
      { name: 'trial_price', label: '试车价格 (💎/次)', type: 'number', value: '0' },
      { name: 'sort_order', label: '排序', type: 'number', value: '99' },
    ],
  },
  onSaved: () => renderTrackManage(),
});

setupAddButton('btnAddLicReq', 'licenseManageList', {
  apiUrl: '/api/admin/license-req',
  defaultBody: { is_active: 1 },
  formDef: {
    title: '🎫 新增驾照要求', formKey: 'add-lic-req',
    fields: [
      { name: 'exam_type', label: '类型 (B/A/S)', required: true },
      { name: 'title', label: '标题', required: true },
      { name: 'description', label: '介绍', type: 'textarea' },
      { name: 'requirements', label: '要求', type: 'textarea' },
      { name: 'min_age', label: '最小年龄', type: 'number', value: '16' },
      { name: 'duration_minutes', label: '时长 (分钟)', type: 'number', value: '45' },
      { name: 'sort_order', label: '排序', type: 'number', value: '99' },
    ],
  },
  onSaved: () => renderLicenseManage(),
});

// --- ✎ / 🗑 / + 房型 click delegation (3 个 list 各一个) ---

// 酒店管理
(function setupHotelCrud() {
  const list = document.getElementById('hotelManageList');
  if (!list) return;
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = +btn.dataset.id;
    const old = list.querySelector('[data-form-wrap]');
    if (old) old.remove();
    try {
      if (act === 'edit-hotel') {
        const d = await getJSON('/api/admin/manage-hotel');
        const h = (d.hotels || []).find((x) => x.id === id);
        if (!h) throw new Error('酒店不存在');
        const div = document.createElement('div');
        div.innerHTML = buildForm({
          title: '✎ 编辑酒店', formKey: 'edit-hotel-' + id,
          fields: [
            { name: 'name', label: '酒店名', required: true, value: h.name },
            { name: 'address', label: '地址', value: h.address || '' },
            { name: 'description', label: '介绍', type: 'textarea', value: h.description || '' },
            { name: 'image_url', label: '图片 URL', value: h.image_url || '' },
            { name: 'sort_order', label: '排序', type: 'number', value: h.sort_order || 0 },
            { name: 'is_active', label: '上架 (1=是, 0=否)', type: 'number', value: h.is_active != null ? h.is_active : 1 },
          ],
        });
        list.insertBefore(div.firstChild, list.firstChild);
        const form = list.firstChild;
        form.querySelector('[data-act="cancel"]').onclick = () => form.remove();
        form.querySelector('[data-act="save"]').onclick = async function () {
          const v = formValues(form);
          v.is_active = +v.is_active; v.sort_order = +v.sort_order;
          this.disabled = true; this.textContent = '⏳ 保存中...';
          try { await patchJSON('/api/admin/hotels?id=' + id, v); form.remove(); renderHotelManage(); }
          catch (e) { alert('保存失败: ' + e.message); this.disabled = false; this.textContent = '💾 保存'; }
        };
      } else if (act === 'del-hotel') {
        if (!confirm('删除酒店 (会级联删所有房型)?')) return;
        await delJSON('/api/admin/hotels?id=' + id);
        renderHotelManage();
      } else if (act === 'add-room') {
        const div = document.createElement('div');
        div.innerHTML = buildForm({
          title: '🛏️ 新建房型 (酒店 #' + id + ')', formKey: 'add-room-' + id,
          fields: [
            { name: 'name', label: '房型名', required: true },
            { name: 'capacity', label: '人数', type: 'number', value: '2' },
            { name: 'beds', label: '床型', value: '1.8m 大床' },
            { name: 'price_per_night', label: '每晚价格 (💎)', type: 'number', required: true, value: '100' },
            { name: 'breakfast_included', label: '含早餐 (1=是, 0=否)', type: 'number', value: '1' },
            { name: 'description', label: '描述', type: 'textarea' },
            { name: 'image_url', label: '图片 URL' },
            { name: 'sort_order', label: '排序', type: 'number', value: '99' },
          ],
        });
        list.insertBefore(div.firstChild, list.firstChild);
        const form = list.firstChild;
        form.querySelector('[data-act="cancel"]').onclick = () => form.remove();
        form.querySelector('[data-act="save"]').onclick = async function () {
          const v = { ...formValues(form), hotel_id: id };
          v.capacity = +v.capacity || 2;
          v.price_per_night = +v.price_per_night || 0;
          v.breakfast_included = +v.breakfast_included || 0;
          v.sort_order = +v.sort_order || 0;
          this.disabled = true; this.textContent = '⏳ 保存中...';
          try { await postJSON('/api/admin/hotel-rooms', v); form.remove(); renderHotelManage(); }
          catch (e) { alert('保存失败: ' + e.message); this.disabled = false; this.textContent = '💾 保存'; }
        };
      } else if (act === 'edit-room') {
        const d = await getJSON('/api/admin/manage-hotel');
        const r = (d.rooms || []).find((x) => x.id === id);
        if (!r) throw new Error('房型不存在');
        const div = document.createElement('div');
        div.innerHTML = buildForm({
          title: '✎ 编辑房型 #' + id, formKey: 'edit-room-' + id,
          fields: [
            { name: 'name', label: '房型名', required: true, value: r.name },
            { name: 'capacity', label: '人数', type: 'number', value: r.capacity || 2 },
            { name: 'beds', label: '床型', value: r.beds || '' },
            { name: 'price_per_night', label: '每晚价格 (💎)', type: 'number', required: true, value: r.price_per_night },
            { name: 'breakfast_included', label: '含早餐', type: 'number', value: r.breakfast_included != null ? r.breakfast_included : 1 },
            { name: 'description', label: '描述', type: 'textarea', value: r.description || '' },
            { name: 'image_url', label: '图片 URL', value: r.image_url || '' },
            { name: 'sort_order', label: '排序', type: 'number', value: r.sort_order || 0 },
            { name: 'is_active', label: '上架', type: 'number', value: r.is_active != null ? r.is_active : 1 },
          ],
        });
        list.insertBefore(div.firstChild, list.firstChild);
        const form = list.firstChild;
        form.querySelector('[data-act="cancel"]').onclick = () => form.remove();
        form.querySelector('[data-act="save"]').onclick = async function () {
          const v = formValues(form);
          v.capacity = +v.capacity; v.price_per_night = +v.price_per_night;
          v.breakfast_included = +v.breakfast_included; v.sort_order = +v.sort_order; v.is_active = +v.is_active;
          this.disabled = true; this.textContent = '⏳ 保存中...';
          try { await patchJSON('/api/admin/hotel-rooms?id=' + id, v); form.remove(); renderHotelManage(); }
          catch (e) { alert('保存失败: ' + e.message); this.disabled = false; this.textContent = '💾 保存'; }
        };
      } else if (act === 'del-room') {
        if (!confirm('删除房型?')) return;
        await delJSON('/api/admin/hotel-rooms?id=' + id);
        renderHotelManage();
      }
    } catch (err) { alert('操作失败: ' + err.message); }
  });
})();

// 赛车场管理
(function setupTrackCrud() {
  const list = document.getElementById('trackManageList');
  if (!list) return;
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = +btn.dataset.id;
    const old = list.querySelector('[data-form-wrap]');
    if (old) old.remove();
    try {
      if (act === 'edit-track') {
        const d = await getJSON('/api/admin/manage-track');
        const t = (d.tracks || []).find((x) => x.id === id);
        if (!t) throw new Error('赛车场不存在');
        const div = document.createElement('div');
        div.innerHTML = buildForm({
          title: '✎ 编辑赛车场', formKey: 'edit-track-' + id,
          fields: [
            { name: 'name', label: '赛车场名', required: true, value: t.name },
            { name: 'length_km', label: '长度 (km)', type: 'number', value: t.length_km || 0 },
            { name: 'laps', label: '圈数', type: 'number', value: t.laps || 0 },
            { name: 'difficulty', label: '难度', value: t.difficulty || '' },
            { name: 'description', label: '介绍', type: 'textarea', value: t.description || '' },
            { name: 'image_url', label: '图片 URL', value: t.image_url || '' },
            { name: 'trial_price', label: '试车价格 (💎/次)', type: 'number', value: t.trial_price || 0 },
            { name: 'sort_order', label: '排序', type: 'number', value: t.sort_order || 0 },
            { name: 'is_active', label: '上架', type: 'number', value: t.is_active != null ? t.is_active : 1 },
          ],
        });
        list.insertBefore(div.firstChild, list.firstChild);
        const form = list.firstChild;
        form.querySelector('[data-act="cancel"]').onclick = () => form.remove();
        form.querySelector('[data-act="save"]').onclick = async function () {
          const v = formValues(form);
          v.length_km = parseFloat(v.length_km);
          v.laps = +v.laps; v.trial_price = +v.trial_price; v.sort_order = +v.sort_order; v.is_active = +v.is_active;
          this.disabled = true; this.textContent = '⏳ 保存中...';
          try { await patchJSON('/api/admin/race-tracks?id=' + id, v); form.remove(); renderTrackManage(); }
          catch (e) { alert('保存失败: ' + e.message); this.disabled = false; this.textContent = '💾 保存'; }
        };
      } else if (act === 'del-track') {
        if (!confirm('删除赛车场?')) return;
        await delJSON('/api/admin/race-tracks?id=' + id);
        renderTrackManage();
      }
    } catch (err) { alert('操作失败: ' + err.message); }
  });
})();

// 驾照考试要求管理
(function setupLicReqCrud() {
  const list = document.getElementById('licenseManageList');
  if (!list) return;
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = +btn.dataset.id;
    const old = list.querySelector('[data-form-wrap]');
    if (old) old.remove();
    try {
      if (act === 'edit-license') {
        const d = await getJSON('/api/admin/manage-license-req');
        const l = (d.items || []).find((x) => x.id === id);
        if (!l) throw new Error('驾照要求不存在');
        const div = document.createElement('div');
        div.innerHTML = buildForm({
          title: '✎ 编辑驾照要求', formKey: 'edit-lic-' + id,
          fields: [
            { name: 'exam_type', label: '类型 (B/A/S)', required: true, value: l.exam_type },
            { name: 'title', label: '标题', required: true, value: l.title },
            { name: 'description', label: '介绍', type: 'textarea', value: l.description || '' },
            { name: 'requirements', label: '要求', type: 'textarea', value: l.requirements || '' },
            { name: 'min_age', label: '最小年龄', type: 'number', value: l.min_age || 16 },
            { name: 'duration_minutes', label: '时长 (分钟)', type: 'number', value: l.duration_minutes || 30 },
            { name: 'sort_order', label: '排序', type: 'number', value: l.sort_order || 0 },
            { name: 'is_active', label: '上架', type: 'number', value: l.is_active != null ? l.is_active : 1 },
          ],
        });
        list.insertBefore(div.firstChild, list.firstChild);
        const form = list.firstChild;
        form.querySelector('[data-act="cancel"]').onclick = () => form.remove();
        form.querySelector('[data-act="save"]').onclick = async function () {
          const v = formValues(form);
          v.min_age = +v.min_age; v.duration_minutes = +v.duration_minutes; v.sort_order = +v.sort_order; v.is_active = +v.is_active;
          this.disabled = true; this.textContent = '⏳ 保存中...';
          try { await patchJSON('/api/admin/license-req?id=' + id, v); form.remove(); renderLicenseManage(); }
          catch (e) { alert('保存失败: ' + e.message); this.disabled = false; this.textContent = '💾 保存'; }
        };
      } else if (act === 'del-license') {
        if (!confirm('删除驾照要求?')) return;
        await delJSON('/api/admin/license-req?id=' + id);
        renderLicenseManage();
      }
    } catch (err) { alert('操作失败: ' + err.message); }
  });
})();

// super 才看 [data-super-only] 元素 (v27.05: 暴露给 boot 调, 解决 _me 异步还没设的时序问题)
function _showSuperOnly() {
  if (isSuper()) {
    document.querySelectorAll('[data-super-only]').forEach((el) => { el.style.display = ''; });
  }
}
_showSuperOnly();
window._adminManageSuperReady = _showSuperOnly;  // 让 admin.v2541.js boot 完后调

// 挂到 window 供 safeRender 错误显示用
window.renderHotelManage = renderHotelManage;
window.renderTrackManage = renderTrackManage;
window.renderLicenseManage = renderLicenseManage;

})();
