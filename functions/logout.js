/**
 * /logout —— 固定返回 404。
 *
 * 登出在前端是纯客户端动作（清掉 cookie 再跳转），服务端没有对应的吊销端点。
 * 这个文件让 /logout 落到一个我们自己控制的 404，而不是平台的默认错误页。
 *
 * ⚠️ 按原样保留：状态码与文案都被路由用例钉住。不确定当初为什么需要它，
 *    改动前先确认没有客户端在等这个响应。
 */
export async function onRequest() {
  return new Response('Not Found', { status: 404 });
}
