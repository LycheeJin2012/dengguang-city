// v25.15: /api/admin-new — 读取完整 admin-new.html + 注入数据
// 用户用 https://dengguang-city.pages.dev/api/admin-new 访问
// 100% server-rendered, 数据在 <script>window.__manageData = {...}</script> 里
// admin.v2513.js 仍可读 window.__manageData 渲染 (无需 fetch)
export async function onRequestGet(context) {
  const { env, request } = context;
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

  // 读完整 admin-new.html (从同源 fetch 静态文件)
  // 用请求 URL 的 origin 拼路径
  const origin = new URL(request.url).origin;
  let html = '';
  try {
    const r = await fetch(origin + '/admin-new.html', { headers: { 'Cache-Control': 'no-cache' } });
    html = await r.text();
  } catch (e) {
    return new Response('读 admin-new.html 失败: ' + e.message, { status: 500, headers: { 'Content-Type': 'text/plain' } });
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
