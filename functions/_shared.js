// functions/_shared.js
// 共享：响应工具 / 密码哈希 / session 校验 / WebAuthn (passkey) 工具
// 2026-08-17: 触发 rebuild 以确保 D1 binding attach 到生产
// 2026-08-17: 新增 passkey (WebAuthn ES256) 完整支持

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

// v17.9 修订: 合并管理员和玩家账号 (双向 linked_player_id / linked_admin_id)
// 合并后:
//   - 玩家侧登录(玩家密码或玩家通行密钥)自动获得 combined session (含 admin 身份)
//   - 退出管理无需验证(只销毁 admin 身份, 保留 player session)
//   - 通行密钥在任一边注册, 登录时即可在两边使用
//   - 两边密码不共享: 改 admin 密码不影响 player, 改 player 密码不影响 admin
export async function mergeAccount(env, adminId, playerId) {
  if (!adminId || !playerId) throw new Error('mergeAccount: adminId 和 playerId 必填');
  // 检查玩家存在且 active
  const _p = await env.DB.prepare("SELECT id, username, status FROM players WHERE id = ? AND status = 'active'").bind(playerId).first();
  if (!_p) throw new Error('玩家不存在或未激活');
  // 检查管理员存在
  const _a = await env.DB.prepare("SELECT id, username FROM admins WHERE id = ?").bind(adminId).first();
  if (!_a) throw new Error('管理员不存在');
  // 检查这个玩家和管理员是否已经绑了别的
  const _pOld = await env.DB.prepare('SELECT linked_admin_id FROM players WHERE id = ?').bind(playerId).first();
  if (_pOld?.linked_admin_id && _pOld.linked_admin_id !== adminId) {
    throw new Error(`玩家 ${_p.username} 已绑定其他管理员 (id=${_pOld.linked_admin_id}), 请先解绑`);
  }
  const _aOld = await env.DB.prepare('SELECT linked_player_id FROM admins WHERE id = ?').bind(adminId).first();
  if (_aOld?.linked_player_id && _aOld.linked_player_id !== playerId) {
    throw new Error(`管理员 ${_a.username} 已绑定其他玩家 (id=${_aOld.linked_player_id}), 请先解绑`);
  }
  // 双向写
  await env.DB.prepare('UPDATE admins SET linked_player_id = ? WHERE id = ?').bind(playerId, adminId).run();
  await env.DB.prepare('UPDATE players SET linked_admin_id = ? WHERE id = ?').bind(adminId, playerId).run();
  return { admin_id: adminId, player_id: playerId, admin_username: _a.username, player_username: _p.username };
}

