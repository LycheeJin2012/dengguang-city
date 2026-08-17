// POST /api/init - 初始化 D1 表 + 默认 super admin
// GET  /api/init - 返回 schema 状态
// POST /api/init?action=ai-test        - admin 测 AI 连通性
// POST /api/init?action=passkey-*     - WebAuthn 通行密钥 (4 个子 action)
import {
  ok, err, hashPassword, readToken, getSession,
  passkeyRegisterStart, passkeyRegisterFinish,
  passkeyLoginStart, passkeyLoginFinish,
  listPasskeys, deletePasskey,
} from '../_shared.js';

// 从 request URL 解析 rpId（passkey 的域）
function getRpId(request) {
  const u = new URL(request.url);
  // dengguang-city.pages.dev
  return u.hostname.replace(/^www\./, '');
}

// 从 request URL 解析 origin
function getOrigin(request) {
  const u = new URL(request.url);
  return u.origin;
}

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
  )`,
  `CREATE TABLE IF NOT EXISTS passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    credential_id TEXT UNIQUE NOT NULL,
    public_key_jwk TEXT NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    name TEXT,
    aaguid TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    FOREIGN KEY (player_id) REFERENCES players(id)
  )`,
  `CREATE TABLE IF NOT EXISTS webauthn_challenges (
    token TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    purpose TEXT NOT NULL,
    player_id INTEGER,
    expires_at TEXT NOT NULL
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

  // ============================================================
  // WebAuthn Passkey 端点（2026-08-17）
  // POST /api/init?action=passkey-register-start    (需玩家登录)
  // POST /api/init?action=passkey-register-finish   (需玩家登录)
  // POST /api/init?action=passkey-login-start       (公开)
  // POST /api/init?action=passkey-login-finish      (公开)
  // POST /api/init?action=passkey-list              (需玩家登录)
  // POST /api/init?action=passkey-delete            (需玩家登录)
  // ============================================================
  const _action = _url.searchParams.get('action') || '';
  if (_action.startsWith('passkey-')) {
    try {
      const rpId = getRpId(request);
      const origin = getOrigin(request);
      const expectedOrigin = { type: 'webauthn.create', origin };  // register 用 create
      if (_action === 'passkey-register-start') {
        const _tok = readToken(request);
        const _sess = await getSession(env, _tok);
        if (!_sess || !_sess.player_id) return err(401, '需要先登录玩家账号');
        const _p = await env.DB.prepare('SELECT id, username FROM players WHERE id = ? AND status = "active"').bind(_sess.player_id).first();
        if (!_p) return err(401, '玩家不存在或已禁用');
        const _data = await passkeyRegisterStart(env, _p.id, rpId, _p.username);
        return ok(_data);
      }
      if (_action === 'passkey-register-finish') {
        const _tok = readToken(request);
        const _sess = await getSession(env, _tok);
        if (!_sess || !_sess.player_id) return err(401, '需要先登录玩家账号');
        const _body = await request.json().catch(() => ({}));
        const _data = await passkeyRegisterFinish(env, _body, _sess.player_id, rpId, expectedOrigin);
        return ok(_data);
      }
      if (_action === 'passkey-login-start') {
        const _body = await request.json().catch(() => ({}));
        const _data = await passkeyLoginStart(env, (_body.username || '').trim(), rpId);
        return ok(_data);
      }
      if (_action === 'passkey-login-finish') {
        const _body = await request.json().catch(() => ({}));
        const loginOrigin = { type: 'webauthn.get', origin };
        const _data = await passkeyLoginFinish(env, _body, rpId, loginOrigin);
        // _data: { player, token, expires_at }
        // 设置 cookie
        const cookie = `lc_session=${_data.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`;
        return new Response(JSON.stringify({ ok: true, player: { id: _data.player.id, username: _data.player.username }, expires_at: _data.expires_at }),
          { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie } });
      }
      if (_action === 'passkey-list') {
        const _tok = readToken(request);
        const _sess = await getSession(env, _tok);
        if (!_sess || !_sess.player_id) return err(401, '需要先登录');
        const _rows = await listPasskeys(env, _sess.player_id);
        return ok({ passkeys: _rows.results || [] });
      }
      if (_action === 'passkey-delete') {
        const _tok = readToken(request);
        const _sess = await getSession(env, _tok);
        if (!_sess || !_sess.player_id) return err(401, '需要先登录');
        const _body = await request.json().catch(() => ({}));
        const _id = parseInt(_body.id || 0, 10);
        if (!_id) return err(400, 'id 必填');
        await deletePasskey(env, _sess.player_id, _id);
        return ok({ deleted: _id });
      }
      return err(400, '未知 passkey action: ' + _action);
    } catch (e) {
      return err(500, 'passkey 错误: ' + (e?.message || String(e)));
    }
  }

  // ============================================================
  // Super Admin DM 监管 + 代回复 (2026-08-17)
  // POST /api/init?action=admin-dm-list        (super)
  // POST /api/init?action=admin-dm-thread&player_id=X (super)
  // POST /api/init?action=admin-dm-reply       (super)
  // POST /api/init?action=admin-dm-ai-struggle (super) - AI 兜底/转人工的对话
  // ============================================================
  const _adm = _url.searchParams.get('action') || '';
  if (_adm.startsWith('admin-dm-')) {
    const _tok = readToken(request);
    const _sess = await getSession(env, _tok);
    if (!_sess || !_sess.admin_id) return err(401, '需要管理员登录');
    const _admin = await env.DB.prepare('SELECT id, role, username FROM admins WHERE id = ?').bind(_sess.admin_id).first();
    if (!_admin) return err(401, '管理员不存在');
    if (_admin.role !== 'super') return err(403, '仅 super 管理员可监管 DM');

    try {
      if (_adm === 'admin-dm-list') {
        // 列所有 DM 会话（按 (from, to) pair），含最近一条内容 + 双方 username
        const _body = await request.json().catch(() => ({}));
        const _q = (_body.q || '').trim();
        let _sql = `
          SELECT
            dm.id, dm.from_player_id, dm.to_player_id, dm.content, dm.created_at, dm.read_at,
            pf.username AS from_username, pt.username AS to_username,
            pf.avatar_emoji AS from_avatar, pt.avatar_emoji AS to_avatar
          FROM direct_messages dm
          LEFT JOIN players pf ON pf.id = dm.from_player_id
          LEFT JOIN players pt ON pt.id = dm.to_player_id
          WHERE 1=1
        `;
        const _params = [];
        if (_q) {
          _sql += ` AND (pf.username LIKE ? OR pt.username LIKE ? OR dm.content LIKE ?)`;
          const _like = `%${_q}%`;
          _params.push(_like, _like, _like);
        }
        _sql += ` ORDER BY dm.created_at DESC LIMIT 200`;
        const _rows = await env.DB.prepare(_sql).bind(..._params).all();
        // 还要统计每个 player 的"未读 / 总数" - 略
        return ok({ dms: _rows.results || [] });
      }

      if (_adm === 'admin-dm-thread') {
        // 列两个 player 之间的全部 DM
        const _pid1 = parseInt(_url.searchParams.get('player_id') || '0', 10);
        const _pid2 = parseInt(_url.searchParams.get('peer_id') || '0', 10);
        if (!_pid1 || !_pid2) return err(400, 'player_id 和 peer_id 必填');
        const _rows = await env.DB.prepare(`
          SELECT dm.*, pf.username AS from_username, pt.username AS to_username,
                 pf.avatar_emoji AS from_avatar
          FROM direct_messages dm
          LEFT JOIN players pf ON pf.id = dm.from_player_id
          LEFT JOIN players pt ON pt.id = dm.to_player_id
          WHERE (dm.from_player_id = ? AND dm.to_player_id = ?)
             OR (dm.from_player_id = ? AND dm.to_player_id = ?)
          ORDER BY dm.created_at ASC LIMIT 200
        `).bind(_pid1, _pid2, _pid2, _pid1).all();
        return ok({ messages: _rows.results || [] });
      }

      if (_adm === 'admin-dm-reply') {
        // Super 借"灯灯客服"身份回复某个玩家
        const _body = await request.json().catch(() => ({}));
        const _toPlayerId = parseInt(_body.to_player_id || 0, 10);
        const _content = (_body.content || '').toString().trim().slice(0, 1000);
        if (!_toPlayerId) return err(400, 'to_player_id 必填');
        if (!_content) return err(400, 'content 不能为空');
        // 校验玩家
        const _tp = await env.DB.prepare('SELECT id, username, status FROM players WHERE id = ?').bind(_toPlayerId).first();
        if (!_tp) return err(400, '玩家不存在');
        if (_tp.status !== 'active') return err(400, '该玩家已禁用');
        // 拿 AI 客服 bot
        const _bot = await env.DB.prepare("SELECT id, username FROM players WHERE username = '灯灯客服'").first();
        if (!_bot) return err(500, 'AI 客服未初始化，请先调用 /api/init');
        // 插入 DM
        const _ins = await env.DB.prepare(
          "INSERT INTO direct_messages (from_player_id, to_player_id, content) VALUES (?, ?, ?)"
        ).bind(_bot.id, _tp.id, _content).run();
        return ok({ id: _ins.meta.last_row_id, from: '灯灯客服', to: _tp.username, sent_by_admin: _admin.username });
      }

      if (_adm === 'admin-dm-ai-struggle') {
        // 找出 AI 兜底/转人工的对话：搜 DM 内容中含"我作为 AI 给不出具体流程"或"请联系市政厅人工客服"等
        const _rows = await env.DB.prepare(`
          SELECT dm.id, dm.from_player_id, dm.to_player_id, dm.content, dm.created_at,
                 pf.username AS from_username, pt.username AS to_avatar_username
          FROM direct_messages dm
          LEFT JOIN players pf ON pf.id = dm.from_player_id
          LEFT JOIN players pt ON pt.id = dm.to_player_id
          WHERE pf.username = '灯灯客服'
            AND (dm.content LIKE '%我作为 AI 给不出具体流程%'
              OR dm.content LIKE '%请联系市政厅人工客服%'
              OR dm.content LIKE '%请联系市政厅管理员人工答复%'
              OR dm.content LIKE '%我 AI 给不出%')
          ORDER BY dm.created_at DESC LIMIT 50
        `).all();
        // 对每个 struggle 找对应玩家
        const _results = [];
        for (const r of (_rows.results || [])) {
          const _player = await env.DB.prepare('SELECT id, username FROM players WHERE id = ?').bind(r.to_player_id).first();
          _results.push({ ...r, to_username: _player?.username || '?', to_player_id_actual: r.to_player_id });
        }
        return ok({ struggles: _results });
      }

      return err(400, '未知 admin-dm action: ' + _adm);
    } catch (e) {
      return err(500, 'admin-dm 错误: ' + (e?.message || String(e)));
    }
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
