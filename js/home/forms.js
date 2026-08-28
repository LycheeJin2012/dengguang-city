// v45 重写: 服务区表单 (酒店/赛车/驾照) + 留言提交 + 30s 自动刷新
// 原 main.js L123-200 (留言) + L700-1304 (kart/circuit/license/hotel modals) 拆出来
import { $, escHtml, POST, GET } from './util.js?v=v45-fix-401';
import { openLoginModal } from './auth.js';
import { getBundle, invalidateBundle } from './bundle.js';
import { loadPublicMessages } from './messages.js';
const _toast = (msg, type) => window._toast && window._toast(msg, type);

// ============== 留言提交 (顶栏的 "发表留言" 按钮) ==============
function bindMessageSubmit() {
  const form = $('#contactForm');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const inputs = form.querySelectorAll('input, select, textarea');
    const name = (inputs[0]?.value || '').trim();
    const contact = (inputs[1]?.value || '').trim();
    const type = inputs[2]?.value;
    const content = (inputs[3]?.value || '').trim();
    const btn = form.querySelector('button[type="submit"]');
    const origTxt = btn.textContent;
    if (!name || !content) {
      btn.textContent = '请完整填写 ✗';
      btn.style.background = 'var(--c-redstone)';
      setTimeout(() => { btn.textContent = origTxt; btn.style.background = ''; }, 1800);
      return;
    }
    btn.textContent = '提交中...';
    btn.disabled = true;
    try {
      const res = await fetch('/api/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, contact, type, content })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        btn.textContent = '✓ 已提交';
        btn.style.background = 'var(--c-emerald)';
        form.reset();
        await loadPublicMessages();
      } else if (res.status === 401 || /登录/.test(data.error || '')) {
        btn.textContent = '请先登录玩家账号';
        btn.style.background = 'var(--c-redstone)';
        setTimeout(() => openLoginModal('请先登录玩家账号再发留言'), 1500);
      } else {
        btn.textContent = '✗ ' + (data.error || '提交失败');
        btn.style.background = 'var(--c-redstone)';
      }
    } catch (err) {
      btn.textContent = '提交失败 ✗';
      btn.style.background = 'var(--c-redstone)';
    }
    setTimeout(() => { btn.textContent = origTxt; btn.style.background = ''; btn.disabled = false; }, 2200);
  });
}

// ============== 30s 自动刷新留言 (跳过正在输入) ==============
function bindMessageAutoRefresh() {
  if (!$('#publicMessageBoard')) return;
  setInterval(() => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type !== 'radio' && ae.type !== 'checkbox'))) {
      return;
    }
    loadPublicMessages();
  }, 30000);
}

