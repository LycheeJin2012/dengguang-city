// v25.16: /api/admin-new — 用 env.ASSETS 读完整 admin-new.html + 注入数据
// 用户用 https://dengguang-city.pages.dev/api/admin-new 访问
export async function onRequestGet(context) {
  const { env } = context;
  // 拿数据
  let dataJson = '{"hotels":[],"rooms":[],"tracks":[],"licenseReq":[]}';
  try {
    const hotels = (await env.DB.prepare('SELECT * FROM hotels ORDER BY sort_order, id').all()).results || [];
    const rooms = (await env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY hotel_id, sort_order, id').all()).results || [];
    const tracks = (await env.DB.prepare('SELECT * FROM race_tracks ORDER BY sort_order, id').all()).results || [];
    const licenseReq = (await env.DB.prepare('SELECT * FROM license_requirements ORDER BY sort_order, id').all()).results || [];
    dataJson = JSON.stringify({ hotels, rooms, tracks, licenseReq });
  } catch (e) {
    dataJson = JSON.stringify({ error: String(e.message) });
  }

  // 用 env.ASSETS 读 admin-new.html (CF Pages Functions 标准读静态文件方式)
  let html = '';
  try {
    if (env.ASSETS) {
      html = await env.ASSETS.fetch('https://assets.local/admin-new.html').then(r => r.text());
    } else {
      // fallback: 不用 fetch, 直接构造完整 HTML (用模板字符串)
      html = _inlineAdminNewHtml();
    }
  } catch (e) {
    // fallback
    html = _inlineAdminNewHtml();
  }

  // 在 head 里最前面注入数据
  const inject = `<script>window.__manageData = ${dataJson};</script>`;
  html = html.replace(/<head>/i, '<head>\n  ' + inject);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

// 简化版完整 admin-new HTML (在 env.ASSETS 拿不到时用)
function _inlineAdminNewHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>管理后台 | 灯光市人民政府</title>
  <link rel="stylesheet" href="/css/style.css" />
  <link rel="stylesheet" href="/css/admin.css" />
</head>
<body class="admin-body">
  <div id="view-dash">
    <p>完整 HTML 模板没加载到, 请直接看 <a href="/api/admin/manage-data?keys=hotels,rooms,tracks,licenseReq">原始数据</a></p>
  </div>
  <script src="/js/admin.v2513.js?v=v2516"></script>
</body>
</html>`;
}
