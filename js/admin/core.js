// v44 重写: admin 共享核心 (utilities, API wrapper, helpers)
// 所有 tab 模块都从这里 import 共享函数
// 取代旧 admin.v2551.js 顶部的 $  / $$  / esc  / fmt  / api  / _fileToDataURL  等
// v50-N6 B6: re-export i18n t()
export { t } from '../i18n/core.js';

// ---------- DOM helpers ----------
export const $ = s => document.querySelector(s);
export const $$ = s => Array.from(document.querySelectorAll(s));

// ---------- HTML escape ----------
export const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---------- ISO 日期格式化 ----------
export const fmt = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

// ---------- 通用标签映射 (v50-N6: 走 i18n) ----------
//   之前 STATUS_LABEL 直接是中文, 英文面板硬编码显示中文
//   现在是 getter 拿 t(), 跟其他模块一致
function _statusLabel() {
  return { pending: t('admin.statusLabel.pending'), active: t('admin.statusLabel.active'), rejected: t('admin.statusLabel.rejected') };
}
function _examLabel() {
  return { written: t('admin.examLabel.written'), road: t('admin.examLabel.road'), upgrade: t('admin.examLabel.upgrade') };
}
function _examBadge() {
  return { pending: t('admin.examBadge.pending'), passed: t('admin.examBadge.passed'), failed: t('admin.examBadge.failed') };
}
// 兼容旧用法: STATUS_LABEL[key] 仍可用 (重定义为 Proxy 会更复杂, 干脆改成 named export)
export const STATUS_LABEL = new Proxy({}, { get: (_, k) => t('admin.statusLabel.' + k) });
export const EXAM_LABEL = new Proxy({}, { get: (_, k) => t('admin.examLabel.' + k) });
export const EXAM_BADGE = new Proxy({}, { get: (_, k) => t('admin.examBadge.' + k) });
// 同时 export 函数式, 避免 Proxy 在旧调用方误用
export { _statusLabel as getStatusLabel, _examLabel as getExamLabel, _examBadge as getExamBadge };

// ---------- API wrapper (fetch + JSON + cookie) ----------
// v47.3 修: 401 不 throw (跟 home/util.js#api 行为一致, 业务状态不是错误)
// 之前: 401 + {ok:false, error:'未登录'} → throw → admin boot catch 走错路径
// 现在: 401 整支短路, 让调用方判断 d.ok
export async function api(method, path, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) return d;
  if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
export const GET = (p, b) => api('GET', p, b);
export const POST = (p, b) => api('POST', p, b);
export const PATCH = (p, b) => api('PATCH', p, b);
export const DEL = (p, b) => api('DELETE', p, b);

// ---------- Safe render: 错误不静默吞 ----------
// 旧 v25.55 修过: 内部 throw e, 让错误冒泡到外层 safeRender 显式显示
export async function safeRender(fn) {
  try {
    await fn();
  } catch (e) {
    console.error('[safeRender]', e);
    const _ld = document.getElementById('bootLoading');
    if (_ld) _ld.remove();
    const el = document.getElementById('loginError');
    if (el) el.textContent = t('admin.common.loadFail', '加载失败: ') + e.message;
    const tab = document.querySelector('.tab-pane.active');
    if (tab) {
      tab.innerHTML = `<div class="empty-state" style="border-color:#c33;background:#fee">
        <div class="empty-icon">⚠️</div>
        <p style="color:#c33"><b>${esc(t('admin.common.renderFail', '渲染失败'))}</b></p>
        <p class="empty-sub">${esc(e.message || String(e))}</p>
      </div>`;
    }
  }
}

// ---------- 简单内存缓存 (替代旧的 _adminCache) ----------
const _cache = new Map();
const CACHE_TTL = 30_000;
export function cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return e.data;
}
export function cacheSet(key, data) { _cache.set(key, { ts: Date.now(), data }); }
export function cacheClear(prefix) {
  if (prefix) for (const k of _cache.keys()) if (k.startsWith(prefix)) _cache.delete(k);
  else _cache.clear();
}

// ---------- 通行密钥 WebAuthn helpers ----------
export function b64urlToBuf(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
export function bufToB64url(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- 文件上传 helpers ----------
export function fileToDataURLP(input) {
  return new Promise(resolve => {
    const f = input.files && input.files[0];
    if (!f) return resolve(null);
    if (f.size > 100 * 1024 * 1024) {
      if (window._toast) window._toast(t('admin.common.fileTooBig', '文件太大 (上限 100MB)'), 'error');
      input.value = '';
      return resolve(null);
    }
    const r = new FileReader();
    r.onload = ev => resolve(ev.target.result);
    r.readAsDataURL(f);
  });
}
