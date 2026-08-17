// POST /api/init - 初始化 D1 表 + 默认 super admin
// GET  /api/init - 返回 schema 状态
// POST /api/init?action=ai-test        - admin 测 AI 连通性
// POST /api/init?action=passkey-*     - WebAuthn 通行密钥 (4 个子 action)
import {
  ok, err, hashPassword, readToken, getSession,
  passkeyRegisterStart, passkeyRegisterFinish,
  passkeyLoginStart, passkeyLoginFinish,
  listPasskeys, deletePasskey,
  isUsername, isEmail, aiAutoReply,
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
    const a = await env.DB.prepare(
      "SELECT id, username, role, 'admin' AS kind FROM admins WHERE id = ?"
    ).bind(sess.admin_id).first();
    return a || null;
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
  `ALTER TABLE license_signups ADD COLUMN reviewed_by INTEGER`,
  // v17.5: passkeys 支持 admin (player_id 改为可空 + 加 admin_id)
  `ALTER TABLE passkeys ADD COLUMN admin_id INTEGER`,
  // v17.7: messages 支持"AI 自动回复后被人工覆盖"的历史追溯
  `ALTER TABLE messages ADD COLUMN previous_reply TEXT`
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
  // POST /api/init?action=passkey-register-start    (需玩家 OR 管理员登录) v17.5
  // POST /api/init?action=passkey-register-finish   (需玩家 OR 管理员登录)
  // POST /api/init?action=passkey-login-start       (公开)
  // POST /api/init?action=passkey-login-finish      (公开, 自动识别 player/admin)
  // POST /api/init?action=passkey-list              (需玩家 OR 管理员登录)
  // POST /api/init?action=passkey-delete            (需玩家 OR 管理员登录)
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
        if (!_sess) return err(401, '需要先登录');
        const _subject = await resolveSubjectFromSession(env, _sess);
        if (!_subject) return err(401, '账号不存在或已禁用');
        const _data = await passkeyRegisterStart(env, _subject, rpId);
        return ok(_data);
      }
      if (_action === 'passkey-register-finish') {
        const _tok = readToken(request);
        const _sess = await getSession(env, _tok);
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
        // _data: { player | admin, token, expires_at, kind }
        const cookie = `lc_session=${_data.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`;
        let userObj = {};
        if (_data.kind === 'admin') {
          userObj = { id: _data.admin.id, username: _data.admin.username, role: _data.admin.role };
        } else {
          userObj = { id: _data.player.id, username: _data.player.username };
        }
        return new Response(JSON.stringify({ ok: true, ...userObj, kind: _data.kind, expires_at: _data.expires_at }),
          { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie } });
      }
      if (_action === 'passkey-list') {
        const _tok = readToken(request);
        const _sess = await getSession(env, _tok);
        if (!_sess) return err(401, '需要先登录');
        const _subject = await resolveSubjectFromSession(env, _sess);
        if (!_subject) return err(401, '账号不存在或已禁用');
        const _rows = await listPasskeys(env, _subject);
        return ok({ passkeys: _rows.results || [] });
      }
      if (_action === 'passkey-delete') {
        const _tok = readToken(request);
        const _sess = await getSession(env, _tok);
        if (!_sess) return err(401, '需要先登录');
        const _subject = await resolveSubjectFromSession(env, _sess);
        if (!_subject) return err(401, '账号不存在或已禁用');
        const _body = await request.json().catch(() => ({}));
        const _id = parseInt(_body.id || 0, 10);
        if (!_id) return err(400, 'id 必填');
        await deletePasskey(env, _subject, _id);
        return ok({ deleted: _id });
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
            pf.username AS from_username, pt.username AS to_username,
            pf.avatar_emoji AS from_avatar, pt.avatar_emoji AS to_avatar,
            (SELECT COUNT(*) FROM direct_messages WHERE from_player_id = dm.to_player_id AND to_player_id = dm.from_player_id AND read_at IS NULL) AS unread_count
          FROM direct_messages dm
          LEFT JOIN players pf ON pf.id = dm.from_player_id
          LEFT JOIN players pt ON pt.id = dm.to_player_id
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