// ============== 赛车 (kart) 报名 modal ==============
function bindKart() {
  const mask = $('#kartMask');
  const form = $('#kartForm');
  if (!mask || !form) return;
  const open = () => {
    $('#kartMsg').textContent = '';
    mask.style.display = '';
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#kartName')?.focus(), 50);
  };
  const close = () => { mask.style.display = 'none'; document.body.style.overflow = ''; form.reset(); };
  $('#btnKartSignup')?.addEventListener('click', open);
  $('#kartClose')?.addEventListener('click', close);
  $('#kartCancel')?.addEventListener('click', close);
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  document.addEventListener('keydown', e => { if (mask.style.display === '' && e.key === 'Escape') close(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#kartName')?.value.trim();
    const contact = $('#kartContact')?.value.trim();
    if (!name || !contact) { $('#kartMsg').textContent = '请填写游戏 ID 和联系方式'; return; }
    const session = $('#kartSession')?.value;
    const car = $('#kartCar')?.value.trim();
    const note = $('#kartNote')?.value.trim();
    const submitBtn = form.querySelector('button[type="submit"]');
    const origText = submitBtn.textContent;
    submitBtn.textContent = '提交中...';
    submitBtn.disabled = true;
    $('#kartMsg').textContent = '';
    try {
      const data = await POST('/api/kart', { name, contact, session, car, note });
      submitBtn.textContent = '✓ 报名已提交（跨设备同步）';
      submitBtn.style.background = 'var(--c-emerald)';
      form.reset();
      setTimeout(() => close(), 1500);
    } catch (err) {
      if (err.message && /登录|会话/.test(err.message)) {
        $('#kartMsg').textContent = '请先登录玩家账号';
        setTimeout(() => { close(); openLoginModal('请先登录玩家账号再报名'); }, 1000);
      } else {
        $('#kartMsg').textContent = '✗ ' + err.message;
      }
    } finally {
      setTimeout(() => { submitBtn.textContent = origText; submitBtn.style.background = ''; submitBtn.disabled = false; }, 2200);
    }
  });
}

// ============== 国际赛车场 (circuit) 报名 modal ==============
function bindCircuit() {
  const mask = $('#circuitMask');
  const form = $('#circuitForm');
  if (!mask || !form) return;

  function refreshTrackOptions() {
    const sel = $('#circuitTrackId');
    if (!sel) return;
    // 同步拉一次 (避免 bundle 还没就绪时打开)
    getBundle().then(b => {
      const tracks = b.tracks || [];
      if (!tracks.length) { sel.innerHTML = '<option value="">(暂无开放赛道)</option>'; return; }
      sel.innerHTML = tracks.map(t =>
        `<option value="${t.id}">${escHtml(t.name)} - ${t.trial_price || 0}💎/次</option>`
      ).join('');
    });
  }

  const open = () => {
    $('#circuitMsg').textContent = '';
    refreshTrackOptions();
    mask.style.display = '';
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#circuitName')?.focus(), 50);
  };
  const close = () => { mask.style.display = 'none'; document.body.style.overflow = ''; form.reset(); };
  $('#btnCircuitSignup')?.addEventListener('click', open);
  $('#circuitClose')?.addEventListener('click', close);
  $('#circuitCancel')?.addEventListener('click', close);
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  document.addEventListener('keydown', e => { if (mask.style.display === '' && e.key === 'Escape') close(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#circuitName')?.value.trim();
    const contact = $('#circuitContact')?.value.trim();
    if (!name || !contact) { $('#circuitMsg').textContent = '请填写游戏 ID 和联系方式'; return; }
    const submitBtn = form.querySelector('button[type="submit"]');
    const origText = submitBtn.textContent;
    submitBtn.textContent = '提交中...';
    submitBtn.disabled = true;
    $('#circuitMsg').textContent = '';
    try {
      await POST('/api/circuit', {
        name, contact,
        track_id: parseInt($('#circuitTrackId')?.value || 0, 10) || null,
        license: $('#circuitLicense')?.value,
        session: $('#circuitSession')?.value,
        car: $('#circuitCar')?.value.trim(),
        note: $('#circuitNote')?.value.trim()
      });
      submitBtn.textContent = '✓ 报名已提交（跨设备同步）';
      submitBtn.style.background = 'var(--c-emerald)';
      form.reset();
      setTimeout(() => close(), 1500);
    } catch (err) {
      if (err.message && /登录|会话/.test(err.message)) {
        $('#circuitMsg').textContent = '请先登录玩家账号';
        setTimeout(() => { close(); openLoginModal('请先登录玩家账号再报名'); }, 1000);
      } else {
        $('#circuitMsg').textContent = '✗ ' + err.message;
      }
    } finally {
      setTimeout(() => { submitBtn.textContent = origText; submitBtn.style.background = ''; submitBtn.disabled = false; }, 2200);
    }
  });
}

// ============== 驾照考试报名 modal ==============
function bindLicense() {
  const mask = $('#licenseMask');
  const form = $('#licenseForm');
  if (!mask || !form) return;
  let _type = 'written';
  const open = (type, grade) => {
    _type = type;
    const typeMap = { written: '笔试 - 选择题 + 简答', road: '路考 - 实景驾驶', upgrade: '升级赛 - 极限测试' };
    const t = $('#licenseTitle'); if (t) t.textContent = `${grade} 级驾照报名`;
    const gl = $('#licenseGradeLabel'); if (gl) gl.textContent = `${grade} 级`;
    const tl = $('#licenseTypeLabel'); if (tl) tl.textContent = typeMap[type] || '';
    const c = $('#licenseContact'); if (c) c.value = '';
    const n = $('#licenseNote'); if (n) n.value = '';
    const m = $('#licenseMsg'); if (m) m.textContent = '';
    mask.style.display = '';
    document.body.style.overflow = 'hidden';
  };
  const close = () => { mask.style.display = 'none'; document.body.style.overflow = ''; };
  $('#licenseClose')?.addEventListener('click', close);
  $('#licenseCancel')?.addEventListener('click', close);
  mask.addEventListener('click', e => { if (e.target === mask) close(); });

  document.querySelectorAll('[data-license]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.license;
      const grade = btn.dataset.grade || '?';
      fetch('/api/login', { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          if (d && d.ok && d.player) {
            if (d.player.email) { const c = $('#licenseContact'); if (c) c.value = d.player.email; }
            open(type, grade);
          } else {
            openLoginModal('请先登录玩家账号再报名考试');
          }
        })
        .catch(() => openLoginModal('网络错误，请稍后再试'));
    });
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const origTxt = submitBtn.textContent;
    const msg = $('#licenseMsg');
    msg.textContent = '';
    submitBtn.textContent = '提交中...';
    submitBtn.disabled = true;
    try {
      const data = await POST('/api/license', {
        exam_type: _type,
        exam_date: $('#licenseDate')?.value,
        exam_session: $('#licenseSession')?.value,
        contact: $('#licenseContact')?.value.trim(),
        note: $('#licenseNote')?.value.trim()
      });
      msg.textContent = '✓ ' + (data.message || '报名成功');
      msg.style.color = 'var(--c-emerald)';
      setTimeout(() => { close(); msg.style.color = ''; form.reset(); }, 1500);
    } catch (err) {
      if (err.message && /登录|会话/.test(err.message)) {
        close();
        openLoginModal(err.message || '请先登录玩家账号');
      } else {
        msg.textContent = '✗ ' + err.message;
        msg.style.color = 'var(--c-redstone)';
      }
    } finally {
      submitBtn.textContent = origTxt;
      submitBtn.disabled = false;
    }
  });
}