export async function unmergeAccount(env, adminId, playerId) {
  if (!adminId || !playerId) throw new Error('unmergeAccount: adminId 和 playerId 必填');
  // 双向清 (仅当仍指向对方时才清,避免误清)
  await env.DB.prepare(
    'UPDATE admins SET linked_player_id = NULL WHERE id = ? AND linked_player_id = ?'
  ).bind(playerId, adminId).run();
  await env.DB.prepare(
    'UPDATE players SET linked_admin_id = NULL WHERE id = ? AND linked_admin_id = ?'
  ).bind(adminId, playerId).run();
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

// 离线兜底回复（key 未设时用，关键词匹配，绝不返回 null）
// 模板里不出现具体数字/人名/电话/活动，全部诚实留白
function offlineReply(userMessage, context) {
  const text = String(userMessage || '').toLowerCase();
  if (context === 'dm') {
    if (/你好|hi|hello|嗨|您好/.test(text)) return '你好呀！我是灯灯，AI 客服灯灯～有什么事尽管说。';
    if (/怎么|如何|怎样|哪里|在哪|几个|什么时候/.test(text)) return '这个问题建议你 DM 找市政厅管理员人工答复，我作为 AI 给不出具体流程。';
    if (/谢谢|感谢|thanks/.test(text)) return '不客气～有事随时来找我！';
    if (/投诉|不满|生气|垃圾/.test(text)) return '抱歉让你不满意了。我会把你的反馈转给市政厅管理员，请稍等。';
    if (/建议|想要|希望|能不能/.test(text)) return '已收到你的建议！我会转告市政厅管理员。';
    return '收到！我会尽快转告市政厅管理员跟进。';
  }
  // 留言板 context
  if (/投诉|不满|生气|垃圾|差评/.test(text)) return '抱歉让你不满意了。您的投诉已记录，市政厅会在近期内处理。';
  if (/故障|坏|报错|不行|不能|失效/.test(text)) return '已收到您的故障反馈，市政厅会尽快安排核实修复，请保持联系。';
  if (/申请|报名|想|希望|想要|能不能/.test(text)) return '已收到您的申请/请求，市政厅会在近期内审阅，请关注本留言或 DM 跟进。';
  if (/建议|想法|意见|提议/.test(text)) return '感谢您的宝贵建议！市政厅已记录，会在下次市政会议上讨论。';
  if (/你好|您好|hi|hello/.test(text)) return '欢迎来到灯光市！请详细描述您的诉求，市政厅会尽快处理。';
  if (/谢谢|感谢|thanks/.test(text)) return '不客气！服务市民是市政厅的本职工作。';
  return '感谢您的留言！市政厅已收到，会尽快处理。如需详细沟通，请用 DM 私信联系。';
}

// AI 自动回复助手（OpenAI 兼容 chat completions）
// 未配置 OPENAI_API_KEY 时走离线兜底（保证体验不中断）
// context: 'message' | 'dm'
export async function aiAutoReply(env, userMessage, context = 'message') {
  const text = String(userMessage || '').trim().slice(0, 100);
  if (!text) return null;

  // 没配 key → 走离线兜底
  if (!env || !env.OPENAI_API_KEY) {
    return offlineReply(text, context);
  }

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
    if (!resp.ok) return offlineReply(text, context);
    const data = await resp.json().catch(() => ({}));
    let draft = (data?.choices?.[0]?.message?.content || '').trim();
    if (!draft) return offlineReply(text, context);
    if (draft.length > 100) draft = draft.slice(0, 100);
    return draft;
  } catch (e) {
    return offlineReply(text, context);
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

// ============================================================
// WebAuthn (Passkey) 工具 - 2026-08-17
// 仅支持 ES256 (alg=-7), attestation=none
// ============================================================

// Base64URL <-> ArrayBuffer
export function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 最小 CBOR 解码器（支持 WebAuthn 需要的子集：uint / text / bytes / array / map）
function cborDecode(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  function readUint(v, info) {
    if (info < 24) return info;
    if (info === 24) { offset++; return v.getUint8(offset - 1); }
    if (info === 25) { const n = v.getUint16(offset); offset += 2; return n; }
    if (info === 26) { const n = v.getUint32(offset); offset += 4; return n; }
    if (info === 27) { const n = Number(v.getBigUint64(offset)); offset += 8; return n; }
    throw new Error('CBOR: 不支持的 uint 长度 ' + info);
  }
  function readItem() {
    const b = v.getUint8(offset++);
    const major = b >> 5;
    const info = b & 0x1f;
    if (major === 0) return readUint(v, info);
    if (major === 1) {
      // 负整数: -1 - n (n 用无符号整数表示, 实际值是 -1 - n)
      const n = readUint(v, info);
      return -1 - n;
    }
    if (major === 2) {
      const len = readUint(v, info);
      const out = new Uint8Array(data.buffer, data.byteOffset + offset, len);
      offset += len;
      return out;
    }
    if (major === 3) {
      const len = readUint(v, info);
      const out = new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset + offset, len));
      offset += len;
      return out;
    }
    if (major === 4) {
      const len = readUint(v, info);
      const arr = [];
      for (let i = 0; i < len; i++) arr.push(readItem());
      return arr;
    }
    if (major === 5) {
      const len = readUint(v, info);
      const obj = {};
      for (let i = 0; i < len; i++) {
        const k = readItem();
        const val = readItem();
        obj[k] = val;
      }
      return obj;
    }
    throw new Error('CBOR: 不支持的 major 类型 ' + major);
  }
  return readItem();
}

// COSE EC2 公钥 -> JWK
// 注意: cborDecode 对 major 5 (map) 返回 JS object, cborDecode 对 major 4 (array) 返回 array.
// 两种编码都见过, 所以用兼容写法: 优先当 object 读, 否则用固定索引当 array 读
function coseToJwk(cose) {
  if (!cose) throw new Error('COSE: 空');

  // 兼容 array / object 两种 CBOR 编码
  const isArr = Array.isArray(cose);
  const get = (label, arrIdx) => isArr ? cose[arrIdx] : cose[label];

  const kty = get(1, 1);
  if (kty !== 2) throw new Error('COSE: 非 EC2 密钥, kty=' + kty);

  const alg = get(3, 3);
  if (alg !== -7) throw new Error('COSE: 仅支持 ES256 (alg=-7), 实际 ' + alg);

  const crv = get(-1, 5);
  if (crv !== 1) throw new Error('COSE: 仅支持 P-256 (crv=1), 实际 ' + crv);

  let x = get(-2, 7);
  let y = get(-3, 9);
  if (!x || !y) throw new Error('COSE: 缺少 x 或 y');

  // v17.8 fix: 某些 authenticator 编码时省略前导 0 字节, x/y 可能只有 31 字节
  // P-256 严格要求 32 字节 (256 bits), 否则 importKey 报 "Invalid EC key"
  const pad32 = (b) => {
    if (b.length === 32) return b;
    if (b.length < 32) {
      const out = new Uint8Array(32);
      out.set(b, 32 - b.length);  // 前导 0 补齐
      return out;
    }
    if (b.length > 32) {
      // 截断前导 0
      let i = 0;
      while (i < b.length - 32 && b[i] === 0) i++;
      return b.slice(i, i + 32);
    }
    return b;
  };
  x = pad32(x);
  y = pad32(y);

  return { kty: 'EC', crv: 'P-256', alg: 'ES256', ext: false,
           x: bytesToB64url(x), y: bytesToB64url(y) };
}

