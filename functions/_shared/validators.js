// v50: 字段验证 + 限流 + HTML 转义
const RATE_BUCKET = new Map();

export function rateLimit(key, max = 30, windowSec = 60) {
  const now = Date.now();
  const arr = RATE_BUCKET.get(key) || [];
  const fresh = arr.filter(t => now - t < windowSec * 1000);
  if (fresh.length >= max) return false;
  fresh.push(now);
  RATE_BUCKET.set(key, fresh);
  return true;
}

export function isNonEmpty(s, maxLen = 2000) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return t.length > 0 && t.length <= maxLen;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(s) {
  return typeof s === 'string' && EMAIL_RE.test(s.trim());
}

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5-]{2,20}$/;
export function isUsername(s) {
  return typeof s === 'string' && USERNAME_RE.test(s.trim());
}

export function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<\/?[^>]+>/g, '').trim();
}