// ============== 酒店预订 modal (复杂, 含早餐/晚数/总价) ==============
const ROOMS = [];
const BFAST_PER_NIGHT_PER_PERSON = 10;
let bookRoom = null;

function openBookModal(roomId) {
  const r = ROOMS.find(x => String(x.id) === String(roomId));
  if (!r) return;
  bookRoom = r;
  const t = $('#bookTitle'); if (t) t.textContent = `预订 · ${r.name}`;
  const s = $('#bookSummary');
  if (s) s.innerHTML = `
    <div><b>${r.icon} ${r.name}</b><br/><span class="book-sub">${r.bed} · ${r.guests}</span></div>
    <div class="summary-price">💎 ${r.price} / 晚</div>`;
  // 自动填玩家信息
  fetch('/api/login', { credentials: 'include' })
    .then(r => r.json())
    .then(d => {
      if (d && d.ok && d.player) {
        const n = $('#bookName'); if (n && !n.value) n.value = d.player.username;
        const c = $('#bookContact'); if (c && !c.value && d.player.email) c.value = d.player.email;
      }
    }).catch(() => {});
  // 默认日期
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);
  const bi = $('#bookIn'); if (bi) bi.value = tomorrow.toISOString().slice(0, 10);
  const bo = $('#bookOut'); if (bo) bo.value = dayAfter.toISOString().slice(0, 10);
  const m = $('#bookMsg'); if (m) m.textContent = '';
  updateBookTotal();
  const mask = $('#bookMask');
  if (mask) { mask.style.display = ''; document.body.style.overflow = 'hidden'; }
  setTimeout(() => $('#bookName')?.focus(), 50);
}

function closeBookModal() {
  const mask = $('#bookMask');
  if (!mask) return;
  mask.style.display = 'none';
  document.body.style.overflow = '';
  $('#bookForm')?.reset();
  bookRoom = null;
}

function updateBookTotal() {
  if (!bookRoom) return;
  const inD = new Date($('#bookIn')?.value);
  const outD = new Date($('#bookOut')?.value);
  const bn = $('#bookNights');
  const bt = $('#bookTotal');
  if (isNaN(inD) || isNaN(outD) || outD <= inD) {
    if (bn) bn.textContent = '— 请选择有效日期';
    if (bt) bt.textContent = '—';
    return;
  }
  const nights = Math.round((outD - inD) / 86400000);
  const persons = parseInt($('#bookGuests')?.value, 10) || 1;
  const wantBf = $('#bookBreakfast')?.checked;
  const price = bookRoom.price || 0;
  const bfCost = wantBf ? nights * persons * BFAST_PER_NIGHT_PER_PERSON : 0;
  if (bn) bn.textContent = `${nights} 晚 · ${persons} 人${wantBf ? ' · 含早餐' : ''}`;
  let totalText = `💎 ${nights * price + bfCost} 绿宝石（房费 ${nights} 晚 × ${price}`;
  if (bfCost) totalText += ` + 早餐 ${nights} 晚 × ${persons} 人 × ${BFAST_PER_NIGHT_PER_PERSON}`;
  totalText += '）';
  if (bt) bt.textContent = totalText;
}

