/**
 * /admin —— 302 跳到后台单页。
 *
 * 这里不做鉴权：真正的权限判断发生在 admin-v37.html 拉数据时，
 * 由各个 /api/admin/* 端点各自把关。
 *
 * Cache-Control: no-store 是必须的 —— 否则浏览器会把这次跳转缓存住，
 * 后台改版之后用户会一直停在旧入口。
 */
export const onRequest = () =>
  new Response(null, {
    status: 302,
    headers: { Location: '/admin-v37.html', 'Cache-Control': 'no-store' }
  });