// 解析 authenticatorData
function parseAuthData(authData) {
  if (authData.length < 37) throw new Error('authData 太短');
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const signCount = (authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36];
  let offset = 37;
  let attestedCredentialData = null;
  if (flags & 0x40) {  // AT
    const aaguid = authData.slice(offset, offset + 16);
    offset += 16;
    const credIdLen = (authData[offset] << 8) | authData[offset + 1];
    offset += 2;
    const credentialId = authData.slice(offset, offset + credIdLen);
    offset += credIdLen;
    const coseBytes = authData.slice(offset);
    const cosePubKey = cborDecode(coseBytes);
    attestedCredentialData = { aaguid, credentialId, cosePubKey };
  }
  return { rpIdHash, flags, signCount, attestedCredentialData };
}

// DER -> raw r||s (P-256 = 64 bytes)
function derToRawSig(der) {
  if (der[0] !== 0x30) throw new Error('DER: 缺少 SEQUENCE 头');
  let p = 2;
  if (der[p++] !== 0x02) throw new Error('DER: 缺少 INTEGER (r)');
  let rLen = der[p++];
  let r = der.slice(p, p + rLen); p += rLen;
  if (der[p++] !== 0x02) throw new Error('DER: 缺少 INTEGER (s)');
  let sLen = der[p++];
  let s = der.slice(p, p + sLen);
  if (r.length === 33 && r[0] === 0) r = r.slice(1);
  if (s.length === 33 && s[0] === 0) s = s.slice(1);
  if (r.length < 32) r = new Uint8Array([...new Array(32 - r.length).fill(0), ...r]);
  if (s.length < 32) s = new Uint8Array([...new Array(32 - s.length).fill(0), ...s]);
  const out = new Uint8Array(64);
  out.set(r.slice(-32), 0);
  out.set(s.slice(-32), 32);
  return out;
}

// 验签 ES256
async function verifyEs256(jwk, signature, authData, clientDataJSON) {
  const pubKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(new Uint8Array(clientDataHash), authData.length);
  const rawSig = derToRawSig(signature);
  return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, rawSig, signed);
}

function verifyClientData(clientDataBytes, expectedChallenge, expectedOrigin) {
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
  if (clientData.type !== expectedOrigin.type) throw new Error('clientData.type 不匹配');
  if (clientData.origin !== expectedOrigin.origin) throw new Error('clientData.origin 不匹配: ' + clientData.origin);
  if (clientData.challenge !== expectedChallenge) throw new Error('clientData.challenge 不匹配');
  return clientData;
}

async function expectedRpIdHash(rpId) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId));
  return new Uint8Array(buf);
}

// === 高层 API ===

