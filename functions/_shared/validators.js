// v45 重写: 字段验证 + 限流 (rateLimit 是空实现, 占位)
// 从 _shared.js L150-181 拆出
// v49-fix-7: rateLimit 真实现 — 用 messages 表 + player_id 限流 (无需新表)
// key 格式: 'msg:player:<id>' (IP 限流等 messages 表加 ip 列再实现)
// 窗口内超过 limit 条返 { allowed: false, retryAfter } (秒)
export async function rateLimit(env, key, limit = 5, windowSec = 60) {
  if (!env || !env.DB) return { allowed: true }; // 无 DB 时不阻拦
  const [scope, type, val] = String(key || '').split(':');
  if (scope !== 'msg' || !type || !val) return { allowed: true };
  if (type === 'player') {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE player_id = ? AND created_at > datetime('now', ?)"
    ).bind(val, `-${windowSec} seconds`).first();
    const n = row?.n || 0;
    if (n >= limit) {
      // 计算最早一条距今多久 (retry 提示)
      const oldest = await env.DB.prepare(
        "SELECT created_at FROM messages WHERE player_id = ? ORDER BY created_at ASC LIMIT 1"
      ).bind(val).first();
      return { allowed: false, retryAfter: windowSec, count: n, limit };
    }
    return { allowed: true, count: n, limit };
  }
  // 其他 type (ip) 暂未实现, 放行
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