function bindHotel() {
  const mask = $('#bookMask');
  if (!mask) return;
  $('#bookClose')?.addEventListener('click', closeBookModal);
  $('#bookCancel')?.addEventListener('click', closeBookModal);
  mask.addEventListener('click', e => { if (e.target === mask) closeBookModal(); });
  document.addEventListener('keydown', e => { if (mask.style.display === '' && e.key === 'Escape') closeBookModal(); });
  $('#bookIn')?.addEventListener('change', updateBookTotal);
  $('#bookOut')?.addEventListener('change', updateBookTotal);
  $('#bookBreakfast')?.addEventListener('change', updateBookTotal);
  $('#bookGuests')?.addEventListener('change', updateBookTotal);

  $('#bookForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!bookRoom) return;
    const inD = new Date($('#bookIn')?.value);
    const outD = new Date($('#bookOut')?.value);
    if (isNaN(inD) || isNaN(outD) || outD <= inD) {
      const m = $('#bookMsg'); if (m) m.textContent = '退房日期必须晚于入住日期';
      return;
    }
    const nights = Math.round((outD - inD) / 86400000);
    const name = $('#bookName')?.value.trim();
    const contact = $('#bookContact')?.value.trim();
    if (!name || !contact) { const m = $('#bookMsg'); if (m) m.textContent = '请填写姓名和联系方式'; return; }
    const note = $('#bookNote')?.value.trim();
    const wantBreakfast = $('#bookBreakfast')?.checked;
    const persons = parseInt($('#bookGuests')?.value, 10) || 1;
    const submitBtn = $('#bookForm').querySelector('button[type="submit"]');
    const origText = submitBtn.textContent;
    submitBtn.textContent = '提交中...';
    submitBtn.disabled = true;
    const msg = $('#bookMsg'); if (msg) msg.textContent = '';
    try {
      await POST('/api/bookings', {
        room_id: bookRoom.id,
        room_name: bookRoom.name,
        in_date: $('#bookIn').value,
        out_date: $('#bookOut').value,
        nights, persons,
        breakfast: wantBreakfast ? 1 : 0,
        name, contact, note
      });
      submitBtn.textContent = '✓ 已提交（跨设备同步，管理员会确认）';
      submitBtn.style.background = 'var(--c-emerald)';
      $('#bookForm').reset();
      setTimeout(() => closeBookModal(), 1500);
    } catch (err) {
      if (err.message && /登录|会话/.test(err.message)) {
        const m = $('#bookMsg'); if (m) m.textContent = '请先登录玩家账号';
        setTimeout(() => { closeBookModal(); openLoginModal('请先登录玩家账号再预订'); }, 1000);
      } else {
        const m = $('#bookMsg'); if (m) m.textContent = '提交失败: ' + err.message;
      }
    } finally {
      setTimeout(() => { submitBtn.textContent = origText; submitBtn.style.background = ''; submitBtn.disabled = false; }, 2200);
    }
  });
}

function renderHotelRooms() {
  const roomGrid = $('#homeRoomGrid');
  if (!roomGrid) return;
  if (!ROOMS.length) {
    roomGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">🏨</div><p>酒店正在筹建中, 上线后会在这里显示。</p></div>';
    return;
  }
  roomGrid.innerHTML = ROOMS.map(r => {
    const features = r.features.map(f => `<li>${f}</li>`).join('');
    const priceTag = r.price == null
      ? '<span class="room-price-cur">📋</span><span class="room-price-num">价格待定</span>'
      : `<span class="room-price-cur">💎</span><span class="room-price-num">${r.price}</span><span class="room-price-unit">绿宝石/晚</span>`;
    return `
      <article class="room-card ${r.featured ? 'featured' : ''}" data-room="${r.id}">
        ${r.featured ? '<div class="room-badge">★ 推荐</div>' : ''}
        <div class="room-thumb ${r.thumbClass}">
          <div class="room-thumb-tree"></div>
          <div class="room-thumb-tower"></div>
        </div>
        <div class="room-body">
          <h3 class="room-name"><span class="room-icon">${r.icon}</span>${r.name}</h3>
          <div class="room-bed">${r.bed} · 适合 ${r.guests}</div>
          <ul class="room-features">${features}</ul>
          <p class="room-desc">${r.desc}</p>
          <div class="room-price-row">
            <div class="room-price">${priceTag}</div>
            <div class="room-guests">👥 ${r.guests}</div>
          </div>
          <button class="btn btn-primary room-book-btn" data-room="${r.id}">📅 预订</button>
        </div>
      </article>`;
  }).join('');
  roomGrid.querySelectorAll('.room-book-btn').forEach(btn => {
    btn.addEventListener('click', () => openBookModal(btn.dataset.room));
  });
}

