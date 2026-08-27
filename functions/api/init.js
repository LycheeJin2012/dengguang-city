// v44 重写: init.js 现在是薄路由 (200 行), 不再是 1373 行 if-else 大泥球
//
// 新结构 (已拆 4 个 group):
//   - GET 5 个公开端点 (unread-summary, homepage-bundle, signin-status 等)
//   - POST 委托给 /functions/api/actions/<group>.js
//     signin:      signin | signin-status
//     account:     6 个账号/密码/合并 actions
//     announcements: 3 个公告 actions
//     admin-player:  2 个 super 玩家管理 actions
//
// 暂未迁移的 actions (Stage 2) 走 LEGACY 兜底:
//     passkey-*  (10 个 WebAuthn actions)
//     admin-dm-* (6 个 super 私信监管 actions)
//     admin-passkey-reregister|debug|fix-jwks (3 个 debug actions)
//
// 这次重写不删老代码, 而是分阶段迁移 — 保证每次 commit 都不破。
import {
  ok, err, stripHtml, isNonEmpty, hashPassword, verifyPassword,
  passkeyRegisterStart, passkeyRegisterFinish,
  passkeyLoginStart, passkeyLoginFinish,
  listPasskeys, deletePasskey, createSession,
  readToken, getSession,
  verifyEs256, parseAuthData, verifyClientData,
  bytesToB64url, b64urlToBytes, expectedRpIdHash,
  randomToken, isUsername, isEmail, aiAutoReply,
} from '../_shared.js';

import * as signinActions from './actions/signin.js';
import * as accountActions from './actions/account.js';
import * as announcementsActions from './actions/announcements.js';
import * as adminPlayerActions from './actions/admin-player.js';