// 注册开始 (v17.5: 支持 player 和 admin)
// subject = { kind: 'player'|'admin', id: number, username: string }
export async function passkeyRegisterStart(env, subject, rpId) {
  const { kind, id, username } = subject;
  if (!kind || !id || !username) throw new Error('subject 必填 (kind/id/username)');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const challengeB64 = bytesToB64url(challenge);
  const token = randomToken(24);
  const expires = new Date(Date.now() + 300_000).toISOString();
  // player_id 字段复用作 "kind:id" 复合 key, 方便挑战码查询
  const subjectKey = `${kind}:${id}`;
  await env.DB.prepare(
    "INSERT OR REPLACE INTO webauthn_challenges (token, challenge, purpose, player_id, expires_at) VALUES (?, ?, 'register', ?, ?)"
  ).bind(token, challengeB64, subjectKey, expires).run();
  return {
    challenge_token: token,
    publicKey: {
      challenge: challengeB64,
      rp: { id: rpId, name: '灯光市' },
      user: {
        id: bytesToB64url(new TextEncoder().encode(`${kind}:${id}`)),
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
      attestation: 'none',
      timeout: 60000,
    },
  };
}

// 注册完成
export async function passkeyRegisterFinish(env, body, subject, rpId, expectedOrigin) {
  const { challenge_token: challengeToken, credential, name } = body;
  if (!challengeToken || !credential) throw new Error('缺少 challenge_token 或 credential');
  const ch = await env.DB.prepare(
    "SELECT challenge, expires_at FROM webauthn_challenges WHERE token = ? AND purpose = 'register'"
  ).bind(challengeToken).first();
  if (!ch) throw new Error('challenge 无效');
  if (new Date(ch.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();
    throw new Error('challenge 已过期');
  }
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();

  const clientDataJSON = b64urlToBytes(credential.response.clientDataJSON);
  const attestationObject = b64urlToBytes(credential.response.attestationObject);
  verifyClientData(clientDataJSON, ch.challenge, expectedOrigin);

  const att = cborDecode(attestationObject);
  if (att.fmt !== 'none') throw new Error('仅支持 attestation=none，实际 ' + att.fmt);
  const parsed = parseAuthData(att.authData);
  if (!parsed.attestedCredentialData) throw new Error('attestedCredentialData 缺失');

  const expected = await expectedRpIdHash(rpId);
  if (bytesToB64url(parsed.rpIdHash) !== bytesToB64url(expected)) throw new Error('rpIdHash 不匹配');
  if (!(parsed.flags & 0x01)) throw new Error('用户在场标志缺失');
  if (!(parsed.flags & 0x40)) throw new Error('AT 标志缺失');

  const jwk = coseToJwk(parsed.attestedCredentialData.cosePubKey);
  const credId = parsed.attestedCredentialData.credentialId;
  const aaguid = parsed.attestedCredentialData.aaguid;
  const credIdB64 = bytesToB64url(credId);

  // v17.5: 按 subject.kind 写 player_id 或 admin_id (另一个字段为 NULL)
  if (subject.kind === 'admin') {
    await env.DB.prepare(
      "INSERT INTO passkeys (admin_id, player_id, credential_id, public_key_jwk, sign_count, transports, name, aaguid) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)"
    ).bind(
      subject.id,
      credIdB64,
      JSON.stringify(jwk),
      parsed.signCount,
      JSON.stringify(credential.response.transports || []),
      (name || 'My Passkey').slice(0, 50),
      bytesToB64url(aaguid),
    ).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO passkeys (player_id, admin_id, credential_id, public_key_jwk, sign_count, transports, name, aaguid) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)"
    ).bind(
      subject.id,
      credIdB64,
      JSON.stringify(jwk),
      parsed.signCount,
      JSON.stringify(credential.response.transports || []),
      (name || 'My Passkey').slice(0, 50),
      bytesToB64url(aaguid),
    ).run();
  }

  return { id: credIdB64, name: name || 'My Passkey' };
}

// 登录开始 (v17.5: 同时查 player 和 admin)
export async function passkeyLoginStart(env, username, rpId) {
  let subject = null; // { kind: 'player'|'admin', id, username, status, role? }
  if (username) {
    // 先查 player
    const p = await env.DB.prepare(
      "SELECT id, username, status, 'player' AS kind FROM players WHERE username = ? OR email = ?"
    ).bind(username, username).first();
    if (p && p.status === 'active') {
      subject = p;
    } else {
      // 再查 admin
      const a = await env.DB.prepare(
        "SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?"
      ).bind(username).first();
      if (a) subject = a;
    }
  }
  let allowCredentials = [];
  if (subject) {
    const where = subject.kind === 'admin' ? 'admin_id = ?' : 'player_id = ?';
    const rows = await env.DB.prepare(
      `SELECT credential_id, transports FROM passkeys WHERE ${where}`
    ).bind(subject.id).all();
    allowCredentials = rows.results.map((r) => ({
      id: r.credential_id,
      type: 'public-key',
      transports: JSON.parse(r.transports || '[]'),
    }));
  }
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const challengeB64 = bytesToB64url(challenge);
  const token = randomToken(24);
  const expires = new Date(Date.now() + 300_000).toISOString();
  // 复用 player_id 字段存 subjectKey
  const subjectKey = subject ? `${subject.kind}:${subject.id}` : null;
  await env.DB.prepare(
    "INSERT OR REPLACE INTO webauthn_challenges (token, challenge, purpose, player_id, expires_at) VALUES (?, ?, 'login', ?, ?)"
  ).bind(token, challengeB64, subjectKey, expires).run();
  return {
    challenge_token: token,
    publicKey: {
      challenge: challengeB64,
      rpId,
      allowCredentials,
      userVerification: 'preferred',
      timeout: 60000,
    },
    hint: subject ? { kind: subject.kind, id: subject.id, username: subject.username } : null,
  };
}

