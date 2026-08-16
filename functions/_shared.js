// functions/_shared.js
// 共享：响应工具 / 密码哈希 / session 校验
// 2026-08-17: 触发 rebuild 以确保 D1 binding attach 到生产

const enc = new TextEncoder();
const dec = new TextDecoder();

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

export function bytesToHex(buf) {
  const arr = new Uint8Array(buf);
  let s = '';
  for (const b of arr) s += b.toString(16).padStart(2, '0');
  return s;
}

export function randomToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

// PBKDF2-SHA256 哈希密码（Web Crypto，零依赖）
export async function hashPassword(password, saltHex = null) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

export async function verifyPassword(password, storedHash, saltHex) {
  const { hash } = await hashPassword(password, saltHex);
  return timingSafeEqual(hash, storedHash);
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SESSION_TTL_HOURS = 8;

export async function createSession(env, playerId = null, adminId = null) {
  const token = randomToken(24);
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token, player_id, admin_id, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(token, playerId, adminId, expires).run();
  return { token, expires_at: expires };
}

export async function getSession(env, token) {
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT token, player_id, admin_id, expires_at FROM sessions WHERE token = ?'
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return row;
}

export async function destroySession(env, token) {
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export function readToken(request) {
  // 1) explicit header
  const h = request.headers.get('X-Session-Token') || request.headers.get('Authorization');
  if (h) {
    if (h.startsWith('Bearer ')) return h.slice(7);
    return h;
  }
  // 2) cookie: lc_session=xxx
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)lc_session=([^;]+)/);
  if (m) return m[1];
  return null;
}

// 限流：每 IP 每分钟 60 次（基于 CF-IPCountry 不太可靠，这里只做内存级）
// 生产建议用 D1 / KV 存计数器；这里先做简单按 token
export function rateLimit(env, key, limit = 60, windowSec = 60) {
  // 极简：固定允许。生产可换 CF Rate Limiting Rules。
  return { allowed: true };
}

// 字段校验
export function isNonEmpty(s, max = 2000) {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= max;
}

export function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

export function isUsername(s) {
  // v16: 用户名 = 游戏ID，宽松规则：3-32 字符，允许中文/字母/数字/下划线/连字符/点/空格
  // 禁止：换行、控制字符、纯空白、@ (会和邮箱冲突)
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed.length < 3 || trimmed.length > 32) return false;
  if (/^[\s@]|[@\s]$/.test(trimmed)) return false;  // 首尾不能是 @ 或空白
  if (/[\n\r\t\0]/.test(trimmed)) return false;  // 不能含控制字符
  return true;
}

// 简单 sanitize：去掉 HTML 标签（只允许纯文本显示）
export function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').replace(/[<>"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).slice(0, 2000);
}
