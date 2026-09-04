// v50: HTTP 响应 helper (json/ok/err/cors)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export function json(data, init = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...(init.headers || {}) };
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function ok(data = {}, init = {}) {
  return json({ ok: true, ...data }, init);
}

export function err(status, message, extra = {}) {
  return json({ ok: false, error: message, ...extra }, { status });
}

// CORS preflight
export function handleOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
