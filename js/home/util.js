// v50: 通用 helpers
export const $ = (s, c) => (c || document).querySelector(s);
export const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmt(time) {
  if (!time) return '';
  const d = new Date(time);
  if (isNaN(d)) return String(time);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
export async function POST(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}
export async function PATCH(url, body) {
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}
export async function DELETE(url) {
  const r = await fetch(url, { method: 'DELETE', credentials: 'include' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export async function safeRender(fn) {
  const box = arguments[1] || null;
  try { await fn(); }
  catch (e) {
    console.warn('[safeRender] error:', e.message);
    if (window._toast) window._toast('加载失败: ' + e.message, 'error');
    if (box) box.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>加载失败: ${e.message}</p></div>`;
  }
}

export function cacheClear(prefix) {
  // v50 stub: 未来接 IndexedDB cache
}
