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
      // 疑点(v88.7 未改): 下面这条查询取出的 oldest 没人用, retryAfter 直接回的是 windowSec,
      // 也就是「最早一条距今多久」算了但没算进去。删掉它会改变 SQL 序列(本轮只做可读性还原),
      // 真正要修 retry 语义请单独提工单。
      await env.DB.prepare(
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
  // 保留名: 灯灯客服是内置 AI bot, AI_BOT 是历史数据里的旧名, 玩家占了就没法登录
  if (trimmed === '灯灯客服' || trimmed.toUpperCase() === 'AI_BOT') return false;
  if (trimmed.length < 2 || trimmed.length > 32) return false;
  if (/@/.test(trimmed)) return false;
  if (/[\n\r\t\0]/.test(trimmed)) return false;
  return true;
}

// 需要转义的 4 个 HTML 敏感字符（顺序无关，都是单字符 replace）
const HTML_ENTITIES = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// 简单 sanitize：去掉 HTML 标签（只允许纯文本显示）
export function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<[^>]*>/g, '')          // 先去掉整段标签
    .replace(/[<>"']/g, (c) => HTML_ENTITIES[c])  // 再转义残留的裸字符
    .slice(0, 2000);
}