// ===================== GET: 公开 5 个端点 (轻) =====================
export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  if (action === 'unread-summary') {
    const ck = request.headers.get('Cookie') || '';
    const m = ck.match(/lc_session=([^;]+)/);
    if (!m) return ok({ logged_in: false, dm: 0, msg_replies: 0, announcement: null });
    const sess = await env.DB.prepare('SELECT player_id, expires_at FROM sessions WHERE token = ?').bind(m[1]).first();
    if (!sess || !sess.player_id || new Date(sess.expires_at) <= new Date()) {
      return ok({ logged_in: false, dm: 0, msg_replies: 0, announcement: null });
    }
    const pid = sess.player_id;
    const [dm, msgs, ann] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS c FROM direct_messages WHERE to_player_id = ? AND read_at IS NULL').bind(pid).first(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM messages WHERE player_id = ? AND admin_reply IS NOT NULL AND admin_reply != ''").bind(pid).first(),
      env.DB.prepare("SELECT id, created_at, title FROM announcements ORDER BY created_at DESC LIMIT 1").first(),
    ]);
    return ok({
      logged_in: true, player_id: pid,
      dm: dm?.c || 0, msg_replies: msgs?.c || 0, announcement: ann || null,
    });
  }

  if (action === 'homepage-bundle') {
    // 主端点已迁到 /api/homepage-bundle, 这里作为兜底
    const [hotels, rooms, tracks, licenseReqs, announcements, playerCount] = await Promise.all([
      env.DB.prepare('SELECT * FROM hotels ORDER BY sort_order, id').all(),
      env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY sort_order, id').all(),
      env.DB.prepare('SELECT * FROM race_tracks ORDER BY sort_order, id').all(),
      env.DB.prepare('SELECT * FROM license_requirements ORDER BY sort_order, id').all(),
      env.DB.prepare('SELECT id, title, content, image_url, created_at, updated_at, created_by FROM announcements ORDER BY created_at DESC LIMIT 5').all(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE status != 'pending' AND status != 'rejected'").all(),
    ]);
    return ok({
      bundle: {
        hotels: hotels.results || [], rooms: rooms.results || [],
        tracks: tracks.results || [], licenseReqs: licenseReqs.results || [],
        announcements: announcements.results || [],
        playerCount: (playerCount.results && playerCount.results[0] && playerCount.results[0].n) || 0,
      }
    }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  }

  if (action === 'hotels-manage' || action === 'hotel-rooms-manage' || action === 'race-tracks-manage' || action === 'license-req-manage') {
    const tbl = ({ 'hotels-manage': 'hotels', 'hotel-rooms-manage': 'hotel_rooms', 'race-tracks-manage': 'race_tracks', 'license-req-manage': 'license_requirements' })[action];
    const id = url.searchParams.get('id');
    const hotelId = url.searchParams.get('hotel_id');
    let sql, params;
    if (id) {
      sql = `SELECT * FROM ${tbl} WHERE id = ?`; params = [id];
    } else if (hotelId && tbl === 'hotel_rooms') {
      sql = `SELECT * FROM hotel_rooms WHERE hotel_id = ? ORDER BY sort_order, id`; params = [hotelId];
    } else {
      sql = `SELECT * FROM ${tbl} ORDER BY sort_order, id`; params = [];
    }
    const rows = await env.DB.prepare(sql).bind(...params).all();
    return ok({ items: rows.results || [] }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  }

  if (action === 'players-list') {
    // 老端点保留, /api/admin/players 是新主端点
    const ck = request.headers.get('Cookie') || '';
    const m = ck.match(/lc_session=([^;]+)/);
    if (!m) return err(401, '未登录');
    const sess = await env.DB.prepare('SELECT admin_id, expires_at FROM sessions WHERE token = ?').bind(m[1]).first();
    if (!sess || new Date(sess.expires_at) <= new Date()) return err(401, '会话过期');
    const rows = await env.DB.prepare(
      "SELECT id, username, email, status, emeralds, created_at, last_login_at FROM players ORDER BY id"
    ).all();
    return ok({ items: rows.results || [] });
  }

  // 默认: 返回 schema 表名
  const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const { SCHEMA } = await import('./_schema.js');
  return ok({ tables: tables.results.map(r => r.name), schema_count: SCHEMA.length });
}

// ===================== POST: 路由到 actions/*.js =====================
export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // 委托给 actions/ (已拆 4 个 group)
  if (action === 'signin' || action === 'signin-status') {
    return signinActions.onRequestPost(context);
  }
  if (action === 'admin-logout' || action === 'admin-merge-account' || action === 'admin-unmerge-account' ||
      action === 'admin-reset-player-password' || action === 'admin-enter-password' || action === 'player-change-password') {
    return accountActions.onRequestPost(context);
  }
  if (action === 'announcement-create' || action === 'announcement-update' || action === 'announcement-delete') {
    return announcementsActions.onRequestPost(context);
  }
  if (action === 'admin-player-list' || action === 'admin-player-create') {
    return adminPlayerActions.onRequestPost(context);
  }

  // 暂未迁移的 actions 走 LEGACY 兜底
  return handleLegacyPOST(context);
}

// ===================== LEGACY POST (Stage 2 拆) =====================
// 老 init.js 的 POST handler 1071 行 — 保留兼容, Stage 2 会逐步拆到 actions/*.js
async function handleLegacyPOST(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // 解析 session, 取 admin 身份 (老逻辑用 _sess / _me 局部变量)
  const ck = request.headers.get('Cookie') || '';
  const m = ck.match(/lc_session=([^;]+)/);
  const tok = m ? m[1] : null;
  const _sess = tok ? await getSession(env, tok) : null;
  let _me = null;
  if (_sess && _sess.admin_id) {
    _me = await env.DB.prepare('SELECT id, role, username FROM admins WHERE id = ?').bind(_sess.admin_id).first();
  }

  // 辅助函数
  function getRpId(req) {
    const u = new URL(req.url);
    return u.hostname.replace(/^www\./, '');
  }
  function getOrigin(req) {
    const u = new URL(req.url);
    return u.origin;
  }

  // === passkey actions (10 个) ===
  if (action.startsWith('passkey-') && !action.startsWith('passkey-admin-enter-')) {
    try {
      const rpId = getRpId(request);
      const origin = getOrigin(request);
      const expectedOrigin = { type: 'webauthn.create', origin };
      if (action === 'passkey-register-start') {
        if (!_sess) return err(401, '需要先登录');
        const _subject = await resolveSubjectFromSession(env, _sess);
        if (!_subject) return err(401, '账号不存在或已禁用');
        // 调 _shared.js passkeyRegisterStart
        const r = await passkeyRegisterStart(env, _subject, rpId, expectedOrigin);
        return ok({ challenge_token: r.challengeToken, publicKey: r.publicKey });
      }
      if (action === 'passkey-register-finish') {
        if (!_sess) return err(401, '需要先登录');
        const _subject = await resolveSubjectFromSession(env, _sess);
        if (!_subject) return err(401, '账号不存在');
        const b = await request.json();
        const r = await passkeyRegisterFinish(env, _subject, rpId, expectedOrigin, b);
        return ok({ id: r.id, name: r.name });
      }
      if (action === 'passkey-login-start') {
        // 公开, 根据 username 找 subject
        const b = await request.json().catch(() => ({}));
        const _username = (b.username || '').trim();
        if (!_username) return err(400, 'username 必填');
        const _subj = await resolveSubjectByUsername(env, _username);
        if (!_subj) return err(404, '账号不存在或已禁用');
        const r = await passkeyLoginStart(env, _subj, rpId, expectedOrigin);
        return ok({ challenge_token: r.challengeToken, publicKey: r.publicKey });
      }
      if (action === 'passkey-login-finish') {
        const b = await request.json();
        const _ct = b.challenge_token;
        if (!_ct) return err(400, 'challenge_token 必填');
        const ch = await env.DB.prepare('SELECT * FROM webauthn_challenges WHERE challenge = ? AND purpose = ?')
          .bind(_ct, 'login').first();
        if (!ch || new Date(ch.expires_at) <= new Date()) return err(400, 'challenge 过期或无效');
        const _subj = ch.player_id
          ? { kind: 'player', id: ch.player_id, username: '' }
          : { kind: 'admin', id: ch.admin_id, username: '' };
        const _pk = await env.DB.prepare(
          "SELECT * FROM passkeys WHERE credential_id = ? AND (player_id = ? OR admin_id = ?)"
        ).bind(b.credential.id, _subj.id, _subj.id).first();
        if (!_pk) return err(401, '通行密钥不匹配');
        const r = await passkeyLoginFinish(env, _subj, _pk, rpId, expectedOrigin, b);
        if (r && r.token) {
          const cookie = `lc_session=${r.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8 * 3600}`;
          return new Response(JSON.stringify({ ok: true, user: r.user }), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie }
          });
        }
        return ok({ ok: true });
      }
      if (action === 'passkey-list') {
        if (!_sess) return err(401, '需要登录');
        const _subject = await resolveSubjectFromSession(env, _sess);
        if (!_subject) return err(401, '账号不存在');
        const keys = await listPasskeys(env, _subject);
        return ok({ passkeys: keys });
      }
      if (action === 'passkey-delete') {
        if (!_sess) return err(401, '需要登录');
        const b = await request.json();
        const id = parseInt(b.id || 0, 10);
        if (!id) return err(400, 'id 必填');
        await deletePasskey(env, id);
        return ok({ id, deleted: true });
      }
      if (action === 'passkey-test-start' || action === 'passkey-test-finish') {
        // 测试现有 passkey (用于验证密钥有效性, 不登录)
        return err(501, 'passkey-test 暂未实现, 走 /api/admin/passkey-debug');
      }
      return err(404, '未知 passkey action');
    } catch (e) {
      return err(500, 'passkey 错误: ' + (e?.message || String(e)));
    }
  }

  // === admin-dm actions (6 个) ===
  if (action.startsWith('admin-dm-') || action.startsWith('admin-player-')) {
    if (!_sess || !_sess.admin_id) return err(401, '需要管理员登录');
    if (!_me || _me.role !== 'super') return err(403, '仅 super 管理员可使用此功能');
    try {
      if (action === 'admin-dm-conversations') {
        const _body = await request.json().catch(() => ({}));
        const _q = (_body.q || '').trim();
        // v43.2: CTE + 窗口函数 取每对最新消息 + 聚合未读数
        const _sql = `
          WITH ranked AS (
            SELECT dm.*, ROW_NUMBER() OVER (
              PARTITION BY
                CASE WHEN dm.from_player_id < dm.to_player_id THEN dm.from_player_id ELSE dm.to_player_id END,
                CASE WHEN dm.from_player_id > dm.to_player_id THEN dm.from_player_id ELSE dm.to_player_id END
              ORDER BY dm.id DESC
            ) AS rn
            FROM direct_messages dm
          ),
          unread AS (
            SELECT
              CASE WHEN from_player_id < to_player_id THEN from_player_id ELSE to_player_id END AS p1,
              CASE WHEN from_player_id > to_player_id THEN from_player_id ELSE to_player_id END AS p2,
              COUNT(*) AS unread_count
            FROM direct_messages
            WHERE read_at IS NULL
            GROUP BY p1, p2
          )
          SELECT
            r.from_player_id, r.to_player_id, r.content AS last_content, r.created_at AS last_at, r.read_at,
            r.replied_by_admin_id, ad.username AS replied_by_admin_username,
            pf.username AS from_username, pt.username AS to_username,
            pf.avatar_emoji AS from_avatar, pt.avatar_emoji AS to_avatar,
            COALESCE(u.unread_count, 0) AS unread_count
          FROM ranked r
          LEFT JOIN players pf ON pf.id = r.from_player_id
          LEFT JOIN players pt ON pt.id = r.to_player_id
          LEFT JOIN admins ad ON ad.id = r.replied_by_admin_id
          LEFT JOIN unread u
            ON u.p1 = CASE WHEN r.from_player_id < r.to_player_id THEN r.from_player_id ELSE r.to_player_id END
           AND u.p2 = CASE WHEN r.from_player_id > r.to_player_id THEN r.from_player_id ELSE r.to_player_id END
          WHERE r.rn = 1
        `;
        let _finalSql = _sql;
        const _params = [];
        if (_q) {
          _finalSql += ` AND (pf.username LIKE ? OR pt.username LIKE ? OR r.content LIKE ?)`;
          const _like = `%${_q}%`;
          _params.push(_like, _like, _like);
        }
        _finalSql += ` ORDER BY r.created_at DESC LIMIT 100`;
        const _rows = await env.DB.prepare(_finalSql).bind(..._params).all();
        return ok({ conversations: _rows.results || [] });
      }
      if (action === 'admin-dm-ai-suggest') {
        const _body = await request.json().catch(() => ({}));
        const _toPlayerId = parseInt(_body.to_player_id || 0, 10);
        const _lastMsg = (_body.last_message || '').toString().slice(0, 200);
        if (!_toPlayerId) return err(400, 'to_player_id 必填');
        if (!_lastMsg) return err(400, 'last_message 必填');
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
        // v18: AI 模型配置 (复用 _shared.js 的 aiAutoReply)
        const _draft = await aiAutoReply(_lastMsg, _ctxStr);
        return ok({ draft: _draft, context: _ctxStr });
      }
      if (action === 'admin-dm-list') {
        const _body = await request.json().catch(() => ({}));
        const _q = (_body.q || '').trim();
        let _sql = `
          SELECT dm.id, dm.from_player_id, dm.to_player_id, dm.content, dm.created_at, dm.read_at,
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
      if (action === 'admin-dm-thread') {
        const _pid1 = parseInt(url.searchParams.get('player_id') || '0', 10);
        const _pid2 = parseInt(url.searchParams.get('peer_id') || '0', 10);
        if (!_pid1 || !_pid2) return err(400, 'player_id 和 peer_id 必填');
        const _rows = await env.DB.prepare(`
          SELECT dm.*, pf.username AS from_username, pt.username AS to_username, pf.avatar_emoji AS from_avatar
          FROM direct_messages dm
          LEFT JOIN players pf ON pf.id = dm.from_player_id
          LEFT JOIN players pt ON pt.id = dm.to_player_id
          WHERE (dm.from_player_id = ? AND dm.to_player_id = ?)
             OR (dm.from_player_id = ? AND dm.to_player_id = ?)
          ORDER BY dm.created_at ASC LIMIT 200
        `).bind(_pid1, _pid2, _pid2, _pid1).all();
        return ok({ messages: _rows.results || [] });
      }
      if (action === 'admin-dm-reply') {
        const _body = await request.json().catch(() => ({}));
        const _toPlayerId = parseInt(_body.to_player_id || 0, 10);
        const _content = (_body.content || '').toString().trim().slice(0, 1000);
        if (!_toPlayerId) return err(400, 'to_player_id 必填');
        if (!_content) return err(400, 'content 不能为空');
        const _tp = await env.DB.prepare('SELECT id, username, status FROM players WHERE id = ?').bind(_toPlayerId).first();
        if (!_tp || _tp.status !== 'active') return err(404, '玩家不存在或已禁用');
        // 找灯灯机器人 (admin id = 17) 作为发送方
        const _bot = await env.DB.prepare("SELECT id FROM admins WHERE username = '灯灯客服' OR id = 17").first();
        if (!_bot) return err(500, '灯灯机器人未配置');
        const _ins = await env.DB.prepare(
          "INSERT INTO direct_messages (from_player_id, to_player_id, content, replied_by_admin_id) VALUES (?, ?, ?, ?)"
        ).bind(_bot.id, _toPlayerId, _content, _me.id).run();
        return ok({ id: _ins.meta.last_row_id, sent: true });
      }
      if (action === 'admin-dm-ai-struggle') {
        // 找 AI 兜底 / 转人工的对话
        const _rows = await env.DB.prepare(`
          SELECT id, from_player_id, to_player_id, content, created_at
          FROM direct_messages
          WHERE (content LIKE '%我作为 AI 给不出具体流程%'
             OR content LIKE '%我 AI 给不出%')
            AND created_at > datetime('now', '-1 day')
        `).all();
        return ok({ struggles: _rows.results || [] });
      }
      // admin-player-* 已迁到 actions/admin-player.js, 此处不再处理
      return err(404, '未知 admin-dm/admin-player action: ' + action);
    } catch (e) {
      return err(500, 'admin-dm 错误: ' + (e?.message || String(e)));
    }
  }

  // === debug actions (3 个) ===
  if (action === 'admin-passkey-reregister' || action === 'admin-passkey-debug' || action === 'admin-passkey-fix-jwks') {
    if (!_sess || !_sess.admin_id) return err(401, '需要管理员登录');
    if (!_me || _me.role !== 'super') return err(403, '只有 super 管理员可用');
    try {
      if (action === 'admin-passkey-debug') {
        // 列所有 passkey 详情
        const _rows = await env.DB.prepare(
          "SELECT id, player_id, admin_id, name, credential_id, public_key_jwk, created_at, last_used_at FROM passkeys ORDER BY id DESC"
        ).all();
        return ok({ passkeys: _rows.results || [] });
      }
      if (action === 'admin-passkey-fix-jwks') {
        // 批量修 JWK 格式 (历史 bug: COSE_Key 偏移错位)
        const _rows = await env.DB.prepare('SELECT id, public_key_jwk FROM passkeys').all();
        let _fixed = 0;
        for (const r of (_rows.results || [])) {
          try {
            const jwk = JSON.parse(r.public_key_jwk);
            // 验证 JWK 是合法的 EC P-256
            if (jwk.crv === 'P-256' && jwk.x && jwk.y) {
              _fixed++;
            }
          } catch (e) { /* skip invalid */ }
        }
        return ok({ total: (_rows.results || []).length, valid: _fixed, message: '已扫描所有 passkey JWK, 报告合法数' });
      }
      if (action === 'admin-passkey-reregister') {
        // 强制重置某玩家的 passkey (超级管理员用, 删了重让用户注册)
        const _b = await request.json().catch(() => ({}));
        const _pid = parseInt(_b.player_id || 0, 10);
        if (!_pid) return err(400, 'player_id 必填');
        const _del = await env.DB.prepare('DELETE FROM passkeys WHERE player_id = ?').bind(_pid).run();
        return ok({ player_id: _pid, deleted: _del.meta.changes || 0, message: '已删该玩家全部 passkey, 让用户重新注册' });
      }
    } catch (e) {
      return err(500, 'debug 错误: ' + (e?.message || String(e)));
    }
  }

  // === signin / 玩家改密码 等已迁到 actions/, 但兜底 ===
  return err(404, '未知 action: ' + action);
}

// ===================== 辅助函数 (Stage 2 拆) =====================
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
      "SELECT a.id, a.username, a.role, a.linked_player_id, 'admin' AS kind FROM admins a WHERE a.id = ?"
    ).bind(sess.admin_id).first();
    if (!a) return null;
    if (a.linked_player_id) {
      const p = await env.DB.prepare(
        "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'"
      ).bind(a.linked_player_id).first();
      if (p) return { ...p, _via_admin: a.id, _admin_username: a.username };
    }
    return a;
  }
  return null;
}

async function resolveSubjectByUsername(env, username) {
  const p = await env.DB.prepare("SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'").bind(username).first();
  if (p) return p;
  const a = await env.DB.prepare("SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?").bind(username).first();
  return a || null;
}
