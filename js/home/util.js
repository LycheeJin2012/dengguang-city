// v45 重写: 公共页 (home) 共享工具
// 替换 main.js 顶部的 escapeHtml / formatTime / relativeTime 等散落的 helper

// HTML escape (双保险, 同时处理 5 个字符)
export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ISO 时间格式化 (YYYY-MM-DD HH:MM, 本地时区)
export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 相对时间 (3 分钟前 / 2 小时前 / 昨天)
export function relativeTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前';
  if (diff < 7 * 86400_000) return Math.floor(diff / 86400_000) + ' 天前';
  return fmtDate(iso).slice(0, 10);
}

// fetch + JSON + cookie
export async function api(method, path, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const d = await r.json().catch(() => ({}));
  // 401 是 "未登录" 业务状态, 不 throw, 让调用方处理 (d.error 也忽略)
  // 5xx + 4xx 其他 + d.error 仍 throw (真错误)
  if (r.status === 401) return d;
  if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
export const GET = (p, b) => api('GET', p, b);
export const POST = (p, b) => api('POST', p, b);
export const PATCH = (p, b) => api('PATCH', p, b);
export const DEL = (p, b) => api('DELETE', p, b);

// DOM helpers
export const $ = s => document.querySelector(s);
export const $$ = s => Array.from(document.querySelectorAll(s));

// 数字动画 (easeOutQuad)
export function animateNumber(el, target, dur = 800) {
  if (!el) return;
  const start = parseInt(el.textContent, 10) || 0;
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - (1 - p) * (1 - p);
    el.textContent = Math.floor(start + (target - start) * eased).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// 渲染时错误显式抛出 (不静默吞)
export function safeRender(fn, container) {
  return fn().catch(e => {
    console.error('[safeRender]', e);
    if (container) {
      container.innerHTML = `<div class="empty-state" style="border-color:#c33;background:#fee">
        <div class="empty-icon">⚠️</div>
        <p style="color:#c33"><b>渲染失败</b></p>
        <p class="empty-sub">${escHtml(e.message || String(e))}</p>
      </div>`;
    }
  });
}
