// v25.14: admin-new 的服务端渲染版 — 把数据直接嵌入 HTML
// GET /api/admin-new  (用户改用这个 URL)
// 读取静态 admin-new.html, 把 window.__manageData 注入到 head
export async function onRequestGet(context) {
  const { env } = context;
  let dataJson = '{}';
  try {
    const hotels = (await env.DB.prepare('SELECT * FROM hotels ORDER BY sort_order, id').all()).results || [];
    const rooms = (await env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY hotel_id, sort_order, id').all()).results || [];
    const tracks = (await env.DB.prepare('SELECT * FROM race_tracks ORDER BY sort_order, id').all()).results || [];
    const licenseReq = (await env.DB.prepare('SELECT * FROM license_requirements ORDER BY sort_order, id').all()).results || [];
    dataJson = JSON.stringify({ hotels, rooms, tracks, licenseReq });
  } catch (e) {
    dataJson = JSON.stringify({ error: String(e.message) });
  }

  // 直接返回完整 HTML, 把数据嵌进去 (绕过 admin-new.html 静态)
  // 内容跟 /admin-new.html 一样, 但 head 里有 <script>window.__manageData = {...}</script>
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>管理后台 | 灯光市人民政府</title>
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <meta http-equiv="Expires" content="0" />
  <script>/* v25.14: 数据直接嵌入 HTML (没有 fetch, 没有 script tag, 没有外部依赖) */
    window.__manageData = ${dataJson};
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/style.css" />
  <link rel="stylesheet" href="/css/admin.css" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%2370ad34'/%3E%3Crect x='3' y='3' width='3' height='3' fill='%23ffd23f'/%3E%3Crect x='10' y='3' width='3' height='3' fill='%23ffd23f'/%3E%3Crect x='3' y='10' width='3' height='3' fill='%23ffd23f'/%3E%3C/svg%3E" />
</head>
<body class="admin-body">
  <header class="admin-header">
    <a href="/index.html" class="admin-logo">
      <div class="logo-block"><div class="block-grass"></div><div class="block-dirt"></div></div>
      <div>
        <b>灯光市 · 管理后台</b>
        <span>LIGHT CITY · ADMIN CONSOLE</span>
      </div>
    </a>
    <div class="admin-header-right">
      <a href="/index.html" class="header-link">← 返回首页</a>
    </div>
  </header>
  <div class="admin-warn">
    <span>🏛️</span>
    <span><b>内部管理系统</b> · 本页仅供市政厅授权人员使用。所有数据(留言、订单、报名、管理员档案)均存于本机浏览器,跨设备不共享。首次访问请使用初始管理员凭据登录后立即修改密码。</span>
  </div>
  <main id="view-login" class="view-login" style="display:none">
    <div class="login-card">
      <h1>管理员登录</h1>
      <form id="loginForm">
        <label>账号 <input type="text" id="loginUser" required /></label>
        <label>密码 <input type="password" id="loginPass" required /></label>
        <button type="submit" class="btn btn-primary">▶ 登录</button>
      </form>
    </div>
  </main>
  <main id="view-dash" class="view-dash" style="display:none">
    <div class="user-bar">
      <div class="user-info">
        <span class="user-avatar">👤</span>
        <div><b id="userName">—</b> <span id="userRole" class="role-tag">—</span></div>
      </div>
      <div class="user-actions"><button class="btn btn-ghost btn-sm" id="btnLogout">退出登录</button></div>
    </div>
    <nav class="admin-tabs">
      <button class="tab active" data-tab="messages">📬 市民留言 <span class="tab-count" id="msgUnread">0</span></button>
      <button class="tab" data-tab="players">👥 玩家管理 <span class="tab-count" id="playerPending">0</span></button>
      <button class="tab" data-tab="bookings">🏨 酒店预订 <span class="tab-count" id="bookPending">0</span></button>
      <button class="tab" data-tab="license">🚗 驾照考试 <span class="tab-count" id="licensePending">0</span></button>
      <button class="tab" data-tab="kart">🏁 赛车场管理 <span class="tab-count" id="kartPending">0</span></button>
      <button class="tab" data-tab="circuit">🏎️ 国际赛车场 <span class="tab-count" id="circuitPending">0</span></button>
      <button class="tab" data-tab="announcements" id="tabAnnouncements">📢 公告管理</button>
      <button class="tab" data-tab="gallery" id="tabGallery">🖼️ 首页图集</button>
      <button class="tab" data-tab="dms" id="tabDms">💬 私信监管</button>
      <button class="tab" data-tab="admins" id="tabAdmins">🛡️ 管理员账号</button>
      <button class="tab" data-tab="password">🔑 修改我的密码</button>
    </nav>
    <section class="tab-pane active" id="pane-messages">
      <h2>市民留言</h2>
      <div id="msgList" class="msg-list"></div>
    </section>
    <section class="tab-pane" id="pane-players">
      <h2>玩家管理</h2>
      <div id="playerList" class="msg-list"></div>
    </section>
    <section class="tab-pane" id="pane-bookings">
      <h2>酒店预订</h2>
      <nav class="subtabs" data-pane="bookings">
        <button class="subtab active" data-sub="signup">📋 预订记录</button>
        <button class="subtab" data-sub="manage" data-super-only>🏨 酒店管理 (SUPER)</button>
      </nav>
      <div class="subview" data-subview="bookings-signup">
        <div id="bookList" class="msg-list"></div>
      </div>
      <div class="subview" data-subview="bookings-manage" style="display:none">
        <div id="hotelManageList" class="msg-list"></div>
        <div id="hotelManageEmpty" class="empty-state" style="display:none">
          <div class="empty-icon">🏨</div>
          <p>暂无酒店。点右上"新增酒店"创建,再为它添加房型。</p>
        </div>
        <div class="pane-tools" style="margin-top:8px;display:none" id="hotelManageAddBtn" data-super-only>
          <button class="btn btn-primary btn-sm" id="btnAddHotel">+ 新建酒店</button>
        </div>
      </div>
    </section>
    <section class="tab-pane" id="pane-license">
      <h2>驾照考试</h2>
      <nav class="subtabs" data-pane="license">
        <button class="subtab active" data-sub="signup">📋 报名记录</button>
        <button class="subtab" data-sub="manage" data-super-only>🎫 考试要求 (SUPER)</button>
      </nav>
      <div class="subview" data-subview="license-signup"></div>
      <div class="subview" data-subview="license-manage" style="display:none">
        <div id="licenseManageList" class="msg-list"></div>
        <div id="licenseManageEmpty" class="empty-state" style="display:none"></div>
        <div class="pane-tools" style="margin-top:8px;display:none" id="licenseManageAddBtn" data-super-only>
          <button class="btn btn-primary btn-sm" id="btnAddLicReq">+ 新增驾照要求</button>
        </div>
      </div>
    </section>
    <section class="tab-pane" id="pane-kart">
      <h2>赛车场管理</h2>
      <nav class="subtabs" data-pane="kart">
        <button class="subtab active" data-sub="signup">📋 赛道报名</button>
        <button class="subtab" data-sub="manage" data-super-only>🏁 赛车场管理 (SUPER)</button>
      </nav>
      <div class="subview" data-subview="kart-signup"></div>
      <div class="subview" data-subview="kart-manage" style="display:none">
        <div id="trackManageList" class="msg-list"></div>
        <div id="trackManageEmpty" class="empty-state" style="display:none"></div>
        <div class="pane-tools" style="margin-top:8px;display:none" id="trackManageAddBtn" data-super-only>
          <button class="btn btn-primary btn-sm" id="btnAddTrack">+ 新建赛车场</button>
        </div>
      </div>
    </section>
    <section class="tab-pane" id="pane-circuit"><h2>国际赛车场</h2></section>
    <section class="tab-pane" id="pane-announcements"><h2>📢 市政公告管理</h2><div id="annList"></div></section>
    <section class="tab-pane" id="pane-gallery"><h2>🖼️ 首页图集管理</h2></section>
    <section class="tab-pane" id="pane-password"><h2>修改我的密码</h2></section>
    <section class="tab-pane" id="pane-admins"><h2>管理员账号</h2></section>
    <section class="tab-pane" id="pane-dms"><h2>💬 私信监管</h2></section>
  </main>
  <div id="bootLoading" style="position:fixed;inset:0;background:#fff8e7;display:flex;align-items:center;justify-content:center;flex-direction:column;z-index:9999">
    <div style="font-size:48px">⏳</div>
    <div>正在验证身份…</div>
  </div>
  <script src="/js/admin.v2513.js?v=v2514"></script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
  });
}