// 登录完成 (v17.5: 支持 player 和 admin)
export async function passkeyLoginFinish(env, body, rpId, expectedOrigin) {
  const { challenge_token: challengeToken, credential } = body;
  if (!challengeToken || !credential) throw new Error('缺少参数');
  const ch = await env.DB.prepare(
    "SELECT challenge, player_id, expires_at FROM webauthn_challenges WHERE token = ? AND purpose = 'login'"
  ).bind(challengeToken).first();
  if (!ch) throw new Error('challenge 无效');
  if (new Date(ch.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();
    throw new Error('challenge 已过期');
  }
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();

  const credId = credential.id;
  const pk = await env.DB.prepare(
    "SELECT * FROM passkeys WHERE credential_id = ?"
  ).bind(credId).first();
  if (!pk) throw new Error('该通行密钥未注册');

  const clientDataJSON = b64urlToBytes(credential.response.clientDataJSON);
  const authData = b64urlToBytes(credential.response.authenticatorData);
  const signature = b64urlToBytes(credential.response.signature);
  verifyClientData(clientDataJSON, ch.challenge, expectedOrigin);

  const parsed = parseAuthData(authData);
  const expected = await expectedRpIdHash(rpId);
  if (bytesToB64url(parsed.rpIdHash) !== bytesToB64url(expected)) throw new Error('rpIdHash 不匹配');
  if (!(parsed.flags & 0x01)) throw new Error('用户在场标志缺失');

  const jwk = JSON.parse(pk.public_key_jwk);
  const ok = await verifyEs256(jwk, signature, authData, clientDataJSON);
  if (!ok) throw new Error('签名验证失败');

  if (parsed.signCount > 0 && pk.sign_count > 0 && parsed.signCount <= pk.sign_count) {
    console.warn('passkey: signCount 未递增，疑似克隆', credId);
  }

  await env.DB.prepare(
    "UPDATE passkeys SET sign_count = ?, last_used_at = datetime('now') WHERE id = ?"
  ).bind(parsed.signCount, pk.id).run();

  // v17.5: 按 player_id 或 admin_id 拿账号信息
  if (pk.admin_id) {
    const admin = await env.DB.prepare(
      "SELECT id, username, role FROM admins WHERE id = ?"
    ).bind(pk.admin_id).first();
    if (!admin) throw new Error('管理员不存在');
    const { token, expires_at } = await createSession(env, null, admin.id);
    return { admin, token, expires_at, kind: 'admin' };
  }
  const player = await env.DB.prepare(
    "SELECT id, username, status FROM players WHERE id = ?"
  ).bind(pk.player_id).first();
  if (!player) throw new Error('玩家不存在');
  if (player.status !== 'active') throw new Error('账号已被禁用');
  const { token, expires_at } = await createSession(env, player.id, null);
  return { player, token, expires_at, kind: 'player' };
}

// v17.5: listPasskeys 接受 subject (kind + id) 或旧的 playerId
export async function listPasskeys(env, subjectOrPlayerId) {
  let kind, id;
  if (typeof subjectOrPlayerId === 'object' && subjectOrPlayerId !== null) {
    kind = subjectOrPlayerId.kind; id = subjectOrPlayerId.id;
  } else {
    kind = 'player'; id = subjectOrPlayerId;
  }
  const where = kind === 'admin' ? 'admin_id = ?' : 'player_id = ?';
  return await env.DB.prepare(
    `SELECT id, credential_id, name, created_at, last_used_at, aaguid FROM passkeys WHERE ${where} ORDER BY created_at DESC`
  ).bind(id).all();
}

export async function deletePasskey(env, subjectOrPlayerId, passkeyId) {
  let kind, id;
  if (typeof subjectOrPlayerId === 'object' && subjectOrPlayerId !== null) {
    kind = subjectOrPlayerId.kind; id = subjectOrPlayerId.id;
  } else {
    kind = 'player'; id = subjectOrPlayerId;
  }
  const where = kind === 'admin' ? 'id = ? AND admin_id = ?' : 'id = ? AND player_id = ?';
  return await env.DB.prepare(
    `DELETE FROM passkeys WHERE ${where}`
  ).bind(passkeyId, id).run();
}
