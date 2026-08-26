/* 灯光市 v26 · admin 后台 3 个 manage subview (酒店/赛车场/驾照要求) 重写
 * 之前分散在 admin.v2540.js 嵌套 IIFE 块, 跨 IIFE 引用 + catch 静默吞错导致空白
 * 现在自包含一个文件, fetch + JSON + throw e, 错误冒泡到 safeRender 显式显示
 *
 * 用法: admin-new.html 在 admin.v2540.js 之后加载本文件
 * 挂到 window: renderHotelManage / renderTrackManage / renderLicenseManage / _manageRebuildList
 */
(function(){
'use strict';

function esc(s){
  return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){
    return ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'})[c];
  });
}

const _isSuper = () => (window._me || {}).role === 'super';

// ============================================================
// fetch + JSON, 失败 throw 让 safeRender 显示错误
// ============================================================
async function _fetchManage(keys){
  const url = '/api/admin/manage-data?keys=' + keys;
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' (' + keys + ')');
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'API error');
  return d;
}

// ============================================================
// 3 个 render 函数
// ============================================================
async function renderHotelManage(){
  const list = document.getElementById('hotelManageList');
  const empty = document.getElementById('hotelManageEmpty');
  if (!list || !empty) throw new Error('hotelManage DOM 不存在');
  list.innerHTML = '<p class="empty-state">⏳ 加载中...</p>';
  const d = await _fetchManage('hotels,rooms');
  const hotels = d.hotels || [];
  const rooms = d.rooms || [];
  if (hotels.length === 0){
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  const me = _isSuper();
  list.innerHTML = hotels.map(function(h){
    const hrs = rooms.filter(function(r){ return r.hotel_id === h.id; });
    return '<article class="msg-item ann-item">' +
      '<div class="msg-head"><div class="msg-head-left"><b class="msg-name">🏨 ' + esc(h.name) + '</b>' +
      (h.is_active ? '' : ' <span class="msg-read-tag">已下架</span>') +
      ' <span class="gallery-num">' + hrs.length + ' 房型</span></div>' +
      '<div class="msg-time">' + esc(h.sort_order || 0) + '</div></div>' +
      (h.image_url ? '<div style="margin:8px 0;"><img src="' + esc(h.image_url) + '" loading="lazy" onerror="this.style.opacity=\'0.25\'" style="max-width:240px;max-height:120px;border:2px solid var(--c-stone);" alt="酒店图片" /></div>' : '') +
      (h.address ? '<div class="msg-content">📍 ' + esc(h.address) + '</div>' : '') +
      (h.description ? '<div class="msg-content" style="white-space:pre-wrap">' + esc(h.description) + '</div>' : '') +
      (hrs.length > 0 ? '<div style="margin:8px 0;padding:8px;background:var(--c-bg-2);border:1px solid var(--c-stone);">' +
        hrs.map(function(r){
          return '<div style="display:flex;gap:6px;align-items:center;font-family:var(--font-pixel);font-size:11px;padding:4px 0;">' +
            '<span style="flex:1;">🛏️ ' + esc(r.name) + ' · ' + r.capacity + '人 · ' + (r.breakfast_included ? '🍳' : '—') + '</span>' +
            '<span style="color:var(--c-grass-dark);font-weight:700;">💎 ' + r.price_per_night + '/晚</span>' +
            (me ? '<button data-act="edit-room" data-id="' + r.id + '" class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 6px;">✎</button>' +
            '<button data-act="del-room" data-id="' + r.id + '" class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 6px;">🗑</button>' : '') +
            '</div>';
        }).join('') + '</div>' : '') +
      (me ? '<div class="msg-actions book-actions">' +
        '<button data-act="edit-hotel" data-id="' + h.id + '" class="btn btn-primary btn-sm">✎ 编辑酒店</button>' +
        '<button data-act="add-room" data-id="' + h.id + '" class="btn btn-primary btn-sm">+ 房型</button>' +
        '<button data-act="del-hotel" data-id="' + h.id + '" class="btn btn-ghost btn-sm" style="background:#c33;color:white;">🗑 删除</button>' +
      '</div>' : '') +
      '</article>';
  }).join('');
}

async function renderTrackManage(){
  const list = document.getElementById('trackManageList');
  const empty = document.getElementById('trackManageEmpty');
  if (!list || !empty) throw new Error('trackManage DOM 不存在');
  list.innerHTML = '<p class="empty-state">⏳ 加载中...</p>';
  const d = await _fetchManage('tracks');
  const tracks = d.tracks || [];
  if (tracks.length === 0){
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  const me = _isSuper();
  list.innerHTML = tracks.map(function(t){
    return '<article class="msg-item ann-item">' +
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
      '</article>';
  }).join('');
}

async function renderLicenseManage(){
  const list = document.getElementById('licenseManageList');
  const empty = document.getElementById('licenseManageEmpty');
  if (!list || !empty) throw new Error('licenseManage DOM 不存在');
  list.innerHTML = '<p class="empty-state">⏳ 加载中...</p>';
  const d = await _fetchManage('licenseReq');
  const reqs = d.licenseReq || [];
  if (reqs.length === 0){
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  const me = _isSuper();
  list.innerHTML = reqs.map(function(l){
    return '<article class="msg-item ann-item">' +
      '<div class="msg-head"><div class="msg-head-left"><b class="msg-name">🎫 ' + esc(l.exam_type) + ' 级 · ' + esc(l.title) + '</b></div>' +
      '<div class="msg-time">' + (l.min_age || 16) + '+ · ' + (l.duration_minutes || 30) + ' 分钟</div></div>' +
      (l.description ? '<div class="msg-content" style="white-space:pre-wrap">' + esc(l.description) + '</div>' : '') +
      (l.requirements ? '<div class="msg-content" style="background:#fff8e0;">📋 ' + esc(l.requirements) + '</div>' : '') +
      (me ? '<div class="msg-actions book-actions">' +
        '<button data-act="edit-license" data-id="' + l.id + '" class="btn btn-primary btn-sm">✎ 编辑</button>' +
        '<button data-act="del-license" data-id="' + l.id + '" class="btn btn-ghost btn-sm" style="background:#c33;color:white;">🗑 删除</button>' +
      '</div>' : '') +
      '</article>';
  }).join('');
}

// ============================================================
// sub-tab 切换 + + 新建 / ✎ / 🗑 / + 房型 全部 click delegation
// ============================================================
function _rebuildList(pane){
  // 重新渲染当前 manage subview (清掉所有 inline form, 重新拉数据)
  const sub = document.querySelector('.subtab.active[data-sub="manage"]');
  if (!sub) return;
  if (pane === 'bookings') renderHotelManage();
  else if (pane === 'license') renderLicenseManage();
  else if (pane === 'kart') renderTrackManage();
}
window._manageRebuildList = _rebuildList;

function _buildForm(opts){
  const fields = opts.fields.map(function(f){
    return '<label style="display:block;margin:6px 0;font-size:13px;">' +
      '<span style="display:block;font-weight:700;margin-bottom:2px;">' + esc(f.label) + (f.required ? ' *' : '') + '</span>' +
      (f.type === 'textarea' ? '<textarea data-f="' + f.name + '" rows="3" style="width:100%;padding:6px;border:2px solid var(--c-black);font-family:var(--font-cn);">' + esc(f.value || '') + '</textarea>'
        : '<input data-f="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(f.value == null ? '' : f.value) + '" style="width:100%;padding:6px;border:2px solid var(--c-black);font-family:var(--font-cn);" />') +
      '</label>';
  }).join('');
  return '<div data-form-wrap="' + esc(opts.formKey) + '" style="background:#fffbe5;border:3px solid var(--c-black);padding:12px;margin:8px 0;box-shadow:4px 4px 0 var(--c-stone-dark);">' +
    '<div style="font-weight:700;color:var(--c-grass-dark);margin-bottom:8px;">' + esc(opts.title) + '</div>' +
    fields +
    '<div style="margin-top:8px;display:flex;gap:6px;">' +
      '<button data-act="save" class="btn btn-primary btn-sm">💾 保存</button>' +
      '<button data-act="cancel" class="btn btn-ghost btn-sm">取消</button>' +
    '</div></div>';
}

function _formValues(form){
  const out = {};
  form.querySelectorAll('[data-f]').forEach(function(inp){ out[inp.dataset.f] = inp.value; });
  return out;
}

async function _apiCall(method, url, body){
  const opts = { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const d = await r.json().catch(function(){ return {}; });
  if (!r.ok || d.error) throw new Error(d.error || '操作失败 (HTTP ' + r.status + ')');
  return d;
}

// 通用 inline form 保存 (等文件读取完成)
async function _submitForm(btn, action, body, onSuccess){
  const form = btn.closest('[data-form-wrap]');
  // 等所有 pending file reads 完成 (10s 保护)
  const pendingFiles = form.querySelectorAll('input[type="file"][name^="_file_"]');
  await Promise.all([].slice.call(pendingFiles).map(function(fi){
    if (!fi.files || !fi.files[0] || !fi._fileReading) return Promise.resolve();
    return new Promise(function(res){
      const intId = setInterval(function(){
        if (!fi._fileReading) { clearInterval(intId); res(); }
      }, 50);
      setTimeout(function(){ clearInterval(intId); res(); }, 10000);
    });
  }));
  const inputs = form.querySelectorAll('[data-f]');
  inputs.forEach(function(inp){ body[inp.dataset.f] = inp.value; });
  btn.disabled = true; btn.textContent = '⏳ 保存中...';
  try {
    await _apiCall('POST', action, body);
    if (onSuccess) onSuccess();
  } catch (e) {
    alert('保存失败: ' + e.message);
    btn.disabled = false; btn.textContent = '💾 保存';
  }
}

// + 新建按钮 (通用)
function _setupAddButton(btnId, listId, opts){
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', function(){
    const list = document.getElementById(listId);
    if (!list) return;
    const oldForm = list.querySelector('[data-form-wrap]');
    if (oldForm) oldForm.remove();
    const div = document.createElement('div');
    div.innerHTML = _buildForm(opts.formDef);
    list.insertBefore(div.firstChild, list.firstChild);
    const form = list.firstChild;
    if (window._attachFileUpload) window._attachFileUpload(form);
    form.querySelector('[data-act="cancel"]').onclick = function(){ form.remove(); };
    form.querySelector('[data-act="save"]').onclick = function(){
      _submitForm(this, opts.apiUrl, { is_active: 1 }, function(){
        form.remove();
        opts.onSaved();
      });
    };
  });
}

// ✎ / 🗑 / + 房型 通用 list container delegation
function _setupCrudHandlers(listId, handlers){
  const list = document.getElementById(listId);
  if (!list) return;
  const key = '_crud_' + listId;
  if (list[key]) list.removeEventListener('click', list[key]);
  list[key] = async function(e){
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = +btn.dataset.id;
    const wrap = list.querySelector('[data-form-wrap]');
    if (wrap) wrap.remove();
    if (handlers[act]) {
      try { await handlers[act](id, list); }
      catch (err) { alert('操作失败: ' + err.message); }
    }
  };
  list.addEventListener('click', list[key]);
}

// ============================================================
// sub-tab 切换 (切到 manage 子 tab 时调对应 render)
// ============================================================
document.addEventListener('click', async function(e){
  const tab = e.target.closest('.subtab');
  if (!tab) return;
  const nav = tab.closest('.subtabs');
  if (!nav) return;
  const pane = nav.dataset.pane;
  const sub = tab.dataset.sub;
  nav.querySelectorAll('.subtab').forEach(function(b){ b.classList.toggle('active', b === tab); });
  document.querySelectorAll('.subview[data-subview^="'+pane+'-"]').forEach(function(sv){
    sv.classList.toggle('active', sv.dataset.subview === pane+'-'+sub);
  });
  if (sub === 'manage') {
    try {
      if (pane === 'bookings') await renderHotelManage();
      else if (pane === 'license') await renderLicenseManage();
      else if (pane === 'kart') await renderTrackManage();
    } catch (err) {
      // 错误显式显示在 list 容器里
      const listIds = { bookings: 'hotelManageList', license: 'licenseManageList', kart: 'trackManageList' };
      const el = document.getElementById(listIds[pane]);
      if (el) el.innerHTML = '<div class="empty-state" style="color:#c44"><div class="empty-icon">⚠️</div><p>加载失败: ' + (err.message || err) + '</p></div>';
      console.error('[admin-manage] 加载失败:', err);
    }
  }
});

// super 才看 manage + / ✎ / 🗑
function _toggleSuperOnly(){
  if (_isSuper()) {
    document.querySelectorAll('[data-super-only]').forEach(function(el){ el.style.display = ''; });
  }
}

// ============================================================
// + 酒店 / + 赛车场 / + 驾照要求 按钮
// ============================================================
_setupAddButton('btnAddHotel', 'hotelManageList', {
  apiUrl: '/api/admin/hotels',
  formDef: {
    title: '🏨 新建酒店', formKey: 'add-hotel',
    fields: [
      {name: 'name', label: '酒店名', required: true},
      {name: 'address', label: '地址'},
      {name: 'description', label: '介绍', type: 'textarea'},
      {name: 'image_url', label: '图片 URL (或选文件)'},
      {name: 'sort_order', label: '排序', type: 'number', value: '99'},
    ]
  },
  onSaved: function(){ renderHotelManage(); }
});
_setupAddButton('btnAddTrack', 'trackManageList', {
  apiUrl: '/api/admin/race-tracks',
  formDef: {
    title: '🏁 新建赛车场', formKey: 'add-track',
    fields: [
      {name: 'name', label: '赛车场名', required: true},
      {name: 'length_km', label: '长度 (km)', type: 'number', value: '1.0'},
      {name: 'laps', label: '圈数', type: 'number', value: '8'},
      {name: 'difficulty', label: '难度 (简单/中等/困难)'},
      {name: 'description', label: '介绍', type: 'textarea'},
      {name: 'image_url', label: '图片 URL (或选文件)'},
      {name: 'trial_price', label: '试车价格 (💎/次)', type: 'number', value: '0'},
      {name: 'sort_order', label: '排序', type: 'number', value: '99'},
    ]
  },
  onSaved: function(){ renderTrackManage(); }
});
_setupAddButton('btnAddLicReq', 'licenseManageList', {
  apiUrl: '/api/admin/license-req',
  formDef: {
    title: '🎫 新增驾照要求', formKey: 'add-lic-req',
    fields: [
      {name: 'exam_type', label: '类型 (B / A / S)', required: true},
      {name: 'title', label: '标题', required: true},
      {name: 'description', label: '介绍', type: 'textarea'},
      {name: 'requirements', label: '要求', type: 'textarea'},
      {name: 'min_age', label: '最小年龄', type: 'number', value: '16'},
      {name: 'duration_minutes', label: '时长 (分钟)', type: 'number', value: '45'},
      {name: 'sort_order', label: '排序', type: 'number', value: '99'},
    ]
  },
  onSaved: function(){ renderLicenseManage(); }
});

// ============================================================
// ✎ / 🗑 / + 房型 click handlers
// ============================================================

// 酒店管理 + 房型管理
_setupCrudHandlers('hotelManageList', {
  'edit-hotel': async function(id, list){
    const d = await _fetchManage('hotels,rooms');
    const item = (d.hotels || []).find(function(h){ return h.id === id; });
    if (!item) throw new Error('酒店不存在');
    const div = document.createElement('div');
    div.innerHTML = _buildForm({
      title: '✎ 编辑酒店', formKey: 'edit-hotel-' + id,
      fields: [
        {name: 'name', label: '酒店名', required: true, value: item.name},
        {name: 'address', label: '地址', value: item.address || ''},
        {name: 'description', label: '介绍', type: 'textarea', value: item.description || ''},
        {name: 'image_url', label: '图片 URL', value: item.image_url || ''},
        {name: 'sort_order', label: '排序', type: 'number', value: item.sort_order || 0},
        {name: 'is_active', label: '上架 (1=是, 0=否)', type: 'number', value: item.is_active != null ? item.is_active : 1},
      ]
    });
    list.insertBefore(div.firstChild, list.firstChild);
    const form = list.firstChild;
    if (window._attachFileUpload) window._attachFileUpload(form);
    form.querySelector('[data-act="cancel"]').onclick = function(){ form.remove(); };
    form.querySelector('[data-act="save"]').onclick = async function(){
      const v = _formValues(form);
      v.is_active = parseInt(v.is_active, 10);
      v.sort_order = parseInt(v.sort_order, 10);
      try {
        await _apiCall('PATCH', '/api/admin/hotels?id=' + id, v);
        form.remove();
        renderHotelManage();
      } catch (e) { alert('保存失败: ' + e.message); }
    };
  },
  'del-hotel': async function(id){
    if (!confirm('删除酒店 (会级联删所有房型)?')) return;
    await _apiCall('DELETE', '/api/admin/hotels?id=' + id);
    renderHotelManage();
  },
  'add-room': async function(id, list){
    const div = document.createElement('div');
    div.innerHTML = _buildForm({
      title: '🛏️ 新建房型 (酒店 #' + id + ')', formKey: 'add-room-' + id,
      fields: [
        {name: 'name', label: '房型名', required: true},
        {name: 'capacity', label: '人数', type: 'number', value: 2},
        {name: 'beds', label: '床型', value: '1.8m 大床'},
        {name: 'price_per_night', label: '每晚价格 (💎)', type: 'number', required: true, value: 100},
        {name: 'breakfast_included', label: '含早餐 (1=是, 0=否)', type: 'number', value: 1},
        {name: 'description', label: '描述', type: 'textarea'},
        {name: 'image_url', label: '图片 URL (或选文件)'},
        {name: 'sort_order', label: '排序', type: 'number', value: 99},
      ]
    });
    list.insertBefore(div.firstChild, list.firstChild);
    const form = list.firstChild;
    if (window._attachFileUpload) window._attachFileUpload(form);
    form.querySelector('[data-act="cancel"]').onclick = function(){ form.remove(); };
    form.querySelector('[data-act="save"]').onclick = async function(){
      const v = _formValues(form);
      v.hotel_id = id;
      v.capacity = parseInt(v.capacity, 10) || 2;
      v.price_per_night = parseInt(v.price_per_night, 10) || 0;
      v.breakfast_included = parseInt(v.breakfast_included, 10) || 0;
      v.sort_order = parseInt(v.sort_order, 10) || 0;
      try {
        await _apiCall('POST', '/api/admin/hotel-rooms', v);
        form.remove();
        renderHotelManage();
      } catch (e) { alert('保存失败: ' + e.message); }
    };
  },
  'edit-room': async function(id, list){
    const d = await _fetchManage('rooms');
    const r = (d.rooms || []).find(function(x){ return x.id === id; });
    if (!r) throw new Error('房型不存在');
    const div = document.createElement('div');
    div.innerHTML = _buildForm({
      title: '✎ 编辑房型 #' + id, formKey: 'edit-room-' + id,
      fields: [
        {name: 'name', label: '房型名', required: true, value: r.name},
        {name: 'capacity', label: '人数', type: 'number', value: r.capacity || 2},
        {name: 'beds', label: '床型', value: r.beds || ''},
        {name: 'price_per_night', label: '每晚价格 (💎)', type: 'number', required: true, value: r.price_per_night},
        {name: 'breakfast_included', label: '含早餐', type: 'number', value: r.breakfast_included != null ? r.breakfast_included : 1},
        {name: 'description', label: '描述', type: 'textarea', value: r.description || ''},
        {name: 'image_url', label: '图片 URL (或选文件)', value: r.image_url || ''},
        {name: 'sort_order', label: '排序', type: 'number', value: r.sort_order || 0},
        {name: 'is_active', label: '上架', type: 'number', value: r.is_active != null ? r.is_active : 1},
      ]
    });
    list.insertBefore(div.firstChild, list.firstChild);
    const form = list.firstChild;
    if (window._attachFileUpload) window._attachFileUpload(form);
    form.querySelector('[data-act="cancel"]').onclick = function(){ form.remove(); };
    form.querySelector('[data-act="save"]').onclick = async function(){
      const v = _formValues(form);
      v.capacity = parseInt(v.capacity, 10);
      v.price_per_night = parseInt(v.price_per_night, 10);
      v.breakfast_included = parseInt(v.breakfast_included, 10);
      v.sort_order = parseInt(v.sort_order, 10);
      v.is_active = parseInt(v.is_active, 10);
      try {
        await _apiCall('PATCH', '/api/admin/hotel-rooms?id=' + id, v);
        form.remove();
        renderHotelManage();
      } catch (e) { alert('保存失败: ' + e.message); }
    };
  },
  'del-room': async function(id){
    if (!confirm('删除房型?')) return;
    await _apiCall('DELETE', '/api/admin/hotel-rooms?id=' + id);
    renderHotelManage();
  }
});

// 赛车场管理
_setupCrudHandlers('trackManageList', {
  'edit-track': async function(id, list){
    const d = await _fetchManage('tracks');
    const t = (d.tracks || []).find(function(x){ return x.id === id; });
    if (!t) throw new Error('赛车场不存在');
    const div = document.createElement('div');
    div.innerHTML = _buildForm({
      title: '✎ 编辑赛车场', formKey: 'edit-track-' + id,
      fields: [
        {name: 'name', label: '赛车场名', required: true, value: t.name},
        {name: 'length_km', label: '长度 (km)', type: 'number', value: t.length_km || 0},
        {name: 'laps', label: '圈数', type: 'number', value: t.laps || 0},
        {name: 'difficulty', label: '难度', value: t.difficulty || ''},
        {name: 'description', label: '介绍', type: 'textarea', value: t.description || ''},
        {name: 'image_url', label: '图片 URL', value: t.image_url || ''},
        {name: 'trial_price', label: '试车价格 (💎/次)', type: 'number', value: t.trial_price || 0},
        {name: 'sort_order', label: '排序', type: 'number', value: t.sort_order || 0},
        {name: 'is_active', label: '上架', type: 'number', value: t.is_active != null ? t.is_active : 1},
      ]
    });
    list.insertBefore(div.firstChild, list.firstChild);
    const form = list.firstChild;
    if (window._attachFileUpload) window._attachFileUpload(form);
    form.querySelector('[data-act="cancel"]').onclick = function(){ form.remove(); };
    form.querySelector('[data-act="save"]').onclick = async function(){
      const v = _formValues(form);
      v.length_km = parseFloat(v.length_km);
      v.laps = parseInt(v.laps, 10);
      v.trial_price = parseInt(v.trial_price, 10);
      v.sort_order = parseInt(v.sort_order, 10);
      v.is_active = parseInt(v.is_active, 10);
      try {
        await _apiCall('PATCH', '/api/admin/race-tracks?id=' + id, v);
        form.remove();
        renderTrackManage();
      } catch (e) { alert('保存失败: ' + e.message); }
    };
  },
  'del-track': async function(id){
    if (!confirm('删除赛车场?')) return;
    await _apiCall('DELETE', '/api/admin/race-tracks?id=' + id);
    renderTrackManage();
  }
});

// 驾照考试要求管理
_setupCrudHandlers('licenseManageList', {
  'edit-license': async function(id, list){
    const d = await _fetchManage('licenseReq');
    const l = (d.licenseReq || []).find(function(x){ return x.id === id; });
    if (!l) throw new Error('驾照要求不存在');
    const div = document.createElement('div');
    div.innerHTML = _buildForm({
      title: '✎ 编辑驾照要求', formKey: 'edit-lic-' + id,
      fields: [
        {name: 'exam_type', label: '类型 (B/A/S)', required: true, value: l.exam_type},
        {name: 'title', label: '标题', required: true, value: l.title},
        {name: 'description', label: '介绍', type: 'textarea', value: l.description || ''},
        {name: 'image_url', label: '图片 URL (或选文件)', value: l.image_url || ''},
        {name: 'requirements', label: '要求', type: 'textarea', value: l.requirements || ''},
        {name: 'min_age', label: '最小年龄', type: 'number', value: l.min_age || 16},
        {name: 'duration_minutes', label: '时长 (分钟)', type: 'number', value: l.duration_minutes || 30},
        {name: 'sort_order', label: '排序', type: 'number', value: l.sort_order || 0},
        {name: 'is_active', label: '上架', type: 'number', value: l.is_active != null ? l.is_active : 1},
      ]
    });
    list.insertBefore(div.firstChild, list.firstChild);
    const form = list.firstChild;
    if (window._attachFileUpload) window._attachFileUpload(form);
    form.querySelector('[data-act="cancel"]').onclick = function(){ form.remove(); };
    form.querySelector('[data-act="save"]').onclick = async function(){
      const v = _formValues(form);
      v.min_age = parseInt(v.min_age, 10);
      v.duration_minutes = parseInt(v.duration_minutes, 10);
      v.sort_order = parseInt(v.sort_order, 10);
      v.is_active = parseInt(v.is_active, 10);
      try {
        await _apiCall('PATCH', '/api/admin/license-req?id=' + id, v);
        form.remove();
        renderLicenseManage();
      } catch (e) { alert('保存失败: ' + e.message); }
    };
  },
  'del-license': async function(id){
    if (!confirm('删除驾照要求?')) return;
    await _apiCall('DELETE', '/api/admin/license-req?id=' + id);
    renderLicenseManage();
  }
});

// 启动时如果已登录, 立即显示 super-only 元素
if (window._me) _toggleSuperOnly();
window._adminManageSuperReady = _toggleSuperOnly;  // 让 admin.v2540.js boot() 调用

// 挂到 window
window.renderHotelManage = renderHotelManage;
window.renderTrackManage = renderTrackManage;
window.renderLicenseManage = renderLicenseManage;

})();
