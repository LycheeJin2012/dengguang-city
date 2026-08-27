// /admin → 跳到当前 admin HTML (v41: 改为 redirect 而非返回硬编码 HTML)
// 之前这里是一坨 2 年前的硬编码 admin HTML (v17 时代), 完全过期。
// 现在统一走 _redirects / admin-v37.html 路径, 跟其他 admin 版本一致。
export async function onRequest(context) {
  return new Response(null, {
    status: 302,
    headers: { Location: '/admin-v37.html?v=20260828-apple-motion' },
  });
}
