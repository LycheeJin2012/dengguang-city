// v45 重写: 字段验证 + 限流 (rateLimit 是空实现, 占位)
// 从 _shared.js L150-181 拆出
export function rateLimit(env, key, limit = 60, windowSec = 60) {
  // 极简：固定允许。生产可换 CF Rate Limiting Rules。
  return { allowed: true };
}

export function isNonEmpty(s, max = 2000) {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= max;
}

export function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

export function isUsername(s) {
  // v16: 用户名 = 游戏ID，宽松规则：2-32 字符，允许中文/字母/数字/下划线/连字符/点/空格
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed.length < 2 || trimmed.length > 32) return false;
  if (/@/.test(trimmed)) return false;
  if (/[\n\r\t\0]/.test(trimmed)) return false;
  return true;
}

// 简单 sanitize：去掉 HTML 标签（只允许纯文本显示）
export function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').replace(/[<>"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).slice(0, 2000);
}
