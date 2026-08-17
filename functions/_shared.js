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
  // v16: 用户名 = 游戏ID，宽松规则：2-32 字符，允许中文/字母/数字/下划线/连字符/点/空格
  // 禁止：换行、控制字符、@ (会和邮箱冲突)
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed.length < 2 || trimmed.length > 32) return false;
  if (/@/.test(trimmed)) return false;  // 不能含 @ (会跟邮箱冲突)
  if (/[\n\r\t\0]/.test(trimmed)) return false;  // 不能含控制字符
  return true;
}

// 简单 sanitize：去掉 HTML 标签（只允许纯文本显示）
export function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').replace(/[<>"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).slice(0, 2000);
}

// AI 自动回复助手（OpenAI 兼容 chat completions）
// 调用失败一律返回 null（不抛、不阻塞主流程）
// 系统 prompt 区分 context: 'message' | 'dm'
export async function aiAutoReply(env, userMessage, context = 'message') {
  if (!env || !env.OPENAI_API_KEY) return null;
  const text = String(userMessage || '').trim().slice(0, 100);
  if (!text) return null;
  // 默认 MiniMax（MiniMax）的 OpenAI 兼容端点
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.minimax.chat/v1').replace(/\/+$/, '');
  const model = env.OPENAI_MODEL || 'abab6.5s-chat';

  const sys = context === 'dm'
    ? `你是「灯光市 AI 客服」灯灯。灯光市是一座 Minecraft 服务器上的像素城市。

服务市民，解答问题、指引流程、收建议。
要求：
1. 亲切、简洁、像邻家小助手
2. **总字数必须控制在 100 字以内**（含标点）
3. 严禁编造任何具体信息：数字、电话、邮箱、人名、活动名、日期等
4. 不确定的事请说"请联系市政厅人工客服"
5. 不要前缀（"灯灯："等），直接正文
6. 纯文本，不要 markdown 格式`
    : `你是「灯光市」市政厅 AI 助手。灯光市是一座 Minecraft 服务器上的像素城市。

任务是给市民留言写一封**市政厅回复**。
要求：
1. 亲切、正式、礼貌
2. 先承认回应，再给下一步
3. **总字数必须控制在 100 字以内**（含标点）
4. 严禁编造任何具体信息：数字、电话、邮箱、人名、活动名、日期等
5. 不确定的事引导走 DM 私信或加备注
6. 不要前缀（"市政厅："等），直接正文
7. 纯文本，不要 markdown 格式`;

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: text },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => ({}));
    let draft = (data?.choices?.[0]?.message?.content || '').trim();
    if (!draft) return null;
    if (draft.length > 100) draft = draft.slice(0, 100);
    return draft;
  } catch (e) {
    return null;
  }
}

// 获取/创建 AI 客服 system 玩家（username = '灯灯客服'）
// 用 status='active' + 固定 username 确保唯一
export async function getOrCreateAiBot(env) {
  const fixedUsername = '灯灯客服';
  let row = await env.DB.prepare(
    "SELECT id, username, avatar_emoji FROM players WHERE username = ?"
  ).bind(fixedUsername).first();
  if (row) return row;

  // 创建：随机密码（无人能登录）
  const randomPwd = crypto.getRandomValues(new Uint8Array(24)).toString() + Date.now();
  const { hash, salt } = await hashPassword(randomPwd, null);
  try {
    await env.DB.prepare(
      "INSERT INTO players (username, email, password_hash, salt, game_id, status, bio, avatar_emoji) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
    ).bind(
      fixedUsername,
      'ai-bot@system.local',
      hash,
      salt,
      'AI_BOT',
      '我是 AI 客服灯灯，由市政厅训练。',
      '🤖'
    ).run();
  } catch (e) {
    // 并发/已存在：再 SELECT 一次
    row = await env.DB.prepare(
      "SELECT id, username, avatar_emoji FROM players WHERE username = ?"
    ).bind(fixedUsername).first();
    if (row) return row;
    throw e;
  }
  return await env.DB.prepare(
    "SELECT id, username, avatar_emoji FROM players WHERE username = ?"
  ).bind(fixedUsername).first();
}
