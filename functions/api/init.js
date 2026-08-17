// POST /api/init - 初始化 D1 表 + 默认 super admin
// GET  /api/init - 返回 schema 状态
import { ok, err, hashPassword } from '../_shared.js';

// 基础 SCHEMA（新部署用 CREATE TABLE IF NOT EXISTS）
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    game_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    bio TEXT,
    avatar_emoji TEXT DEFAULT '👤',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    player_id INTEGER,
    admin_id INTEGER,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    name TEXT NOT NULL,
    contact TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    admin_reply TEXT,
    replied_at TEXT,
    replied_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    room_id TEXT NOT NULL,
    room_name TEXT,
    in_date TEXT NOT NULL,
    out_date TEXT NOT NULL,
    nights INTEGER NOT NULL,
    persons INTEGER NOT NULL,
    breakfast INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS kart_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    session TEXT,
    car TEXT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS circuit_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // v16 新表
  `CREATE TABLE IF NOT EXISTS license_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    exam_type TEXT NOT NULL,
    exam_date TEXT,
    exam_session TEXT,
    contact TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    result_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS message_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_player_id INTEGER NOT NULL,
    to_player_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`
];

// ALTER 迁移：给已存在的表加新字段（重复加会报"duplicate column"，吞掉）
const MIGRATIONS = [
  `ALTER TABLE players ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE players ADD COLUMN bio TEXT`,
  `ALTER TABLE players ADD COLUMN avatar_emoji TEXT DEFAULT '👤'`,
  `ALTER TABLE messages ADD COLUMN admin_reply TEXT`,
  `ALTER TABLE messages ADD COLUMN replied_at TEXT`,
  `ALTER TABLE messages ADD COLUMN replied_by INTEGER`,
  // 修复 license_signups 缺 result_by/result_at 列
  `ALTER TABLE license_signups ADD COLUMN result_by INTEGER`,
  `ALTER TABLE license_signups ADD COLUMN result_at TEXT`,
  `ALTER TABLE license_signups ADD COLUMN reviewed_by INTEGER`
];

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all();
  return ok({ tables: tables.results.map(r => r.name), schema_count: SCHEMA.length });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  // 子路由：POST /api/init?action=ai-test（admin 鉴权，测 AI 真实连通性）
  const _url = new URL(request.url);
  if (_url.searchParams.get('action') === 'ai-test') {
    const cookie = request.headers.get('Cookie') || '';
    const _m = cookie.match(/lc_session=([^;]+)/);
    if (!_m) return err(401, '未登录');
    const _sess = await env.DB.prepare('SELECT admin_id, expires_at FROM sessions WHERE token = ?').bind(_m[1]).first();
    if (!_sess || !_sess.admin_id) return err(403, '需要管理员权限');
    if (Date.now() / 1000 > (_sess.expires_at || 0)) return err(401, '会话已过期');

    const _body = await request.json().catch(() => ({}));
    const testMsg = (_body.message || '你好').toString().slice(0, 100);
    const overrideBase = _body.base_url;
    const overrideKey = _body.api_key;
    const overrideModel = _body.model;

    const apiKey = overrideKey || env.OPENAI_API_KEY;
    const baseUrl = (overrideBase || env.OPENAI_BASE_URL || 'https://api.minimax.chat/v1').replace(/\/+$/, '');
    const model = overrideModel || env.OPENAI_MODEL || 'abab6.5s-chat';

    if (!apiKey) {
      return ok({ ok: false, stage: 'config', error: 'OPENAI_API_KEY 未配置' });
    }

    const url = `${baseUrl}/chat/completions`;
    const reqBody = {
      model,
      messages: [
        { role: 'system', content: '你是灯灯。请用一句话（30 字内）自我介绍。' },
        { role: 'user', content: testMsg },
      ],
      temperature: 0.5,
      max_tokens: 100,
    };

    let networkError = null, respStatus = null, respText = '', respBody = null;
    const t0 = Date.now();
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(reqBody),
      });
      respStatus = resp.status;
      respText = await resp.text().catch(() => '');
      try { respBody = JSON.parse(respText); } catch (e) {}
    } catch (e) {
      networkError = e?.message || String(e);
    }
    const elapsed = Date.now() - t0;

    if (networkError) {
      return ok({ ok: false, stage: 'network', error: networkError, url, model, key_prefix: apiKey.slice(0, 10) + '...', elapsed_ms: elapsed });
    }
    if (respStatus !== 200) {
      return ok({ ok: false, stage: 'http', http_status: respStatus, url, model, key_prefix: apiKey.slice(0, 10) + '...', elapsed_ms: elapsed, raw: respText.slice(0, 500), parsed: respBody });
    }
    const draft = respBody?.choices?.[0]?.message?.content || '';
    return ok({ ok: true, url, model, key_prefix: apiKey.slice(0, 10) + '...', elapsed_ms: elapsed, draft, full: respBody });
  }

  // 1. 建表
  for (const sql of SCHEMA) {
    await env.DB.prepare(sql).run();
  }

  // 2. 字段迁移（已存在的字段会报错，吞掉）
  const migrationResults = [];
  for (const sql of MIGRATIONS) {
    try {
      await env.DB.prepare(sql).run();
      migrationResults.push({ sql, status: 'applied' });
    } catch (e) {
      // 字段已存在（duplicate column）— 忽略
      migrationResults.push({ sql, status: 'skipped', reason: String(e.message || e).slice(0, 100) });
    }
  }

  // 3. 默认 super admin
  const existing = await env.DB.prepare(
    'SELECT id FROM admins WHERE username = ?'
  ).bind('LycheeJin').first();

  let adminInfo = null;
  if (!existing) {
    const defaultPw = 'DengGuangWhat20120619';
    const { hash, salt } = await hashPassword(defaultPw);
    const ins = await env.DB.prepare(
      'INSERT INTO admins (username, password_hash, salt, role) VALUES (?, ?, ?, ?)'
    ).bind('LycheeJin', hash, salt, 'super').run();
    adminInfo = { username: 'LycheeJin', role: 'super', default_password: defaultPw, action: 'created' };
  } else {
    adminInfo = { username: 'LycheeJin', action: 'already_exists' };
  }

  // 3.5 AI 客服 system 玩家（不存在则创建，存在则跳过）
  const AI_BOT_USERNAME = '灯灯客服';
  const botExisting = await env.DB.prepare(
    "SELECT id FROM players WHERE username = ?"
  ).bind(AI_BOT_USERNAME).first();
  let botInfo = { username: AI_BOT_USERNAME, action: 'already_exists' };
  if (!botExisting) {
    const randomPwd = 'AI_BOT_NO_LOGIN_' + crypto.randomUUID();
    const { hash: bHash, salt: bSalt } = await hashPassword(randomPwd);
    try {
      await env.DB.prepare(
        "INSERT INTO players (username, email, password_hash, salt, game_id, status, bio, avatar_emoji) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
      ).bind(
        AI_BOT_USERNAME,
        'ai-bot@system.local',
        bHash,
        bSalt,
        'AI_BOT',
        '我是 AI 客服灯灯，由市政厅训练。',
        '🤖'
      ).run();
      botInfo.action = 'created';
    } catch (e) {
      botInfo.action = 'failed';
      botInfo.error = String(e.message || e).slice(0, 100);
    }
  }

  // 4. 返回
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();

  return ok({
    initialized: true,
    tables: tables.results.map(r => r.name),
    migrations: migrationResults,
    admin: adminInfo,
    ai_bot: botInfo
  });
}
