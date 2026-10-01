// v45 重写: HTTP 响应 helper (json/ok/err)
// 从 _shared.js L1-21 拆出

/**
 * 统一 JSON 响应。
 *
 * 下面两个展开的顺序都是行为的一部分，不能随手调换：
 *
 *   1. headers 里 { ...(init.headers || {}) } 放在**最后** —— 调用方必须能覆盖
 *      默认头（比如把 Cache-Control 换成 public, max-age=60）。挪到前面就成默认值了。
 *   2. Response 选项里 { ...init, headers } 把 headers 放最后 —— 于是上面算好的
 *      头会盖掉 init.headers 的原样，而 init.status 等字段照常传给 Response。
 *
 * init.headers 显式给 null / undefined 时靠 || 退化成空对象，不会炸。
 */
export function json(data, init = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(init.headers || {}),
  };
  return new Response(JSON.stringify(data), { ...init, headers });
}

/**
 * 业务失败响应 —— 本项目对外的统一失败形状是 { ok: false, error }。
 *
 * extra 展开在 error **之后**，所以 extra 里带一个 error 字段会把它顶掉。
 * 这是既有行为、不是笔误；改动前先确认没有调用方在依赖它。
 */
export function err(status, message, extra = {}) {
  return json({ ok: false, error: message, ...extra }, { status });
}

/**
 * 业务成功响应。
 *
 * 展开顺序同样是有方向的：{ ok: true, ...data } 里 data 在**后**，
 * 所以 data 自带 ok 字段时会顶掉这个壳里的 ok:true（对象字面量后写的键赢，
 * 重复键在 JSON.stringify 时被折叠成最后一个）。想反过来就得写 { ...data, ok: true }，
 * 那是另一种行为。
 */
export function ok(data = {}, init = {}) {
  return json({ ok: true, ...data }, init);
}
