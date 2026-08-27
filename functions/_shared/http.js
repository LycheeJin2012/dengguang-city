// v45 重写: HTTP 响应 helper (json/ok/err)
// 从 _shared.js L1-21 拆出
export function json(data, init = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', ...(init.headers || {}) };
  return new Response(JSON.stringify(data), { ...init, headers });
}
export function err(status, message, extra = {}) {
  return json({ ok: false, error: message, ...extra }, { status });
}
export function ok(data = {}, init = {}) {
  return json({ ok: true, ...data }, init);
}