export async function loadHotelRooms() {
  const roomGrid = $('#homeRoomGrid');
  if (roomGrid) roomGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>正在加载房型...</p></div>';
  try {
    const bundle = await getBundle();
    const hotels = bundle.hotels || [];
    const all = [];
    for (const h of hotels) {
      const items = (bundle.rooms || []).filter(r => r.hotel_id === h.id);
      for (const r of items) {
        const cap = r.capacity || 1;
        all.push({
          id: r.id,
          name: r.name + (r.is_active ? '' : '（草拟）'),
          icon: cap >= 4 ? '🏨' : (cap >= 2 ? '🛌' : '🛏️'),
          price: r.price_per_night,
          bed: r.beds || '床型待公告',
          guests: (cap) + '+ 人',
          features: [r.breakfast_included ? '含早餐' : null, r.description || null].filter(Boolean),
          desc: r.description || '房型介绍待公告',
          thumbClass: cap >= 4 ? 't-luxury' : (cap >= 2 ? 't-queen' : 't-standard'),
          featured: r.sort_order >= 99
        });
      }
    }
    all.sort((a, b) => (a.price || 0) - (b.price || 0));
    if (all.length) all[all.length - 1].featured = true;
    ROOMS.length = 0;
    ROOMS.push(...all);
    renderHotelRooms();
  } catch (e) {
    if (roomGrid) roomGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>加载失败: ' + escHtml(e.message) + '</p></div>';
  }
}

// ============== 驾照考试 / 赛车规格 卡片渲染 ==============
export async function loadLicenseReqs() {
  const grid = $('#licenseGrid');
  if (!grid) return;
  try {
    const bundle = await getBundle();
    const reqs = (bundle.licenseReqs || []).filter(r => r.is_active);
    if (!reqs.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🚗</div><p>驾照考试暂未开放, 市政厅公告后启动。</p></div>';
      return;
    }
    const gradeLabels = { B: 'B 级（初级）', A: 'A 级（中级）', S: 'S 级（高级 / 职业）' };
    const gradeIcons = { B: '📝', A: '🏁', S: '🏆' };
    const examTypes = { B: 'written', A: 'road', S: 'upgrade' };
    const GRADE_CLASS = { S: 'license-grade-s' };
    grid.innerHTML = reqs.map(r => {
      const g = (r.exam_type || '').toUpperCase();
      return `
        <div class="license-card">
          <div class="license-grade ${GRADE_CLASS[g] || ''}">${escHtml(g)}</div>
          <h3>${escHtml(r.title || gradeLabels[g] || g + ' 级')}</h3>
          <p>${escHtml(r.description || '')}</p>
          <p style="font-size:12px;color:var(--c-stone-dark);margin-top:4px;">${escHtml(r.requirements || '').replace(/\n/g, ' · ')}</p>
          <p style="font-size:12px;color:var(--c-stone-dark);">⏱ ${r.duration_minutes || 30} 分钟 · 最低 ${r.min_age || 16} 岁</p>
          <button class="btn btn-primary btn-large" data-license="${examTypes[g] || 'written'}" data-grade="${escHtml(g)}">${gradeIcons[g] || '📝'} 报名 ${escHtml(g)} 级考试</button>
        </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>加载失败: ' + escHtml(e.message) + '</p></div>';
  }
}

export async function loadKartSpecs() {
  const specEls = document.querySelectorAll('#kartSpecs [data-spec]');
  const mapImg = $('#circuitMapImg');
  const priceEl = $('#circuitTrialPrice');
  if (!specEls.length && !mapImg && !priceEl) return;
  try {
    const bundle = await getBundle();
    const tracks = (bundle.tracks || []).filter(t => t.is_active);
    if (!tracks.length) {
      specEls.forEach(el => el.textContent = '暂无数据');
      if (priceEl) priceEl.textContent = '试车价格待公告';
      return;
    }
    const set = (key, val) => {
      const el = document.querySelector(`#kartSpecs [data-spec="${key}"]`);
      if (el) el.textContent = val;
    };
    const t = tracks[0];
    set('length', t.length_km ? t.length_km + ' km' : '—');
    set('lanes', '—');
    set('curves', '—');
    set('tunnel', '—');
    set('surface', t.name && t.name.includes('冰') ? '红石冰道' : (t.name || '—'));
    set('record', '—');
    if (mapImg && t.image_url) mapImg.src = t.image_url;
    if (priceEl) {
      if (t.trial_price && t.trial_price > 0) priceEl.textContent = `试车 ¥${t.trial_price} 💎/次`;
      else priceEl.textContent = '试车价格待公告';
    }
  } catch (e) {
    specEls.forEach(el => el.textContent = '加载失败');
    if (priceEl) priceEl.textContent = '试车价格加载失败';
  }
}

export function bindAll() {
  bindMessageSubmit();
  bindMessageAutoRefresh();
  bindKart();
  bindCircuit();
  bindLicense();
  bindHotel();
}
