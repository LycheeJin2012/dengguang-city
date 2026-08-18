// POST /api/init - 初始化 D1 表 + 默认 super admin
// GET  /api/init - 返回 schema 状态
// POST /api/init?action=ai-test        - admin 测 AI 连通性
// POST /api/init?action=passkey-*     - WebAuthn 通行密钥 (4 个子 action)
import {
  ok, err, hashPassword, readToken, getSession, createSession,
  passkeyRegisterStart, passkeyRegisterFinish,
  passkeyLoginStart, passkeyLoginFinish,
  listPasskeys, deletePasskey,
  isUsername, isEmail, aiAutoReply, stripHtml,
  isNonEmpty, verifyPassword,
  randomToken, bytesToB64url, b64urlToBytes, expectedRpIdHash,
  verifyEs256, parseAuthData, verifyClientData,
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

// v17.5: 根据 session 自动识别玩家或管理员, 返回 subject { kind, id, username }
async function resolveSubjectFromSession(env, sess) {
  if (!sess) return null;
  if (sess.player_id) {
    const p = await env.DB.prepare(
      "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'"
    ).bind(sess.player_id).first();
    return p || null;
  }
  if (sess.admin_id) {
    // v17.8: 管理员绑定了玩家 → 通行密钥/密码 操作实际作用在玩家账号上
    const a = await env.DB.prepare(
      "SELECT a.id, a.username, a.role, a.linked_player_id, 'admin' AS kind FROM admins a WHERE a.id = ?"
    ).bind(sess.admin_id).first();
    if (!a) return null;
    if (a.linked_player_id) {
      const p = await env.DB.prepare(
        "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'"
      ).bind(a.linked_player_id).first();
      if (p) {
        // 标记一下让调用方知道这是从 admin 透传到 player 的
        return { ...p, _via_admin: a.id, _admin_username: a.username };
      }
    }
    return a;
  }
  return null;
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
    player_id INTEGER,
    admin_id INTEGER,
    credential_id TEXT UNIQUE NOT NULL,
    public_key_jwk TEXT NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    name TEXT,
    aaguid TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    FOREIGN KEY (player_id) REFERENCES players(id),
    FOREIGN KEY (admin_id) REFERENCES admins(id)
  )`,
  `CREATE TABLE IF NOT EXISTS webauthn_challenges (
    token TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    purpose TEXT NOT NULL,
    player_id INTEGER,
    expires_at TEXT NOT NULL
  )`,
  // v17.8: 市政公告（仅 super 管理员可发布）
  `CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (created_by) REFERENCES admins(id)
  )`,
  // v18: 首页图集管理 (super only, 公开读)
  `CREATE TABLE IF NOT EXISTS gallery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    num INTEGER NOT NULL,
    cat TEXT NOT NULL,           -- city / road / kart / nature / announcement
    label TEXT NOT NULL,
    file_url TEXT NOT NULL,       -- https://... 或 data:image/...
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_featured INTEGER NOT NULL DEFAULT 0,
    is_published INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (created_by) REFERENCES admins(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_gallery_num ON gallery_items(num)`,
  // v19: 每日签到 (玩家每日登录领绿宝石)
  `CREATE TABLE IF NOT EXISTS daily_signin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    signin_date TEXT NOT NULL,        -- YYYY-MM-DD (本地日期)
    streak INTEGER NOT NULL DEFAULT 1, -- 连续天数
    emeralds_earned INTEGER NOT NULL DEFAULT 10,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(player_id, signin_date),
    FOREIGN KEY (player_id) REFERENCES players(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_signin_player ON daily_signin(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_signin_date ON daily_signin(signin_date DESC)`
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
  `ALTER TABLE license_signups ADD COLUMN reviewed_by INTEGER`,
  // v17.5: passkeys 支持 admin (player_id 改为可空 + 加 admin_id)
  `ALTER TABLE passkeys ADD COLUMN admin_id INTEGER`,
  // v17.7: messages 支持"AI 自动回复后被人工覆盖"的历史追溯
  `ALTER TABLE messages ADD COLUMN previous_reply TEXT`,
  // v17.8: announcements 兼容迁移
  `ALTER TABLE announcements ADD COLUMN updated_at TEXT`,
  // v17.8: direct_messages 加 replied_by_admin_id (DM 回复人审计)
  `ALTER TABLE direct_messages ADD COLUMN replied_by_admin_id INTEGER`,
  // v17.8: admins 加 linked_player_id (管理员/玩家账号绑定)
  `ALTER TABLE admins ADD COLUMN linked_player_id INTEGER`,
  // v17.9: players 加 linked_admin_id (玩家反向绑定管理员,合并登录)
  `ALTER TABLE players ADD COLUMN linked_admin_id INTEGER`,
  // v17.9: backfill players.linked_admin_id 从 admins.linked_player_id 反向回填
  `UPDATE players SET linked_admin_id = (SELECT id FROM admins WHERE admins.linked_player_id = players.id) WHERE linked_admin_id IS NULL`,
  // v18: 加 D1 索引加速常用查询
  `CREATE INDEX IF NOT EXISTS idx_messages_status_created ON messages(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_player ON messages(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dm_from_to ON direct_messages(from_player_id, to_player_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_dm_to_unread ON direct_messages(to_player_id, read_at)`,
  `CREATE INDEX IF NOT EXISTS idx_dm_pair_created ON direct_messages(from_player_id, to_player_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_player ON bookings(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kart_player ON kart_signups(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_circuit_player ON circuit_signups(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_license_player ON license_signups(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_msg_comments_msg ON message_comments(message_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_passkeys_player ON passkeys(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_passkeys_admin ON passkeys(admin_id)`,
  `CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_webauthn_expires ON webauthn_challenges(expires_at)`,
  // v19: 每日签到 — players.emeralds 绿宝石余额 + daily_signin 表 (已建在 SCHEMA)
  `ALTER TABLE players ADD COLUMN emeralds INTEGER NOT NULL DEFAULT 0`,
];

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  // v18: GET /api/init?action=announcements-list 已拆到 functions/api/announcements.js

  // v19: GET /api/init?action=signin-status  (player 登录)
  const _u = new URL(request.url);
  const _a = _u.searchParams.get('action') || '';
  if (_a === 'unread-summary') {
    // 公开给登录玩家: 返回 DM / 留言回复 / 最新公告 id
    const _ck = request.headers.get('Cookie') || '';
    const _m = _ck.match(/lc_session=([^;]+)/);
    if (!_m) return ok({ logged_in: false, dm: 0, msg_replies: 0, announcement: null });
    const _sess = await env.DB.prepare('SELECT player_id, expires_at FROM sessions WHERE token = ?').bind(_m[1]).first();
    if (!_sess || !_sess.player_id || new Date(_sess.expires_at) <= new Date()) {
      return ok({ logged_in: false, dm: 0, msg_replies: 0, announcement: null });
    }
    const _pid = _sess.player_id;
    const _dm = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM direct_messages WHERE to_player_id = ? AND read_at IS NULL'
    ).bind(_pid).first();
    const _msgs = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM messages WHERE player_id = ? AND admin_reply IS NOT NULL AND admin_reply != ''"
    ).bind(_pid).first();
    const _ann = await env.DB.prepare(
      "SELECT id, created_at, title FROM announcements ORDER BY created_at DESC LIMIT 1"
    ).first();
    return ok({
      logged_in: true,
      player_id: _pid,
      dm: _dm?.c || 0,
      msg_replies: _msgs?.c || 0,
      announcement: _ann || null,
    });
  }
  if (_a === 'signin-status') {
    // cookie 解析
    const _ck = request.headers.get('Cookie') || '';
    const _m = _ck.match(/lc_session=([^;]+)/);
    if (!_m) return err(401, '未登录');
    const _sess = await env.DB.prepare('SELECT player_id, expires_at FROM sessions WHERE token = ?').bind(_m[1]).first();
    if (!_sess || !_sess.player_id) return err(401, '需要玩家登录');
    if (new Date(_sess.expires_at) <= new Date()) return err(401, '会话已过期');
    const _p = await env.DB.prepare('SELECT id, username, emeralds FROM players WHERE id = ?')
      .bind(_sess.player_id).first();
    if (!_p) return err(404, '玩家不存在');
    const _today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const _todayRow = await env.DB.prepare(
      'SELECT id, streak, emeralds_earned FROM daily_signin WHERE player_id = ? AND signin_date = ?'
    ).bind(_p.id, _today).first();
    const _recent = await env.DB.prepare(
      'SELECT signin_date, streak, emeralds_earned FROM daily_signin WHERE player_id = ? ORDER BY signin_date DESC LIMIT 7'
    ).bind(_p.id).all();
    const _totalRow = await env.DB.prepare(
      'SELECT COUNT(*) AS c, COALESCE(MAX(streak), 0) AS max_streak FROM daily_signin WHERE player_id = ?'
    ).bind(_p.id).first();
    let _curStreak = 0;
    if (_recent.results.length) {
      _curStreak = _recent.results[0].streak;
      const _yest = new Date(new Date(_today).getTime() - 86400000).toISOString().slice(0, 10);
      if (_recent.results[0].signin_date !== _today && _recent.results[0].signin_date !== _yest) {
        _curStreak = 0;
      }
    }
    return ok({
      signed_today: !!_todayRow,
      today_streak: _todayRow ? _todayRow.streak : 0,
      today_emeralds: _todayRow ? _todayRow.emeralds_earned : 0,
      current_streak: _curStreak,
      max_streak: _totalRow ? _totalRow.max_streak : 0,
      total_days: _totalRow ? _totalRow.c : 0,
      emeralds: _p.emeralds || 0,
      recent: _recent.results,
      today: _today,
    });
  }

  // v19: 自动 MIGRATIONS — 任何 GET 都会确保 schema/字段最新
  // (解决"用户没主动 POST /api/init" 导致 MIGRATIONS 没跑, 新字段缺失)
  // 走 SCHEMA 幂等 (CREATE TABLE IF NOT EXISTS) + MIGRATIONS try/catch 吞错
  for (const sql of SCHEMA) {
    try { await env.DB.prepare(sql).run(); } catch (e) {}
  }
  for (const sql of MIGRATIONS) {
    try { await env.DB.prepare(sql).run(); } catch (e) {}
  }

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
  const _action = _url.searchParams.get('action') || '';

  // 解析 session, 取 admin 身份 (给所有 admin 鉴权的 action 用)
  let _me = null;
  let _sess = null;
  const _cookie = request.headers.get('Cookie') || '';
  const _m = _cookie.match(/lc_session=([^;]+)/);
  if (_m) {
    _sess = await env.DB.prepare('SELECT admin_id, player_id, expires_at FROM sessions WHERE token = ?').bind(_m[1]).first();
    // expires_at 是 ISO 字符串, 跟 Date.now() 比要 new Date() 转
    if (_sess && _sess.admin_id && new Date(_sess.expires_at) > new Date()) {
      _me = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(_sess.admin_id).first();
    }
  }

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
  // v17.8: 市政公告 CRUD (仅 super 管理员可写)
  // POST /api/init?action=announcement-create        (super)
  // POST /api/init?action=announcement-update&id=X   (super)
  // POST /api/init?action=announcement-delete&id=X   (super)
  // ============================================================
  if (_action === 'announcement-create' || _action === 'announcement-update' || _action === 'announcement-delete') {
    // 鉴权: 必须是 super 管理员
    const _ck = request.headers.get('Cookie') || '';
    const _m = _ck.match(/lc_session=([^;]+)/);
    if (!_m) return err(401, '未登录');
    const _sess = await env.DB.prepare('SELECT admin_id, expires_at FROM sessions WHERE token = ?').bind(_m[1]).first();
    if (!_sess || !_sess.admin_id) return err(403, '需要管理员权限');
    if (Date.now() / 1000 > (_sess.expires_at || 0)) return err(401, '会话已过期');
    const _me = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(_sess.admin_id).first();
    if (!_me || _me.role !== 'super') return err(403, '只有 super 管理员可操作公告');

    if (_action === 'announcement-delete') {
      const id = parseInt(_url.searchParams.get('id') || '0', 10);
      if (!id) return err(400, 'id 必填');
      try {
        await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
        return ok({ id, deleted: true });
      } catch (e) { return err(500, '删除失败: ' + e.message); }
    }

    const _b = await request.json().catch(() => ({}));
    const title = stripHtml((_b.title || '').toString()).trim();
    const content = stripHtml((_b.content || '').toString()).trim();
    if (title.length < 2 || title.length > 80) return err(400, '标题 2-80 字');
    if (content.length < 2 || content.length > 2000) return err(400, '内容 2-2000 字');

    if (_action === 'announcement-create') {
      try {
        const r = await env.DB.prepare(
          "INSERT INTO announcements (title, content, created_by) VALUES (?, ?, ?)"
        ).bind(title, content, _me.id).run();
        return ok({ id: r.meta.last_row_id, ok: true });
      } catch (e) { return err(500, '发布失败: ' + e.message); }
    }

    if (_action === 'announcement-update') {
      const id = parseInt(_url.searchParams.get('id') || '0', 10);
      if (!id) return err(400, 'id 必填');
      try {
        await env.DB.prepare(
          "UPDATE announcements SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(title, content, id).run();
        return ok({ id, ok: true });
      } catch (e) { return err(500, '更新失败: ' + e.message); }
    }
  }

  // ============================================================
  // WebAuthn Passkey 端点（2026-08-17）
  // POST /api/init?action=passkey-register-start    (需玩家 OR 管理员登录) v17.5
  // POST /api/init?action=passkey-register-finish   (需玩家 OR 管理员登录)
  // POST /api/init?action=passkey-login-start       (公开)
  // POST /api/init?action=passkey-login-finish      (公开, 自动识别 player/admin)
  // POST /api/init?action=passkey-list              (需玩家 OR 管理员登录)
  // POST /api/init?action=passkey-delete            (需玩家 OR 管理员登录)
  // v17.10: passkey-admin-enter-* 走外部独立块 (玩家 session 升级 combined 用)
  // ============================================================
  if (_action.startsWith('passkey-') && !_action.startsWith('passkey-admin-enter-')) {
    try {
      const rpId = getRpId(request);
      const origin = getOrigin(request);
      const expectedOrigin = { type: 'webauthn.create', origin };  // register 用 create
      // 提一次 readToken + getSession 给所有 passkey-* 共享
      const _tok = readToken(request);
      const _sess = _tok ? await getSession(env, _tok) : null;
      if (_action === 'passkey-register-start') {
        if (!_sess) return err(401, '需要先登录');
        const _subject = await resolveSubjectFromSession(env, _sess);
        if (!_subject) return err(401, '账号不存在或已禁用');
        const _data = await passkeyRegisterStart(env, _subject, rpId);
        return ok(_data);
      }
      if (_action === 'passkey-register-finish') {
        if (!_sess) return err(401, '需要先登录');
        const _subject = await resolveSubjectFromSession(env, _sess);
        if (!_subject) return err(401, '账号不存在或已禁用');
        const _body = await request.json().catch(() => ({}));
        const _data = await passkeyRegisterFinish(env, _body, _subject, rpId, expectedOrigin);
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
        // v17.10: combined session — 可能同时有 admin 和 player
        const cookie = `lc_session=${_data.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`;
        let userObj = {};
        if (_data.kind === 'admin' || _data.admin) {
          userObj = { id: _data.admin.id, username: _data.admin.username, role: _data.admin.role };
        } else {
          userObj = { id: _data.player.id, username: _data.player.username };
        }
        return new Response(JSON.stringify({
          ok: true, ...userObj, kind: _data.kind,
          expires_at: _data.expires_at,
          combined: !!_data.combined,
          admin: _data.admin || null,
          player: _data.player || null,
        }), {
          status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie }
        });
      }
      if (_action === 'passkey-list') {
        if (!_sess) return err(401, '需要先登录');
        const _subject = await resolveSubjectFromSession(env, _sess);
        if (!_subject) return err(401, '账号不存在或已禁用');
        const _rows = await listPasskeys(env, _subject);
        return ok({ passkeys: _rows.results || [] });
      }
      if (_action === 'passkey-delete') {
        if (!_sess) return err(401, '需要先登录');
        const _subject = await resolveSubjectFromSession(env, _sess);
        if (!_subject) return err(401, '账号不存在或已禁用');
        const _body = await request.json().catch(() => ({}));
        const _id = parseInt(_body.id || 0, 10);
        if (!_id) return err(400, 'id 必填');
        await deletePasskey(env, _subject, _id);
        return ok({ deleted: _id });
      }
      if (_action === 'passkey-test-start') {
        if (!_sess) return err(401, '需要先登录');
        if (new Date(_sess.expires_at) <= new Date()) return err(401, '会话已过期');
        const _b = await request.json().catch(() => ({}));
        const _credId = (_b.credential_id || '').trim();
        if (!_credId) return err(400, 'credential_id 必填');
        const _pk = await env.DB.prepare('SELECT * FROM passkeys WHERE credential_id = ?').bind(_credId).first();
        if (!_pk) return err(404, '通行密钥不存在');
        // 验证 passkey 属于当前 subject
        if (_sess.player_id) {
          const _pl = await env.DB.prepare('SELECT linked_admin_id FROM players WHERE id = ?').bind(_sess.player_id).first();
          if (_pk.player_id !== _sess.player_id && _pk.admin_id !== (_pl?.linked_admin_id || null)) {
            return err(403, '该通行密钥不属于你的账号');
          }
        } else if (_sess.admin_id) {
          const _al = await env.DB.prepare('SELECT linked_player_id FROM admins WHERE id = ?').bind(_sess.admin_id).first();
          if (_pk.admin_id !== _sess.admin_id && _pk.player_id !== (_al?.linked_player_id || null)) {
            return err(403, '该通行密钥不属于你的账号');
          }
        }
        const _challenge = crypto.getRandomValues(new Uint8Array(32));
        const _token = randomToken(24);
        const _expires = new Date(Date.now() + 300_000).toISOString();
        await env.DB.prepare(
          "INSERT OR REPLACE INTO webauthn_challenges (token, challenge, purpose, player_id, expires_at) VALUES (?, ?, 'test', ?, ?)"
        ).bind(_token, bytesToB64url(_challenge), `test:${_credId}`, _expires).run();
        return ok({
          challenge_token: _token,
          publicKey: {
            challenge: bytesToB64url(_challenge),
            rpId,
            allowCredentials: [{ id: _credId, type: 'public-key', transports: JSON.parse(_pk.transports || '[]') }],
            userVerification: 'preferred',
            timeout: 60000,
          }
        });
      }
      if (_action === 'passkey-test-finish') {
        if (!_sess) return err(401, '需要先登录');
        if (new Date(_sess.expires_at) <= new Date()) return err(401, '会话已过期');
        const _b = await request.json().catch(() => ({}));
        const { challenge_token: _ct, credential } = _b;
        if (!_ct || !credential) return err(400, '缺少参数');
        const _ch = await env.DB.prepare(
          "SELECT challenge, player_id, expires_at FROM webauthn_challenges WHERE token = ? AND purpose = 'test'"
        ).bind(_ct).first();
        if (!_ch) return err(400, 'challenge 无效');
        if (new Date(_ch.expires_at) < new Date()) {
          await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(_ct).run();
          return err(400, 'challenge 已过期');
        }
        await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(_ct).run();
        const _targetCredId = (_ch.player_id || '').replace(/^test:/, '');
        if (credential.id !== _targetCredId) return err(401, '凭据 ID 不匹配');
        const _pk = await env.DB.prepare('SELECT * FROM passkeys WHERE credential_id = ?').bind(credential.id).first();
        if (!_pk) return err(401, '该通行密钥未注册');
        const _loginOrigin = { type: 'webauthn.get', origin };
        const _cdj = b64urlToBytes(credential.response.clientDataJSON);
        const _ad = b64urlToBytes(credential.response.authenticatorData);
        const _sig = b64urlToBytes(credential.response.signature);
        verifyClientData(_cdj, _ch.challenge, _loginOrigin);
        const _parsed = parseAuthData(_ad);
        const _expected = await expectedRpIdHash(rpId);
        if (bytesToB64url(_parsed.rpIdHash) !== bytesToB64url(_expected)) return err(401, 'rpIdHash 不匹配');
        if (!(_parsed.flags & 0x01)) return err(401, '用户在场标志缺失');
        const _jwk = JSON.parse(_pk.public_key_jwk);
        const _ok = await verifyEs256(env, _pk, _jwk, _sig, _ad, _cdj);
        if (!_ok) return err(401, '签名验证失败');
        await env.DB.prepare("UPDATE passkeys SET sign_count = ?, last_used_at = datetime('now') WHERE id = ?")
          .bind(_parsed.signCount, _pk.id).run();
        return ok({ verified: true, message: '该通行密钥能正常登录' });
      }
      return err(400, '未知 passkey action: ' + _action);
    } catch (e) {
      return err(500, 'passkey 错误: ' + (e?.message || String(e)));
    }
  }

  // ============================================================
  // Super Admin DM 监管 + 代回复 + AI 辅助 (2026-08-17 v17.2)
  // POST /api/init?action=admin-dm-list        (super)
  // POST /api/init?action=admin-dm-thread&player_id=X (super)
  // POST /api/init?action=admin-dm-reply       (super)
  // POST /api/init?action=admin-dm-ai-struggle (super) - AI 兜底/转人工的对话
  // POST /api/init?action=admin-dm-ai-suggest  (super) - 灯灯客服 AI 辅助生成回复
  // POST /api/init?action=admin-dm-conversations (super) - 所有 DM 会话+每会话未读
  // POST /api/init?action=admin-player-list    (super) - 玩家列表+最后活跃时间
  // POST /api/init?action=admin-player-create  (super) - 超管代注册新玩家
  // ============================================================
  const _adm = _url.searchParams.get('action') || '';
  if (_adm.startsWith('admin-dm-') || _adm.startsWith('admin-player-')) {
    const _tok = readToken(request);
    const _sess = await getSession(env, _tok);
    if (!_sess || !_sess.admin_id) return err(401, '需要管理员登录');
    const _admin = await env.DB.prepare('SELECT id, role, username FROM admins WHERE id = ?').bind(_sess.admin_id).first();
    if (!_admin) return err(401, '管理员不存在');
    if (_admin.role !== 'super') return err(403, '仅 super 管理员可使用此功能');

    try {
      if (_adm === 'admin-dm-conversations') {
        // 列所有 DM 会话: 每对 (from,to) 一条, 含双方 username/avatar, 最后一条 content/at, 未读数
        const _body = await request.json().catch(() => ({}));
        const _q = (_body.q || '').trim();
        let _sql = `
          SELECT
            dm.from_player_id, dm.to_player_id, dm.content AS last_content, dm.created_at AS last_at, dm.read_at,
            dm.replied_by_admin_id,
            ad.username AS replied_by_admin_username,
            pf.username AS from_username, pt.username AS to_username,
            pf.avatar_emoji AS from_avatar, pt.avatar_emoji AS to_avatar,
            (SELECT COUNT(*) FROM direct_messages WHERE from_player_id = dm.to_player_id AND to_player_id = dm.from_player_id AND read_at IS NULL) AS unread_count
          FROM direct_messages dm
          LEFT JOIN players pf ON pf.id = dm.from_player_id
          LEFT JOIN players pt ON pt.id = dm.to_player_id
          LEFT JOIN admins ad ON ad.id = dm.replied_by_admin_id
          WHERE dm.id IN (
            SELECT MAX(id) FROM direct_messages GROUP BY (CASE WHEN from_player_id < to_player_id THEN from_player_id ELSE to_player_id END), (CASE WHEN from_player_id > to_player_id THEN from_player_id ELSE to_player_id END)
          )
        `;
        const _params = [];
        if (_q) {
          _sql += ` AND (pf.username LIKE ? OR pt.username LIKE ? OR dm.content LIKE ?)`;
          const _like = `%${_q}%`;
          _params.push(_like, _like, _like);
        }
        _sql += ` ORDER BY last_at DESC LIMIT 100`;
        const _rows = await env.DB.prepare(_sql).bind(..._params).all();
        return ok({ conversations: _rows.results || [] });
      }

      if (_adm === 'admin-dm-ai-suggest') {
        // AI 辅助生成"灯灯客服"风格的回复草稿
        const _body = await request.json().catch(() => ({}));
        const _toPlayerId = parseInt(_body.to_player_id || 0, 10);
        const _lastMsg = (_body.last_message || '').toString().slice(0, 200);
        const _hint = (_body.hint || '').toString().slice(0, 100);
        if (!_toPlayerId) return err(400, 'to_player_id 必填');
        if (!_lastMsg) return err(400, 'last_message 必填');
        // 拉最近 5 条对话作为上下文
        const _ctx = await env.DB.prepare(`
          SELECT dm.from_player_id, dm.content, dm.created_at
          FROM direct_messages dm
          WHERE (dm.from_player_id = ? AND dm.to_player_id = 17)
             OR (dm.from_player_id = 17 AND dm.to_player_id = ?)
          ORDER BY dm.id DESC LIMIT 5
        `).bind(_toPlayerId, _toPlayerId).all();
        const _ctxStr = (_ctx.results || []).reverse().map(m =>
          `${m.from_player_id === 17 ? '灯灯' : '玩家'}: ${m.content}`
        ).join('\n');
        // 调 AI 生成草稿
        const _sys = `你是「灯光市」市政厅 AI 客服灯灯，正在协助 super 管理员为市民写回复。
灯光市是一座 Minecraft 服务器上的像素城市，由玩家共同管理。
要求：
1. 亲切、简洁、专业，**总字数严格控制在 100 字以内**（含标点）
2. 直接给正文，不要前缀"灯灯："等
3. 严禁编造任何具体信息：数字、电话、邮箱、人名、活动名、日期
4. 不确定的事建议"请 DM 私信补充具体信息"或"请联系市政厅人工"
5. 体现已理解对方的诉求，并给出可执行的下一步`;
        const _user = `最近对话上下文（玩家最新发言在最后）：
${_ctxStr || '（无历史）'}

玩家最新发言：${_lastMsg}
${_hint ? '\n管理员提示：' + _hint : ''}

请写一段 100 字以内的回复草稿：`;
        const _draft = await aiAutoReply(env, _user, 'dm');
        // aiAutoReply 会用 100 字硬截断, 但如果 OFFLINE 用 模板更短
        if (!_draft) return err(500, 'AI 生成失败');
        return ok({ draft: _draft, model: 'abab6.5s-chat' });
      }

      if (_adm === 'admin-player-list') {
        // 玩家列表 + 最后活跃时间 (从 sessions 表查最近登录) + 注册时间
        const _q = (_url.searchParams.get('q') || '').trim();
        let _sql = `
          SELECT
            p.id, p.username, p.email, p.game_id, p.status, p.bio, p.avatar_emoji, p.created_at,
            (SELECT MAX(s.expires_at) FROM sessions s WHERE s.player_id = p.id) AS last_session
          FROM players p
          WHERE 1=1
        `;
        const _params = [];
        if (_q) _sql += ` AND (p.username LIKE ? OR p.email LIKE ? OR p.game_id LIKE ?)`,
          _params.push(`%${_q}%`, `%${_q}%`, `%${_q}%`);
        _sql += ` ORDER BY p.created_at DESC LIMIT 200`;
        const _rows = await env.DB.prepare(_sql).bind(..._params).all();
        return ok({ players: _rows.results || [] });
      }

      if (_adm === 'admin-player-create') {
        // 超管代注册玩家 (不需玩家本人注册/审批, 直接 active)
        const _body = await request.json().catch(() => ({}));
        const _username = (_body.username || '').trim();
        const _email = (_body.email || '').trim();
        const _gameId = (_body.game_id || '').trim();
        const _password = (_body.password || '').toString();
        if (!isUsername(_username)) return err(400, '用户名 2-32 字符, 不含 @/控制字符');
        if (!isEmail(_email)) return err(400, '邮箱格式错误');
        if (_password.length < 8) return err(400, '密码至少 8 位');
        // 检查冲突
        const _exists = await env.DB.prepare(
          'SELECT id FROM players WHERE username = ? OR email = ?'
        ).bind(_username, _email).first();
        if (_exists) return err(400, '用户名或邮箱已被注册');
        // 创建 (status=active, 跳过 pending 审批)
        const _hash = await hashPassword(_password);
        await env.DB.prepare(
          "INSERT INTO players (username, email, password_hash, salt, game_id, status, bio, avatar_emoji) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
        ).bind(_username, _email, _hash.hash, _hash.salt, _gameId, '由 super 管理员代注册', '👤').run();
        return ok({ username: _username, status: 'active', action: 'created' });
      }

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
        // 插入 DM (v17.8: 记录是哪位管理员代发, 区别于 AI 客服自动回复)
        const _ins = await env.DB.prepare(
          "INSERT INTO direct_messages (from_player_id, to_player_id, content, replied_by_admin_id) VALUES (?, ?, ?, ?)"
        ).bind(_bot.id, _tp.id, _content, _admin.id).run();
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

  // ============================================================
  // v17.9: 超管合并/解绑 管理员+玩家账号
  // POST /api/init?action=admin-merge-account      (super)
  //   body: { admin_id: int, player_id: int }
  // POST /api/init?action=admin-unmerge-account    (super)
  //   body: { admin_id: int, player_id: int }
  // ============================================================
  if (_action === 'admin-merge-account' || _action === 'admin-unmerge-account') {
    if (!_me || _me.role !== 'super') return err(403, '只有 super 管理员可操作合并');
    const _b = await request.json().catch(() => ({}));
    const _adminId = parseInt(_b.admin_id || 0, 10);
    const _playerId = parseInt(_b.player_id || 0, 10);
    if (!_adminId || !_playerId) return err(400, 'admin_id 和 player_id 必填');
    try {
      if (_action === 'admin-merge-account') {
        // 引入 mergeAccount (在 _shared.js)
        const { mergeAccount } = await import('../_shared.js');
        const _r = await mergeAccount(env, _adminId, _playerId);
        return ok({ merged: true, ..._r });
      } else {
        const { unmergeAccount } = await import('../_shared.js');
        await unmergeAccount(env, _adminId, _playerId);
        return ok({ unmerged: true, admin_id: _adminId, player_id: _playerId });
      }
    } catch (e) {
      return err(500, e?.message || String(e));
    }
  }

  // ============================================================
  // v17.9: super 管理员重置玩家密码 (合并账号时不改 admin 密码)
  // POST /api/init?action=admin-reset-player-password   (super)
  //   body: { player_id: int, new_password: string }
  // ============================================================
  if (_action === 'admin-reset-player-password') {
    if (!_me || _me.role !== 'super') return err(403, '只有 super 管理员可重置玩家密码');
    const _b = await request.json().catch(() => ({}));
    const _pid = parseInt(_b.player_id || 0, 10);
    const _newPw = (_b.new_password || '').toString();
    if (!_pid || !isNonEmpty(_newPw, 128)) return err(400, 'player_id 和 new_password 必填');
    if (_newPw.length < 8) return err(400, '新密码至少 8 位');
    const _p = await env.DB.prepare('SELECT id, username FROM players WHERE id = ?').bind(_pid).first();
    if (!_p) return err(404, '玩家不存在');
    const { hash, salt } = await hashPassword(_newPw);
    await env.DB.prepare('UPDATE players SET password_hash = ?, salt = ? WHERE id = ?')
      .bind(hash, salt, _pid).run();
    return ok({ player_id: _pid, username: _p.username, message: '玩家密码已重置 (不影响任何已绑定的管理员账号)' });
  }

  // ============================================================
  // v17.9: 玩家改自己密码
  // 注: 合并账号但两边密码不共享 — 改 player 密码不影响绑定的 admin
  // POST /api/init?action=player-change-password   (player 登录)
  //   body: { old_password, new_password }
  // ============================================================
  if (_action === 'player-change-password') {
    if (!_sess || !_sess.player_id) return err(401, '需要玩家登录');
    if (new Date(_sess.expires_at) <= new Date()) return err(401, '会话已过期');
    const _b = await request.json().catch(() => ({}));
    const _old = (_b.old_password || '').toString();
    const _new = (_b.new_password || '').toString();
    if (_old.length < 8 || _new.length < 8) return err(400, '新旧密码至少 8 位');
    const _p = await env.DB.prepare('SELECT id, password_hash, salt FROM players WHERE id = ?').bind(_sess.player_id).first();
    if (!_p) return err(404, '玩家不存在');
    const _ok = await verifyPassword(_old, _p.password_hash, _p.salt);
    if (!_ok) return err(401, '旧密码错误');
    const { hash, salt } = await hashPassword(_new);
    await env.DB.prepare('UPDATE players SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, _p.id).run();
    return ok({ id: _p.id, message: '密码已更新' });
  }

  // ============================================================
  // v17.10: 玩家 session 验证管理员密码后升级为 combined
  // POST /api/init?action=admin-enter-password
  //   body: { admin_password: string }
  //   session: 必须是 player session (有 linked_admin_id)
  //   验证: 管理员的 password_hash/salt 与 body 一致
  //   升级: 在 sessions 行加 admin_id (写新 session, Set-Cookie)
  // ============================================================
  if (_action === 'admin-enter-password') {
    if (!_sess || !_sess.player_id) return err(401, '需要先登录玩家账号');
    if (new Date(_sess.expires_at) <= new Date()) return err(401, '会话已过期');
    const _b = await request.json().catch(() => ({}));
    const _pw = (_b.admin_password || '').toString();
    if (_pw.length < 8) return err(400, '管理员密码至少 8 位');
    // 找该玩家关联的管理员
    const _link = await env.DB.prepare(
      'SELECT a.id, a.username, a.role, a.password_hash, a.salt FROM players p LEFT JOIN admins a ON a.id = p.linked_admin_id WHERE p.id = ?'
    ).bind(_sess.player_id).first();
    if (!_link || !_link.id) return err(403, '该玩家账号未绑定管理员账号, 无法进入管理后台');
    if (_link.role !== 'super' && _link.role !== 'admin') return err(403, '关联账号不是管理员');
    const _ok = await verifyPassword(_pw, _link.password_hash, _link.salt);
    if (!_ok) return err(401, '管理员密码错误');
    // 创建 combined session, Set-Cookie
    const _r = await createSession(env, _sess.player_id, _link.id);
    if (_m) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(_m[1]).run();
    const _cookie = `lc_session=${_r.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8*3600}`;
    return new Response(JSON.stringify({
      ok: true, combined: true,
      admin: { id: _link.id, username: _link.username, role: _link.role },
      player_id: _sess.player_id,
    }), {
      status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': _cookie }
    });
  }

  // ============================================================
  // v17.10: 玩家 session 用 passkey 验证后升级为 combined
  // POST /api/init?action=passkey-admin-enter-start   (玩家 session)
  //   返回 challenge_token + publicKey (allowCredentials 含玩家自己+关联 admin 的 passkey)
  // POST /api/init?action=passkey-admin-enter-finish  (玩家 session, 需先 start)
  //   body: { challenge_token, credential }
  //   验证: 任何能识别该玩家+关联 admin 的 passkey 都能进
  //   升级: 写 admin_id 到 session (Set-Cookie)
  // ============================================================
  if (_action === 'passkey-admin-enter-start') {
    if (!_sess || !_sess.player_id) return err(401, '需要先登录玩家账号');
    if (new Date(_sess.expires_at) <= new Date()) return err(401, '会话已过期');
    const _rpId = getRpId(request);
    const _player = await env.DB.prepare('SELECT id, linked_admin_id FROM players WHERE id = ?').bind(_sess.player_id).first();
    if (!_player || !_player.linked_admin_id) return err(403, '该玩家账号未绑定管理员账号');
    const _ids = [_sess.player_id, _player.linked_admin_id];
    const _ph = _ids.map(() => '?').join(',');
    const _rows = await env.DB.prepare(
      `SELECT credential_id, transports FROM passkeys WHERE player_id IN (${_ph}) OR admin_id IN (${_ph})`
    ).bind(..._ids, ..._ids).all();
    if (!_rows.results || _rows.results.length === 0) {
      return err(400, '请先在玩家主页添加通行密钥');
    }
    const allowCredentials = _rows.results.map((r) => ({
      id: r.credential_id, type: 'public-key', transports: JSON.parse(r.transports || '[]'),
    }));
    const _challenge = crypto.getRandomValues(new Uint8Array(32));
    const _token = randomToken(24);
    const _expires = new Date(Date.now() + 300_000).toISOString();
    // 复用 player_id 字段存 `admin-enter:${player_id}:${admin_id}`
    const _subjectKey = `admin-enter:${_sess.player_id}:${_player.linked_admin_id}`;
    await env.DB.prepare(
      "INSERT OR REPLACE INTO webauthn_challenges (token, challenge, purpose, player_id, expires_at) VALUES (?, ?, 'admin-enter', ?, ?)"
    ).bind(_token, bytesToB64url(_challenge), _subjectKey, _expires).run();
    return ok({
      challenge_token: _token,
      publicKey: {
        challenge: bytesToB64url(_challenge),
        rpId: _rpId,
        allowCredentials,
        userVerification: 'preferred',
        timeout: 60000,
      }
    });
  }
  // ============================================================
  // v17.10: 玩家 session 用 passkey 验证后升级为 combined
  // POST /api/init?action=passkey-admin-enter-finish  (玩家 session, 需先 start)
  //   body: { challenge_token, credential }
  //   验证: 任何能识别该玩家+关联 admin 的 passkey 都能进
  //   升级: 写 admin_id 到 session (Set-Cookie)
  // 注: passkey-test-start/finish 已在上面的 try 块里处理 (line 455/492),
  //    不要在这里再定义, 会落不到这里
  // ============================================================
  if (_action === 'passkey-admin-enter-finish') {
    if (!_sess || !_sess.player_id) return err(401, '需要先登录玩家账号');
    if (new Date(_sess.expires_at) <= new Date()) return err(401, '会话已过期');
    const _rpId = getRpId(request);
    const _origin = getOrigin(request);
    const _b = await request.json().catch(() => ({}));
    const { challenge_token: _ct, credential } = _b;
    if (!_ct || !credential) return err(400, '缺少 challenge_token 或 credential');
    const _ch = await env.DB.prepare(
      "SELECT challenge, player_id, expires_at FROM webauthn_challenges WHERE token = ? AND purpose = 'admin-enter'"
    ).bind(_ct).first();
    if (!_ch) return err(400, 'challenge 无效');
    if (new Date(_ch.expires_at) < new Date()) {
      await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(_ct).run();
      return err(400, 'challenge 已过期');
    }
    await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(_ct).run();
    // player_id 字段存 `admin-enter:player_id:admin_id`
    const _subjectKey = _ch.player_id || '';
    const _m2 = _subjectKey.match(/^admin-enter:(\d+):(\d+)$/);
    if (!_m2) return err(400, 'challenge 主体异常');
    const _adminId = parseInt(_m2[2], 10);
    // 验证 passkey
    const _credId = credential.id;
    const _pk = await env.DB.prepare(
      "SELECT * FROM passkeys WHERE credential_id = ?"
    ).bind(_credId).first();
    if (!_pk) return err(401, '该通行密钥未注册');
    // 必须属于该 player 或关联 admin
    if (_pk.player_id !== _sess.player_id && _pk.admin_id !== _adminId) {
      return err(401, '该通行密钥不属于此账号');
    }
    const _loginOrigin = { type: 'webauthn.get', origin: _origin };
    const _clientDataJSON = b64urlToBytes(credential.response.clientDataJSON);
    const _authData = b64urlToBytes(credential.response.authenticatorData);
    const _signature = b64urlToBytes(credential.response.signature);
    verifyClientData(_clientDataJSON, _ch.challenge, _loginOrigin);
    const _parsed = parseAuthData(_authData);
    const _expected = await expectedRpIdHash(_rpId);
    if (bytesToB64url(_parsed.rpIdHash) !== bytesToB64url(_expected)) return err(401, 'rpIdHash 不匹配');
    if (!(_parsed.flags & 0x01)) return err(401, '用户在场标志缺失');
    const _jwk = JSON.parse(_pk.public_key_jwk);
    const _ok = await verifyEs256(env, _pk, _jwk, _signature, _authData, _clientDataJSON);
    if (!_ok) return err(401, '签名验证失败');
    await env.DB.prepare("UPDATE passkeys SET sign_count = ?, last_used_at = datetime('now') WHERE id = ?")
      .bind(_parsed.signCount, _pk.id).run();
    // 升级 session 为 combined
    const _r = await createSession(env, _sess.player_id, _adminId);
    if (_m) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(_m[1]).run();
    const _cookie = `lc_session=${_r.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8*3600}`;
    const _admin = await env.DB.prepare('SELECT id, username, role FROM admins WHERE id = ?').bind(_adminId).first();
    return new Response(JSON.stringify({
      ok: true, combined: true,
      admin: _admin,
      player_id: _sess.player_id,
    }), {
      status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': _cookie }
    });
  }

  // ============================================================
  // v17.10: super 诊断/修复 passkey jwk (x/y 字节长度)
  // POST /api/init?action=admin-passkey-fix-jwks  (super)
  // ============================================================
  if (_action === 'admin-passkey-reregister') {
    if (!_me || _me.role !== 'super') return err(403, '只有 super 管理员可运行');
    // v17.10.3: 修 COSE_Key 偏移 [10, 42) 和 [45, 77) — 之前 [11, 43) / [46, 78) off-by-one
    // 还支持 force=1: 重新切所有 jwk (处理被旧版错位覆盖的 passkey)
    const _body = await request.json().catch(() => ({}));
    const _force = !!_body.force;
    const rows = await env.DB.prepare('SELECT id, public_key_jwk FROM passkeys').all();
    const out = [];
    for (const r of (rows.results || [])) {
      let jwk = {}; try { jwk = JSON.parse(r.public_key_jwk); } catch (e) {}
      try {
        const xFull = Uint8Array.from(atob((jwk.x || '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const yFull = Uint8Array.from(atob((jwk.y || '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        if (xFull.length === 77 && yFull.length === 77) {
          // v17.10.3: 修正 COSE_Key EC2 偏移
          // offset 0: a5 (map 5)
          // offset 1-9: kty(01 02) + alg(03 26 20) + crv(20 01) + x key(21) + x header(58 20)
          // offset 10-41: x 坐标 (32 字节)
          // offset 42-44: y key(22) + y header(58 20)
          // offset 45-76: y 坐标 (32 字节)
          const xBytes = xFull.slice(10, 42);
          const yBytes = yFull.slice(45, 77);
          const toB64 = (b) => {
            let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
            return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          };
          const newJwk = { kty: 'EC', crv: 'P-256', alg: 'ES256', ext: false, x: toB64(xBytes), y: toB64(yBytes) };
          await env.DB.prepare('UPDATE passkeys SET public_key_jwk = ? WHERE id = ?')
            .bind(JSON.stringify(newJwk), r.id).run();
          out.push({ id: r.id, fixed: true, new_x: newJwk.x.substring(0, 12) + '...', new_y: newJwk.y.substring(0, 12) + '...' });
        } else if (_force) {
          out.push({ id: r.id, fixed: false, reason: 'force 模式: x/y 不是 77 字节, 无法重建 (id=' + r.id + ', xLen=' + xFull.length + ', yLen=' + yFull.length + ')', irreversible: true });
        } else {
          out.push({ id: r.id, fixed: false, reason: 'xFull=' + xFull.length + ' yFull=' + yFull.length });
        }
      } catch (e) {
        out.push({ id: r.id, fixed: false, reason: e.message });
      }
    }
    return ok({ total: out.length, list: out });
  }

  if (_action === 'admin-passkey-debug') {
    if (!_me || _me.role !== 'super') return err(403, '只有 super 管理员可运行');
    const rows = await env.DB.prepare('SELECT id, credential_id, public_key_jwk FROM passkeys ORDER BY id').all();
    return ok({ passkeys: (rows.results || []).map(r => {
      let jwk = {}; try { jwk = JSON.parse(r.public_key_jwk); } catch (e) {}
      return {
        id: r.id,
        cred: r.credential_id,
        jwk_raw_len: r.public_key_jwk.length,
        jwk_kty: jwk.kty,
        jwk_crv: jwk.crv,
        jwk_alg: jwk.alg,
        x: jwk.x,
        y: jwk.y,
        x_len: (jwk.x || '').length,
        y_len: (jwk.y || '').length,
      };
    })});
  }

  if (_action === 'admin-passkey-fix-jwks') {
    if (!_me || _me.role !== 'super') return err(403, '只有 super 管理员可运行');
    const rows = await env.DB.prepare('SELECT id, credential_id, public_key_jwk FROM passkeys').all();
    const _b64len = (s) => { try {
      return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).length;
    } catch (_) { return -1; }};
    const _pad = (s) => {
      try {
        const bin = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        if (bin.length === 32) return s;
        const out = new Uint8Array(32);
        out.set(bin, 32 - bin.length);
        let bin2 = '';
        for (let i = 0; i < out.length; i++) bin2 += String.fromCharCode(out[i]);
        return btoa(bin2).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      } catch (_) { return s; }
    };
    const list = [];
    for (const r of (rows.results || [])) {
      let jwk = {};
      try { jwk = JSON.parse(r.public_key_jwk); } catch (e) {}
      const xl = _b64len(jwk.x);
      const yl = _b64len(jwk.y);
      const needs = (xl !== 32) || (yl !== 32);
      const out = { id: r.id, cred: r.credential_id, x_len: xl, y_len: yl, needs_fix: needs };
      if (needs) {
        const newJwk = { ...jwk, x: _pad(jwk.x), y: _pad(jwk.y) };
        await env.DB.prepare('UPDATE passkeys SET public_key_jwk = ? WHERE id = ?')
          .bind(JSON.stringify(newJwk), r.id).run();
        out.fixed = true;
        out.new_x_len = _b64len(newJwk.x);
        out.new_y_len = _b64len(newJwk.y);
      }
      list.push(out);
    }
    return ok({ total: list.length, fixed: list.filter(x => x.fixed).length, list });
  }

  // ============================================================
  // v17.9: admin-only logout - 只清 admin 身份,保留 player 身份
  // POST /api/init?action=admin-logout
  // ============================================================
  if (_action === 'admin-logout') {
    try {
      if (!_sess || !_sess.admin_id) return err(401, '没有管理员身份');
      if (new Date(_sess.expires_at) <= new Date()) return err(401, '会话已过期');
      // 创建一个只保留 player_id 的新 session
      let _newToken = null;
      if (_sess.player_id) {
        const _r = await createSession(env, _sess.player_id, null);
        _newToken = _r.token;
      }
      // 销毁旧的 combined session
      if (_m) {
        await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(_m[1]).run();
      }
      const _cookie = _newToken
        ? `lc_session=${_newToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8*3600}`
        : `lc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
      return new Response(JSON.stringify({ ok: true, kept_player: !!_sess.player_id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': _cookie }
      });
    } catch (e) {
      return err(500, 'admin-logout err: ' + (e?.message || String(e)) + ' | sess=' + JSON.stringify(_sess));
    }
  }

  // ============================================================
  // v19: 每日签到 — GET 查状态, POST 签到领绿宝石
  // GET  /api/init?action=signin-status       (player 登录)
  // POST /api/init?action=signin              (player 登录, 同日只发一次)
  // ============================================================
  if (_action === 'signin-status' || _action === 'signin') {
    if (!_sess || !_sess.player_id) return err(401, '需要玩家登录');
    if (new Date(_sess.expires_at) <= new Date()) return err(401, '会话已过期');
    // 取玩家 + 绿宝石余额
    const _p = await env.DB.prepare('SELECT id, username, emeralds FROM players WHERE id = ?')
      .bind(_sess.player_id).first();
    if (!_p) return err(404, '玩家不存在');
    // 今日日期 (本地时间 → UTC+8 简化: 用 server now 转 Asia/Shanghai 字符串)
    const _today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()); // YYYY-MM-DD
    // 查今日是否已签
    const _todayRow = await env.DB.prepare(
      'SELECT id, streak, emeralds_earned FROM daily_signin WHERE player_id = ? AND signin_date = ?'
    ).bind(_p.id, _today).first();
    // 查最近 7 天签到记录
    const _recent = await env.DB.prepare(
      'SELECT signin_date, streak, emeralds_earned FROM daily_signin WHERE player_id = ? ORDER BY signin_date DESC LIMIT 7'
    ).bind(_p.id).all();
    // 总签到天数
    const _totalRow = await env.DB.prepare(
      'SELECT COUNT(*) AS c, COALESCE(MAX(streak), 0) AS max_streak FROM daily_signin WHERE player_id = ?'
    ).bind(_p.id).first();
    // 算当前连续 (从最近一次签到往前数, 中间没断的就是 streak)
    let _curStreak = 0;
    if (_recent.results.length) {
      _curStreak = _recent.results[0].streak;
      // 校验: 如果最近一次不是今天也不是昨天, 当前连续归零
      const _yest = new Date(new Date(_today).getTime() - 86400000).toISOString().slice(0, 10);
      if (_recent.results[0].signin_date !== _today && _recent.results[0].signin_date !== _yest) {
        _curStreak = 0;
      }
    }
    if (_action === 'signin-status') {
      return ok({
        signed_today: !!_todayRow,
        today_streak: _todayRow ? _todayRow.streak : 0,
        today_emeralds: _todayRow ? _todayRow.emeralds_earned : 0,
        current_streak: _curStreak,
        max_streak: _totalRow ? _totalRow.max_streak : 0,
        total_days: _totalRow ? _totalRow.c : 0,
        emeralds: _p.emeralds || 0,
        recent: _recent.results,
        today: _today,
      });
    }
    // POST signin
    if (_todayRow) {
      return err(409, '今天已经签到过了, 明天再来', {
        signed_today: true,
        today_streak: _todayRow.streak,
        today_emeralds: _todayRow.emeralds_earned,
        emeralds: _p.emeralds || 0,
      });
    }
    // 算本次连续天数 (看昨天是否签到)
    const _yest2 = new Date(new Date(_today).getTime() - 86400000).toISOString().slice(0, 10);
    const _yestRow = await env.DB.prepare(
      'SELECT id, streak FROM daily_signin WHERE player_id = ? AND signin_date = ?'
    ).bind(_p.id, _yest2).first();
    const _newStreak = _yestRow ? (_yestRow.streak + 1) : 1;
    // v19 奖励: 7 天一个循环, 第 1 天 1 绿宝, 第 7 天 7 绿宝, 第 8 天回到 1
    const _dayInCycle = ((_newStreak - 1) % 7) + 1; // 1..7 循环
    const _reward = _dayInCycle;
    // 写库
    try {
      await env.DB.prepare(
        'INSERT INTO daily_signin (player_id, signin_date, streak, emeralds_earned) VALUES (?, ?, ?, ?)'
      ).bind(_p.id, _today, _newStreak, _reward).run();
    } catch (e) {
      // UNIQUE 冲突 = 同一玩家同日重复签到 (race condition)
      return err(409, '今天已经签到过了, 明天再来');
    }
    const _newEmeralds = (_p.emeralds || 0) + _reward;
    await env.DB.prepare('UPDATE players SET emeralds = ? WHERE id = ?')
      .bind(_newEmeralds, _p.id).run();
    return ok({
      signed_today: true,
      today_streak: _newStreak,
      today_emeralds: _reward,
      day_in_cycle: _dayInCycle,
      current_streak: _newStreak,
      emeralds: _newEmeralds,
      message: '签到成功! +' + _reward + ' 💎 (本周第 ' + _dayInCycle + ' / 7 天)',
    });
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
