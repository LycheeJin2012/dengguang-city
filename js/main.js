/* ============================================
   灯光市人民政府 · 交互脚本
   ============================================ */
(function () {
  'use strict';

  /* ---------- 1. 移动端菜单 ---------- */
  const navToggle = document.getElementById('navToggle');
  const navLinks  = document.getElementById('navLinks');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
    // 点击链接后收起
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => navLinks.classList.remove('open'));
    });
  }

  /* ---------- 2. 平滑滚动 + active 态 ---------- */
  const navAs = document.querySelectorAll('.nav-links a[href^="#"]');
  const sectionMap = {};
  document.querySelectorAll('section[id]').forEach(s => { sectionMap[s.id] = s; });

  navAs.forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const target = sectionMap[id];
      if (target) {
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  function updateActiveNav() {
    const y = window.scrollY + 120;
    let current = '';
    for (const id in sectionMap) {
      const s = sectionMap[id];
      if (s.offsetTop <= y) current = id;
    }
    navAs.forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  }

  /* ---------- 3. 回到顶部 ---------- */
  const backTop = document.getElementById('backTop');
  function updateBackTop() {
    if (!backTop) return;
    backTop.classList.toggle('show', window.scrollY > 600);
  }
  if (backTop) {
    backTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- 4. 滚动事件合并 ---------- */
  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      updateActiveNav();
      updateBackTop();
      scrollTicking = false;
    });
  }, { passive: true });
  updateActiveNav();
  updateBackTop();

  /* ---------- 5. 数字滚动动画 ---------- */
  function animateNumber(el) {
    if (el.classList.contains('data-num-double')) return; // 双行静态显示，不做滚动
    const dataT = parseInt(el.dataset.target, 10);
    const textT = parseInt((el.textContent || '').replace(/[^\d]/g, ''), 10);
    const target = dataT || textT || 0;
    if (target <= 0) return;
    const original = el.textContent;
    const duration = 1400;
    const start = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) * (1 - p);
      const value = Math.floor(eased * target);
      el.textContent = value.toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = original; // 保留 HTML 原始（含 +/万/格 后缀）
    }
    requestAnimationFrame(tick);
  }

  const numObs = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        animateNumber(en.target);
        numObs.unobserve(en.target);
      }
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('.data-num').forEach(n => numObs.observe(n));

  /* ---------- 6. 卡片入场动画 ---------- */
  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.style.opacity = '1';
        en.target.style.transform = 'translateY(0)';
        revealObs.unobserve(en.target);
      }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('.notice-card, .scene-card, .service-card, .data-card, .flow-steps li').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    revealObs.observe(el);
  });

  /* ---------- 7. 留言提交：POST 到 /api/messages（需要玩家登录） ---------- */
  window.submitMessage = async function (form) {
    const inputs = form.querySelectorAll('input, select, textarea');
    const name    = (inputs[0].value || '').trim();
    const contact = (inputs[1].value || '').trim();
    const type    = inputs[2].value;
    const content = (inputs[3].value || '').trim();
    const btn     = form.querySelector('button[type="submit"]');
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',  // 关键：带上 session cookie
        body: JSON.stringify({ name, contact, type, content })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        btn.textContent = '✓ 已提交';
        btn.style.background = 'var(--c-emerald)';
        form.reset();
        loadPublicMessages();
      } else if (res.status === 401 || /登录/.test(data.error || '')) {
        btn.textContent = '请先登录玩家账号';
        btn.style.background = 'var(--c-redstone)';
        // 2 秒后弹登录 modal
        setTimeout(() => openLoginModal('请先登录玩家账号再发留言'), 1500);
      } else {
        btn.textContent = '✗ ' + (data.error || '提交失败');
        btn.style.background = 'var(--c-redstone)';
      }
    } catch (err) {
      btn.textContent = '提交失败 ✗';
      btn.style.background = 'var(--c-redstone)';
      console.error('留言提交失败:', err);
    }
    setTimeout(() => {
      btn.textContent = origTxt;
      btn.style.background = '';
      btn.disabled = false;
    }, 2200);
  };

  /* ---------- 7.5 公开留言墙：从 /api/messages 读取（公开 GET） ---------- */
  async function loadPublicMessages() {
    const board = document.getElementById('publicMessageBoard');
    if (!board) return;
    let msgs = [];
    try {
      const res = await fetch('/api/messages?public=1', { credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.ok) msgs = data.messages || [];
    } catch (e) { /* 网络错误忽略 */ }
    msgs = msgs.slice(0, 6);
    if (msgs.length === 0) {
      board.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>暂无市民留言 · 来做第一个吧</p></div>';
      return;
    }
    board.innerHTML = msgs.map(m => {
      const hasReply = m.admin_reply && m.admin_reply.length > 0;
      const isAi = hasReply && m.admin_reply.startsWith('🤖');
      return `
      <article class="pm-item" data-mid="${m.id}">
        <div class="pm-head">
          <a href="#" class="pm-author-link" data-username="${escapeHtml(m.name)}" onclick="return false"><b>${escapeHtml(m.name)}</b></a>
          <span class="pm-type pm-type-${escapeHtml(m.type || '建议')}">${escapeHtml(m.type || '建议')}</span>
          ${hasReply ? `<span class="msg-replied-tag" style="${isAi?'background:#1a3a1a;color:#9f9;border-color:#6f6':''}">${isAi?'🤖 AI 已回复':'💬 已回复'}</span>` : ''}
        </div>
        <p class="pm-content">${escapeHtml(m.content)}</p>
        ${hasReply ? `<div class="pm-reply-box"><b>📣 市政厅回复：</b>${escapeHtml(m.admin_reply)}</div>` : ''}
        <div class="pm-time">${formatTime(m.created_at)}</div>
        <div class="pm-actions">
          <button class="pm-toggle-comments btn btn-ghost btn-sm" data-mid="${m.id}">💬 评论 <span class="pm-comment-count" data-mid="${m.id}">·</span></button>
        </div>
        <div class="pm-comments" data-mid="${m.id}" style="display:none"></div>
      </article>
    `;}).join('');

    // 评论展开按钮
    board.querySelectorAll('.pm-toggle-comments').forEach(btn => {
      btn.addEventListener('click', () => toggleComments(parseInt(btn.dataset.mid, 10), btn));
    });
    // 并行预加载评论数
    msgs.forEach(m => loadCommentCount(m.id));
  }

  async function loadCommentCount(mid) {
    try {
      const res = await fetch(`/api/comments?message_id=${mid}`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.ok) {
        const el = document.querySelector(`.pm-comment-count[data-mid="${mid}"]`);
        if (el) el.textContent = data.comments.length > 0 ? `(${data.comments.length})` : '';
      }
    } catch (e) {}
  }

  async function toggleComments(mid, btn) {
    const box = document.querySelector(`.pm-comments[data-mid="${mid}"]`);
    if (!box) return;
    if (box.style.display !== 'none') {
      box.style.display = 'none';
      btn.firstChild && (btn.firstChild.textContent = '💬 评论 ');
      return;
    }
    box.style.display = '';
    btn.firstChild && (btn.firstChild.textContent = '▲ 收起评论 ');
    await renderComments(mid, box);
  }

  async function renderComments(mid, box) {
    box.innerHTML = '<div class="pm-comment-empty">加载中...</div>';
    let comments = [];
    try {
      const res = await fetch(`/api/comments?message_id=${mid}`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.ok) comments = data.comments || [];
    } catch (e) {}
    const me = await getCurrentPlayer();
    const myId = me ? me.id : null;
    box.innerHTML = `
      <div class="pm-comment-list">
        ${comments.length === 0 ? '<div class="pm-comment-empty">还没有评论 · 来做第一个</div>' : comments.map(c => `
          <div class="pm-comment">
            <span class="pm-comment-author">${escapeHtml(c.avatar_emoji || '👤')} ${escapeHtml(c.username || '?')}</span>
            <span class="pm-comment-time">${formatTime(c.created_at)}</span>
            <div class="pm-comment-text">${escapeHtml(c.content)}</div>
            ${(myId === c.player_id || (me && me.role && me.role !== 'player')) ? `<button class="pm-comment-del" data-cid="${c.id}">删除</button>` : ''}
          </div>
        `).join('')}
      </div>
      ${me ? `
        <form class="pm-comment-form" data-mid="${mid}">
          <textarea placeholder="说点什么..." rows="2" required maxlength="1000"></textarea>
          <button type="submit" class="btn btn-primary btn-sm">💬 发表评论</button>
        </form>
      ` : `<div class="pm-comment-empty"><a href="#" class="pm-login-link">登录</a> 后可以评论</div>`}
    `;
    box.querySelectorAll('.pm-comment-form').forEach(f => {
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ta = f.querySelector('textarea');
        const text = ta.value.trim();
        if (!text) return;
        try {
          const res = await fetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ message_id: parseInt(f.dataset.mid, 10), content: text })
          });
          const data = await res.json();
          if (res.ok && data.ok) {
            ta.value = '';
            await renderComments(mid, box);
            await loadCommentCount(mid);
          } else if (res.status === 401) {
            openLoginModal('请先登录玩家账号再评论');
          } else {
            alert('评论失败：' + (data.error || '网络错误'));
          }
        } catch (e) { alert('网络错误'); }
      });
    });
    box.querySelectorAll('.pm-comment-del').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('删除这条评论？')) return;
        try {
          await fetch('/api/comments?id=' + b.dataset.cid, { method: 'DELETE', credentials: 'include' });
          await renderComments(mid, box);
          await loadCommentCount(mid);
        } catch (e) { alert('删除失败'); }
      });
    });
  }
  let _meCache = null;
  async function getCurrentPlayer() {
    if (_meCache !== null) return _meCache;
    try {
      const res = await fetch('/api/login', { credentials: 'include' });
      const data = await res.json();
      _meCache = (res.ok && data.ok) ? data.user : null;
    } catch (e) { _meCache = null; }
    return _meCache;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  // 首次加载
  if (document.getElementById('publicMessageBoard')) {
    loadPublicMessages();
    // 每 30 秒刷新一次（伪实时）
    setInterval(loadPublicMessages, 30000);
  }

  /* ---------- 8. 公告卡点击“阅读全文” 模拟 ---------- */
  document.querySelectorAll('.read-more').forEach(a => {
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = a.closest('.notice-card');
      const h3 = card?.querySelector('h3')?.textContent || '公告详情';
      alert('【' + h3 + '】\n\n（演示页）完整公告将在接入后台后展示。');
    });
  });
  document.querySelectorAll('.notice-card').forEach(c => {
    c.addEventListener('click', () => c.querySelector('.read-more')?.click());
  });

  /* ---------- 9. 视差云朵加速（仅装饰） ---------- */
  const clouds = document.querySelectorAll('.cloud');
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    clouds.forEach((c, i) => {
      c.style.transform = `translateY(${y * (0.05 + i * 0.02)}px) scale(var(--s,1))`;
    });
  }, { passive: true });

  /* ---------- 10. 实景图集 + Lightbox ---------- */
  const GALLERY = [
    { num: '01', cat: 'city', label: '市中心发言台', file: 'assets/gallery/01-pyramid.jpg' },
    { num: '02', cat: 'city', label: '树屋酒店', file: 'assets/gallery/02-overview-day.jpg' },
    { num: '03', cat: 'nature', label: '图书馆&公园结合体', file: 'assets/gallery/03-cherry-cabin.jpg' },
    { num: '04', cat: 'nature', label: '樱花特色城区', file: 'assets/gallery/04-cherry-house.jpg' },
    { num: '05', cat: 'city', label: '人民英雄纪念碑', file: 'assets/gallery/05-monument.jpg' },
    { num: '06', cat: 'city', label: '城市俯瞰', file: 'assets/gallery/06-overview-aerial.jpg' },
    { num: '07', cat: 'road', label: '公路&铁路跨溪立交', file: 'assets/gallery/07-railway.jpg' },
    { num: '09', cat: 'road', label: '灯光火车站', file: 'assets/gallery/09-station-interior.jpg' },
    { num: '11', cat: 'kart', label: '灯光国际赛车场', file: 'assets/gallery/11-kart-start.jpg' },
    { num: '12', cat: 'kart', label: '国际赛车场·俯视', file: 'assets/gallery/12-kart-overview.jpg' },
    { num: '13', cat: 'kart', label: '国际赛车场·弯道区', file: 'assets/gallery/13-kart-turn.jpg' },
    { num: '14', cat: 'kart', label: '国际赛车场·直道', file: 'assets/gallery/14-kart-straight.jpg' },
    { num: '15', cat: 'kart', label: '国际赛车场·隧道', file: 'assets/gallery/15-kart-tunnel.jpg' },
    { num: '16', cat: 'kart', label: '国际赛车场·双车道', file: 'assets/gallery/16-kart-dual-lane.jpg' },
    { num: '17', cat: 'kart', label: '国际赛车场·发夹弯', file: 'assets/gallery/17-kart-hairpin.jpg' },
    { num: '18', cat: 'kart', label: '国际赛车场·全景', file: 'assets/gallery/18-kart-aerial.jpg' },
    { num: '19', cat: 'city', label: '假山', file: 'assets/gallery/19-kart-mushroom.jpg' },
    { num: '20', cat: 'city', label: '树屋酒店', file: 'assets/gallery/20-treehouse-real.jpg' },
    { num: '21', cat: 'city', label: '图书馆&附魔中心', file: 'assets/gallery/21-circuit-car.jpg' },
    { num: '22', cat: 'city', label: '优秀样板房', file: 'assets/gallery/22-circuit-build.jpg' },
  ];

  const GAL_FILTERS = [
    { id: 'all',    label: '全部', count: GALLERY.length },
    { id: 'city',   label: '城市', count: GALLERY.filter(g => g.cat === 'city').length },
    { id: 'road',   label: '路网', count: GALLERY.filter(g => g.cat === 'road').length },
    { id: 'kart',   label: '赛道', count: GALLERY.filter(g => g.cat === 'kart').length },
    { id: 'nature', label: '自然', count: GALLERY.filter(g => g.cat === 'nature').length }
  ];
  let galFilter = 'all';


  const grid = document.getElementById('galleryGrid');
  const filterBar = document.getElementById('galleryFilterBar');
  function renderGallery() {
    if (!grid) return;
    const visible = GALLERY.map((g, gi) => ({ g, gi })).filter(({ g }) => galFilter === 'all' || g.cat === galFilter);
    grid.innerHTML = visible.map(({ g, gi }) => `
      <article class="gallery-item" data-num="${g.num}" data-gi="${gi}" tabindex="0" role="button" aria-label="放大 ${g.label}">
        <img class="gallery-thumb" src="${g.file}" alt="${g.label}" loading="lazy" />
        <div class="gallery-meta">
          <span class="gallery-label">${g.label}</span>
          <span class="gallery-num">#${g.num}</span>
        </div>
      </article>
    `).join('');

    grid.querySelectorAll('.gallery-item').forEach(el => {
      const gi = +el.dataset.gi;
      el.addEventListener('click', () => openLb(gi));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLb(gi); }
      });
    });
  }
  if (filterBar) {
    filterBar.innerHTML = GAL_FILTERS.map(f => `
      <button type="button" class="gal-filter${galFilter === f.id ? ' active' : ''}" data-filter="${f.id}">
        <span class="gal-filter-label">${f.label}</span>
        <span class="gal-filter-count">${f.count}</span>
      </button>
    `).join('');
    filterBar.querySelectorAll('.gal-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        galFilter = btn.dataset.filter;
        filterBar.querySelectorAll('.gal-filter').forEach(b => b.classList.toggle('active', b === btn));
        renderGallery();
      });
    });
  }
  renderGallery();

  // Lightbox
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lbImg');
  const lbCap = document.getElementById('lbCap');
  let lbIdx = 0;

  function openLb(i) {
    if (!lb) return;
    lbIdx = i;
    const g = GALLERY[i];
    lbImg.src = g.file;
    lbImg.alt = g.label;
    lbCap.textContent = `${g.num} / ${String(GALLERY.length).padStart(2,'0')}  ·  ${g.label}`;
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeLb() {
    if (!lb) return;
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function navLb(delta) {
    lbIdx = (lbIdx + delta + GALLERY.length) % GALLERY.length;
    openLb(lbIdx);
  }

  const lbClose = document.getElementById('lbClose');
  const lbPrev  = document.getElementById('lbPrev');
  const lbNext  = document.getElementById('lbNext');
  if (lbClose) lbClose.addEventListener('click', closeLb);
  if (lbPrev)  lbPrev.addEventListener('click', () => navLb(-1));
  if (lbNext)  lbNext.addEventListener('click', () => navLb(1));
  if (lb) {
    lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
  }
  document.addEventListener('keydown', (e) => {
    if (!lb || !lb.classList.contains('open')) return;
    if (e.key === 'Escape')     closeLb();
    if (e.key === 'ArrowLeft')  navLb(-1);
    if (e.key === 'ArrowRight') navLb(1);
  });

  /* ---------- 11. 国际赛车场 banner + 试跑报名 ---------- */
  const KART_BANNER = [    { num: '13', cat: 'kart', label: '国际赛车场·弯道区', file: 'assets/gallery/13-kart-turn.jpg' },
    { num: '15', cat: 'kart', label: '国际赛车场·隧道', file: 'assets/gallery/15-kart-tunnel.jpg' },
    { num: '16', cat: 'kart', label: '国际赛车场·双车道', file: 'assets/gallery/16-kart-dual-lane.jpg' },
    { num: '17', cat: 'kart', label: '国际赛车场·发夹弯', file: 'assets/gallery/17-kart-hairpin.jpg' },
  ];

  const kartGrid = document.getElementById('kartBannerGrid');
  if (kartGrid) {
    kartGrid.innerHTML = KART_BANNER.map(k => `
      <div class="kb-item" data-num="${k.num}" tabindex="0" role="button" aria-label="放大 ${k.label}">
        <img class="kb-img" src="${k.file}" alt="${k.label}" loading="lazy" />
        <div class="kb-cap">${k.label}</div>
      </div>
    `).join('');

    // 点击放大到 lightbox
    kartGrid.querySelectorAll('.kb-item').forEach(el => {
      const num = el.dataset.num;
      const galleryIdx = GALLERY.findIndex(g => g.num === num);
      el.addEventListener('click', () => { if (galleryIdx >= 0) openLb(galleryIdx); });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (galleryIdx >= 0) openLb(galleryIdx); }
      });
    });
  }

  // 试跑报名 modal
  const kartMask   = document.getElementById('kartMask');
  const kartForm   = document.getElementById('kartForm');
  const kartClose  = document.getElementById('kartClose');
  const kartCancel = document.getElementById('kartCancel');
  const kartName   = document.getElementById('kartName');
  const kartContact= document.getElementById('kartContact');
  const kartSession= document.getElementById('kartSession');
  const kartCar    = document.getElementById('kartCar');
  const kartNote   = document.getElementById('kartNote');
  const kartMsg    = document.getElementById('kartMsg');
  const btnKartSignup = document.getElementById('btnKartSignup');

  function openKartModal() {
    if (!kartMask) return;
    kartMsg.textContent = '';
    kartMask.style.display = '';
    document.body.style.overflow = 'hidden';
    setTimeout(() => kartName.focus(), 50);
  }
  function closeKartModal() {
    kartMask.style.display = 'none';
    document.body.style.overflow = '';
    kartForm.reset();
  }
  if (btnKartSignup) btnKartSignup.addEventListener('click', openKartModal);
  if (kartClose)     kartClose.addEventListener('click', closeKartModal);
  if (kartCancel)    kartCancel.addEventListener('click', closeKartModal);
  if (kartMask)      kartMask.addEventListener('click', (e) => { if (e.target === kartMask) closeKartModal(); });
  document.addEventListener('keydown', (e) => {
    if (kartMask && kartMask.style.display === '' && e.key === 'Escape') closeKartModal();
  });

  kartForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = kartName.value.trim();
    const contact = kartContact.value.trim();
    if (!name || !contact) { kartMsg.textContent = '请填写游戏 ID 和联系方式'; return; }
    const session = kartSession.value;
    const car = kartCar.value.trim();
    const note = kartNote.value.trim();
    const submitBtn = kartForm.querySelector('button[type="submit"]');
    const origText = submitBtn.textContent;
    submitBtn.textContent = '提交中...';
    submitBtn.disabled = true;
    kartMsg.textContent = '';

    try {
      const res = await fetch('/api/kart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, contact, session, car, note })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        submitBtn.textContent = '✓ 报名已提交（跨设备同步）';
        submitBtn.style.background = 'var(--c-emerald)';
        kartForm.reset();
        setTimeout(() => closeKartModal(), 1500);
      } else if (res.status === 401) {
        kartMsg.textContent = '请先登录玩家账号';
        setTimeout(() => { closeKartModal(); openLoginModal('请先登录玩家账号再报名'); }, 1000);
      } else {
        kartMsg.textContent = '✗ ' + (data.error || '提交失败');
      }
    } catch (err) {
      kartMsg.textContent = '提交失败：' + err.message;
    } finally {
      setTimeout(() => {
        submitBtn.textContent = origText;
        submitBtn.style.background = '';
        submitBtn.disabled = false;
      }, 2200);
    }
  });

  /* ---------- 12. 国际赛车场·试车报名 ---------- */
  const circuitMask   = document.getElementById('circuitMask');
  const circuitForm   = document.getElementById('circuitForm');
  const circuitClose  = document.getElementById('circuitClose');
  const circuitCancel = document.getElementById('circuitCancel');
  const circuitName   = document.getElementById('circuitName');
  const circuitContact= document.getElementById('circuitContact');
  const circuitLicense= document.getElementById('circuitLicense');
  const circuitSession= document.getElementById('circuitSession');
  const circuitCar    = document.getElementById('circuitCar');
  const circuitNote   = document.getElementById('circuitNote');
  const circuitMsg    = document.getElementById('circuitMsg');
  const btnCircuitSignup = document.getElementById('btnCircuitSignup');

  function openCircuitModal() {
    if (!circuitMask) return;
    circuitMsg.textContent = '';
    circuitMask.style.display = '';
    document.body.style.overflow = 'hidden';
    setTimeout(() => circuitName && circuitName.focus(), 50);
  }
  function closeCircuitModal() {
    circuitMask.style.display = 'none';
    document.body.style.overflow = '';
    circuitForm.reset();
  }
  if (btnCircuitSignup) btnCircuitSignup.addEventListener('click', openCircuitModal);
  if (circuitClose)     circuitClose.addEventListener('click', closeCircuitModal);
  if (circuitCancel)    circuitCancel.addEventListener('click', closeCircuitModal);
  if (circuitMask)      circuitMask.addEventListener('click', (e) => { if (e.target === circuitMask) closeCircuitModal(); });
  document.addEventListener('keydown', (e) => {
    if (circuitMask && circuitMask.style.display === '' && e.key === 'Escape') closeCircuitModal();
  });

  if (circuitForm) {
    circuitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = circuitName.value.trim();
      const contact = circuitContact.value.trim();
      if (!name || !contact) { circuitMsg.textContent = '请填写游戏 ID 和联系方式'; return; }
      const submitBtn = circuitForm.querySelector('button[type="submit"]');
      const origText = submitBtn.textContent;
      submitBtn.textContent = '提交中...';
      submitBtn.disabled = true;
      circuitMsg.textContent = '';

      try {
        const res = await fetch('/api/circuit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name, contact,
            license: circuitLicense.value,
            session: circuitSession.value,
            car: circuitCar.value.trim(),
            note: circuitNote.value.trim()
          })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          submitBtn.textContent = '✓ 报名已提交（跨设备同步）';
          submitBtn.style.background = 'var(--c-emerald)';
          circuitForm.reset();
          setTimeout(() => closeCircuitModal(), 1500);
        } else if (res.status === 401) {
          circuitMsg.textContent = '请先登录玩家账号';
          setTimeout(() => { closeCircuitModal(); openLoginModal('请先登录玩家账号再报名'); }, 1000);
        } else {
          circuitMsg.textContent = '✗ ' + (data.error || '提交失败');
        }
      } catch (err) {
        circuitMsg.textContent = '提交失败：' + err.message;
      } finally {
        setTimeout(() => {
          submitBtn.textContent = origText;
          submitBtn.style.background = '';
          submitBtn.disabled = false;
        }, 2200);
      }
    });
  }

  /* ---------- 13.5 驾照考试报名（v16.2） ---------- */
  const licenseMask  = document.getElementById('licenseMask');
  const licenseClose = document.getElementById('licenseClose');
  const licenseCancel= document.getElementById('licenseCancel');
  const licenseForm  = document.getElementById('licenseForm');
  const licenseMsg   = document.getElementById('licenseMsg');
  const licenseTitle = document.getElementById('licenseTitle');
  const licenseGradeLabel = document.getElementById('licenseGradeLabel');
  const licenseTypeLabel  = document.getElementById('licenseTypeLabel');
  const licenseContact    = document.getElementById('licenseContact');
  const licenseDate       = document.getElementById('licenseDate');
  const licenseSession    = document.getElementById('licenseSession');
  const licenseNote       = document.getElementById('licenseNote');
  let _licenseType = 'written';

  function openLicenseModal(type, grade) {
    _licenseType = type;
    licenseTitle.textContent = `${grade} 级驾照报名`;
    licenseGradeLabel.textContent = `${grade} 级`;
    licenseTypeLabel.textContent = ({
      written: '笔试 - 选择题 + 简答',
      road:    '路考 - 实景驾驶',
      upgrade: '升级赛 - 极限测试'
    })[type] || '';
    licenseContact.value = '';
    licenseNote.value = '';
    licenseMsg.textContent = '';
    licenseMask.style.display = '';
    document.body.style.overflow = 'hidden';
  }
  function closeLicenseModal() {
    if (!licenseMask) return;
    licenseMask.style.display = 'none';
    document.body.style.overflow = '';
  }
  if (licenseClose)  licenseClose.addEventListener('click', closeLicenseModal);
  if (licenseCancel) licenseCancel.addEventListener('click', closeLicenseModal);
  if (licenseMask)  licenseMask.addEventListener('click', (e) => { if (e.target === licenseMask) closeLicenseModal(); });
  document.querySelectorAll('[data-license]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type  = btn.dataset.license;
      const grade = btn.dataset.grade || '?';
      // 检查登录
      fetch('/api/login', { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          if (d.ok && d.role === 'player') {
            // 自动填联系方式（如果有 email）
            if (d.user.email) licenseContact.value = d.user.email;
            openLicenseModal(type, grade);
          } else {
            openLoginModal('请先登录玩家账号再报名考试');
          }
        })
        .catch(() => openLoginModal('网络错误，请稍后再试'));
    });
  });
  if (licenseForm) {
    licenseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = licenseForm.querySelector('button[type="submit"]');
      const origTxt = submitBtn.textContent;
      licenseMsg.textContent = '';
      submitBtn.textContent = '提交中...';
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/license', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            exam_type:    _licenseType,
            exam_date:    licenseDate.value,
            exam_session: licenseSession.value,
            contact:      licenseContact.value.trim(),
            note:         licenseNote.value.trim()
          })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          licenseMsg.textContent = '✓ ' + (data.message || '报名成功');
          licenseMsg.style.color = 'var(--c-emerald)';
          setTimeout(() => {
            closeLicenseModal();
            licenseMsg.style.color = '';
            licenseForm.reset();
          }, 1500);
        } else if (res.status === 401) {
          closeLicenseModal();
          openLoginModal(data.error || '请先登录玩家账号');
        } else {
          licenseMsg.textContent = '✗ ' + (data.error || '提交失败');
          licenseMsg.style.color = 'var(--c-redstone)';
        }
      } catch (err) {
        licenseMsg.textContent = '网络错误：' + err.message;
      } finally {
        submitBtn.textContent = origTxt;
        submitBtn.disabled = false;
      }
    });
  }

  /* ---------- 13. 树上酒店 + 预订（草拟房型，待市政厅最终定价） ---------- */
  const ROOMS = [
    {
      id: 'standard',
      name: '树上标间（草拟）',
      icon: '🛏️',
      price: null,
      bed: '床型待公告',
      guests: '入住人数待公告',
      features: ['家具配置待公告', '窗外景观待公告'],
      desc: '房型草案。床型、家具、配置由市政厅与合作社讨论后定稿。',
      thumbClass: 't-standard'
    },
    {
      id: 'queen',
      name: '树上大床房（草拟）',
      icon: '🛌',
      price: null,
      bed: '床型待公告',
      guests: '入住人数待公告',
      features: ['家具配置待公告', '景观待公告'],
      desc: '房型草案。床型、家具、配置由市政厅与合作社讨论后定稿。',
      thumbClass: 't-queen'
    },
    {
      id: 'luxury',
      name: '树上豪华房（草拟）',
      icon: '🏨',
      price: null,
      bed: '床型待公告',
      guests: '入住人数待公告',
      features: ['家具配置待公告', '景观待公告'],
      desc: '房型草案。床型、家具、配置由市政厅与合作社讨论后定稿。',
      thumbClass: 't-luxury',
      featured: true
    }
  ];

  // 渲染房型卡
  const roomGrid = document.getElementById('roomGrid');
  if (roomGrid) {
    roomGrid.innerHTML = ROOMS.map(r => {
      const features = r.features.map(f => `<li>${f}</li>`).join('');
      const priceTag = r.price == null
        ? '<span class="room-price-cur">📋</span><span class="room-price-num">价格待公告</span>'
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
            <button class="btn btn-primary room-book-btn" data-room="${r.id}">▶ 意向登记</button>
          </div>
        </article>
      `;
    }).join('');

    roomGrid.querySelectorAll('.room-book-btn').forEach(btn => {
      btn.addEventListener('click', () => openBookModal(btn.dataset.room));
    });
  }

  // 预订 Modal
  const bookMask      = document.getElementById('bookMask');
  const bookForm      = document.getElementById('bookForm');
  const bookTitle     = document.getElementById('bookTitle');
  const bookClose     = document.getElementById('bookClose');
  const bookCancel    = document.getElementById('bookCancel');
  const bookIn        = document.getElementById('bookIn');
  const bookOut       = document.getElementById('bookOut');
  const bookNights    = document.getElementById('bookNights');
  const bookName      = document.getElementById('bookName');
  const bookContact   = document.getElementById('bookContact');
  const bookGuests    = document.getElementById('bookGuests');
  const bookBreakfast = document.getElementById('bookBreakfast');
  const bookNote      = document.getElementById('bookNote');
  const bookMsg       = document.getElementById('bookMsg');
  const bookSummary   = document.getElementById('bookSummary');
  const bookTotal     = document.getElementById('bookTotal');
  // 早餐价格由市政厅与合作社共同议定,本处只记录意向(待公告)
  const BFAST_PER_NIGHT_PER_PERSON = null;
  let bookRoom = null;

  function openBookModal(roomId) {
    const r = ROOMS.find(x => x.id === roomId);
    if (!r) return;
    bookRoom = r;
    bookTitle.textContent = `预订 · ${r.name}`;
    bookSummary.innerHTML = `
      <div>
        <b>${r.icon} ${r.name}</b><br/>
        <span style="font-size:12px;color:var(--c-stone-dark)">${r.bed} · ${r.guests}</span>
      </div>
      <div class="summary-price">💎 ${r.price} / 晚</div>
    `;
    // 默认日期：今天 + 明天
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);
    bookIn.value  = tomorrow.toISOString().slice(0, 10);
    bookOut.value = dayAfter.toISOString().slice(0, 10);
    bookMsg.textContent = '';
    updateBookTotal();
    bookMask.style.display = '';
    document.body.style.overflow = 'hidden';
    setTimeout(() => bookName.focus(), 50);
  }
  function closeBookModal() {
    bookMask.style.display = 'none';
    document.body.style.overflow = '';
    bookForm.reset();
    bookRoom = null;
  }
  function updateBookTotal() {
    if (!bookRoom) return;
    const inD = new Date(bookIn.value);
    const outD = new Date(bookOut.value);
    if (isNaN(inD) || isNaN(outD) || outD <= inD) {
      bookNights.textContent = '— 请选择有效日期';
      bookTotal.textContent = '—';
      return;
    }
    const nights = Math.round((outD - inD) / 86400000);
    const persons = parseInt(bookGuests.value, 10) || 1;
    const wantBf = bookBreakfast && bookBreakfast.checked;
    const price = bookRoom.price;
    const bfCost = (wantBf && BFAST_PER_NIGHT_PER_PERSON != null)
      ? nights * persons * BFAST_PER_NIGHT_PER_PERSON : null;
    bookNights.textContent = `${nights} 晚 · ${persons} 人${wantBf ? ' · 含早餐' : ''}`;
    if (price == null) {
      bookTotal.textContent = '房费与早餐价格待市政厅公告';
    } else {
      const total = nights * price + (bfCost || 0);
      let totalText = `💎 ${total} 绿宝石（房费 ${nights} 晚 × ${price}`;
      if (bfCost) totalText += ` + 早餐 ${nights} 晚 × ${persons} 人 × ${BFAST_PER_NIGHT_PER_PERSON}`;
      totalText += '）';
      bookTotal.textContent = totalText;
    }
  }
  bookIn.addEventListener('change', updateBookTotal);
  bookOut.addEventListener('change', updateBookTotal);
  if (bookBreakfast) bookBreakfast.addEventListener('change', updateBookTotal);
  if (bookGuests) bookGuests.addEventListener('change', updateBookTotal);
  bookClose.addEventListener('click', closeBookModal);
  bookCancel.addEventListener('click', closeBookModal);
  bookMask.addEventListener('click', (e) => { if (e.target === bookMask) closeBookModal(); });
  document.addEventListener('keydown', (e) => {
    if (bookMask.style.display === '' && e.key === 'Escape') closeBookModal();
  });

  // 提交预订
  bookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!bookRoom) return;
    const inD = new Date(bookIn.value);
    const outD = new Date(bookOut.value);
    if (isNaN(inD) || isNaN(outD) || outD <= inD) {
      bookMsg.textContent = '退房日期必须晚于入住日期';
      return;
    }
    const nights = Math.round((outD - inD) / 86400000);
    const total = nights * bookRoom.price;
    const name = bookName.value.trim();
    const contact = bookContact.value.trim();
    if (!name || !contact) {
      bookMsg.textContent = '请填写姓名和联系方式';
      return;
    }
    const note = bookNote.value.trim();
    const wantBreakfast = bookBreakfast && bookBreakfast.checked;
    const persons = parseInt(bookGuests.value, 10) || 1;
    const submitBtn = bookForm.querySelector('button[type="submit"]');
    const origText = submitBtn.textContent;
    submitBtn.textContent = '提交中...';
    submitBtn.disabled = true;
    bookMsg.textContent = '';

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room_id: bookRoom.id,
          room_name: bookRoom.name,
          in_date: bookIn.value,
          out_date: bookOut.value,
          nights,
          persons,
          breakfast: wantBreakfast ? 1 : 0,
          name, contact, note
        })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        submitBtn.textContent = '✓ 已提交（跨设备同步，管理员会确认）';
        submitBtn.style.background = 'var(--c-emerald)';
        bookForm.reset();
        setTimeout(() => closeBookModal(), 1500);
      } else if (res.status === 401) {
        bookMsg.textContent = '请先登录玩家账号';
        setTimeout(() => { closeBookModal(); openLoginModal('请先登录玩家账号再预订'); }, 1000);
      } else {
        bookMsg.textContent = '✗ ' + (data.error || '提交失败');
      }
    } catch (err) {
      bookMsg.textContent = '提交失败：' + err.message;
    } finally {
      setTimeout(() => {
        submitBtn.textContent = origText;
        submitBtn.style.background = '';
        submitBtn.disabled = false;
      }, 2200);
    }
  });
  /* ---------- 14. 玩家登录 / 注册 modal（顶栏触发） ---------- */
  const loginMask = document.getElementById('loginMask');
  const loginClose = document.getElementById('loginClose');
  const loginForm = document.getElementById('loginForm');
  const loginMsg = document.getElementById('loginMsg');
  const loginModeLogin = document.getElementById('loginModeLogin');
  const loginModeRegister = document.getElementById('loginModeRegister');
  const loginTitle = document.getElementById('loginTitle');
  const loginUsername = document.getElementById('loginUsername');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginSubmit = document.getElementById('loginSubmit');
  const emailRow = document.getElementById('loginEmailRow');
  const toggleMode = document.getElementById('loginToggleMode');

  let loginMode = 'login'; // 'login' | 'register'
  function setLoginMode(m) {
    loginMode = m;
    if (m === 'login') {
      loginTitle.textContent = '玩家登录';
      emailRow.style.display = 'none';
      loginSubmit.textContent = '登录';
      loginModeLogin.style.display = 'none';
      loginModeRegister.style.display = '';
    } else {
      loginTitle.textContent = '注册玩家账号';
      emailRow.style.display = '';
      loginSubmit.textContent = '注册并登录';
      loginModeLogin.style.display = '';
      loginModeRegister.style.display = 'none';
    }
    loginMsg.textContent = '';
  }
  window.openLoginModal = function (reason, mode) {
    if (!loginMask) return;
    if (reason) loginMsg.textContent = reason;
    setLoginMode(mode === 'register' ? 'register' : 'login');
    loginMask.style.display = '';
    document.body.style.overflow = 'hidden';
    setTimeout(() => loginUsername && loginUsername.focus(), 50);
  };
  function closeLoginModal() {
    if (!loginMask) return;
    loginMask.style.display = 'none';
    document.body.style.overflow = '';
  }
  if (loginClose)  loginClose.addEventListener('click', closeLoginModal);
  if (loginMask)   loginMask.addEventListener('click', (e) => { if (e.target === loginMask) closeLoginModal(); });
  if (loginModeLogin)    loginModeLogin.addEventListener('click', (e) => { e.preventDefault(); setLoginMode('login'); });
  if (loginModeRegister) loginModeRegister.addEventListener('click', (e) => { e.preventDefault(); setLoginMode('register'); });

  /* ---------- 14.1 服务卡：市民身份登记 → 打开注册 modal ---------- */
  const srvRegister = document.getElementById('srvRegister');
  if (srvRegister) {
    srvRegister.addEventListener('click', (e) => {
      e.preventDefault();
      openLoginModal('新市民注册 · 填写用户名+邮箱+密码即可', 'register');
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = loginUsername.value.trim();
      const password = loginPassword.value;
      if (!username || !password) {
        loginMsg.textContent = '请填写用户名和密码';
        return;
      }
      loginSubmit.disabled = true;
      loginSubmit.textContent = loginMode === 'login' ? '登录中...' : '注册中...';
      loginMsg.textContent = '';
      try {
        let res, data;
        if (loginMode === 'login') {
          res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
          });
        } else {
          const email = loginEmail.value.trim();
          if (!email) { loginMsg.textContent = '请填写邮箱'; loginSubmit.disabled = false; loginSubmit.textContent = '注册并登录'; return; }
          res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, email, password })
          });
        }
        data = await res.json();
        if (res.ok && data.ok) {
          // 注意：admin 账号不能在这里登录（应该去 admin.html）
          if (data.role && data.role !== 'player') {
            loginMsg.textContent = '这是管理员账号，请去 /admin.html 登录';
            loginSubmit.disabled = false;
            loginSubmit.textContent = loginMode === 'login' ? '登录' : '注册并登录';
            return;
          }
          // v16: 注册成功 = 待审批，message 字段说明
          if (data.user && data.user.status === 'pending') {
            loginMsg.textContent = '✓ ' + (data.message || '注册申请已提交，等审批');
            loginMsg.style.color = 'var(--c-gold, #d6a300)';
            setTimeout(() => {
              closeLoginModal();
              loginMsg.style.color = '';
              loginForm.reset();
            }, 1800);
            return;
          }
          // 正常登录成功
          loginMsg.textContent = '✓ 成功！';
          loginMsg.style.color = 'var(--c-emerald)';
          setTimeout(async () => {
            closeLoginModal();
            loginMsg.style.color = '';
            await refreshUserState();
            loadPublicMessages();
          }, 600);
        } else {
          loginMsg.textContent = '✗ ' + (data.error || '失败');
        }
      } catch (err) {
        loginMsg.textContent = '网络错误：' + err.message;
      } finally {
        loginSubmit.disabled = false;
        loginSubmit.textContent = loginMode === 'login' ? '登录' : '注册并登录';
      }
    });
  }

  /* ---------- 15. 顶栏玩家状态（谁在登录） ---------- */
  const navUserSlot = document.getElementById('navUserSlot');
  function prefillContactForm(player) {
    if (!player) return;
    const nameEl = document.getElementById('contactName');
    if (nameEl && !nameEl.value) {
      nameEl.value = player.username;
      nameEl.readOnly = true;
      nameEl.style.background = 'var(--c-bg-2, #f0e8d0)';
      nameEl.title = '已用你的游戏ID自动填写（市政厅要求：留言姓名 = 注册用户名）';
    }
  }
  async function refreshUserState() {
    if (!navUserSlot) return;
    try {
      const res = await fetch('/api/login', { credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.ok && data.role === 'player') {
        navUserSlot.innerHTML = `
          <span class="nav-user-name">${escapeHtml(data.user.avatar_emoji || '👤')} ${escapeHtml(data.user.username)}</span>
          <a href="profile.html" class="nav-logout-link" style="color:var(--c-emerald);">👤 主页</a>
          <a href="dm.html" class="nav-logout-link" style="color:var(--c-emerald);">📨 私信</a>
          <a href="#" id="navLogout" class="nav-logout-link">登出</a>
        `;
        // v16: 自动填留言 form 的姓名
        prefillContactForm(data.user);
        const lo = document.getElementById('navLogout');
        if (lo) lo.addEventListener('click', async (e) => {
          e.preventDefault();
          await fetch('/api/login', { method: 'DELETE', credentials: 'include' });
          await refreshUserState();
          loadPublicMessages();
        });
      } else {
        navUserSlot.innerHTML = `<a href="#" id="navLogin" class="nav-login-link">玩家登录</a>`;
        const ll = document.getElementById('navLogin');
        if (ll) ll.addEventListener('click', (e) => { e.preventDefault(); openLoginModal(); });
      }
    } catch (e) {
      navUserSlot.innerHTML = '';
    }
  }
  if (navUserSlot) refreshUserState();
})();
