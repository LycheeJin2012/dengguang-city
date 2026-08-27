// v45 重写 (Stage 5 后端第一批): init.js 拆 7 个 action group, 不再有大 LEGACY 段
//
// 完整结构 (已拆 7 个 group):
//   - GET 5 个公开端点 (unread-summary, homepage-bundle, signin-status 等)
//   - POST 委托给 /functions/api/actions/<group>.js
//     signin:              signin | signin-status
//     account:             6 个账号/密码/合并 actions
//     announcements:       3 个公告 actions
//     admin-player:        2 个 super 玩家管理 actions
//     passkey:            10 个 WebAuthn actions (v45 新拆)
//     admin-dm:            6 个 super 私信监管 actions (v45 新拆)
//     admin-passkey-debug: 3 个 super passkey 调试 actions (v45 新拆)
//
// 未来 Stage 5 还可拆: 顶层 functions/api/admin/* 16 个 + 其他公共 endpoint
import { ok, err } from '../_shared.js';

import * as signinActions from './actions/signin.js';
import * as accountActions from './actions/account.js';
import * as announcementsActions from './actions/announcements.js';
import * as adminPlayerActions from './actions/admin-player.js';
import * as passkeyActions from './actions/passkey.js';
import * as adminDmActions from './actions/admin-dm.js';
import * as adminPasskeyDebugActions from './actions/admin-passkey-debug.js';

// ===================== GET: 公开 5 个端点 (轻) =====================
export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // v45 修: signin-status 走 GET (前端用 GET 拉签到状态)
  // 之前落到默认 handler 返 tables 列表, 4 年没发现
  if (action === 'signin-status') {
    return signinActions.onRequestGet(context);
  }

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

  // 委托给 actions/ (v45 已拆 7 个 group)
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
  if (action.startsWith('passkey-') && !action.startsWith('passkey-admin-enter-')) {
    return passkeyActions.onRequestPost(context);
  }
  if (action.startsWith('admin-dm-')) {
    return adminDmActions.onRequestPost(context);
  }
  if (action === 'admin-passkey-reregister' || action === 'admin-passkey-debug' || action === 'admin-passkey-fix-jwks') {
    return adminPasskeyDebugActions.onRequestPost(context);
  }

  // 未知 action 兜底
  return err(404, '未知 action: ' + action);
}

