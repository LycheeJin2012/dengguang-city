// v47: 赛道成绩 API
// GET  /api/race-times?track_id=X&grade=B|A|S&limit=20  - 排行榜 (公开)
// GET  /api/race-times?my=1                              - 我的成绩
// POST /api/race-times                                   - 上报成绩 (需玩家登录)
// PATCH /api/race-times?id=X&action=verify              - 管理员确认成绩

import { ok, err, readToken, getSession } from '../_shared.js';

function fmtTime(ms) {
  if (!ms || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const milli = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);

  // 我的成绩
  if (url.searchParams.get('my') === '1') {
    const token = readToken(request);
    const sess = await getSession(env, token);
    if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');
    const rows = await env.DB.prepare(
      `SELECT rt.*, t.name AS track_name
       FROM race_times rt
       LEFT JOIN race_tracks t ON t.id = rt.track_id
       WHERE rt.player_id = ?
       ORDER BY rt.recorded_at DESC LIMIT 50`
    ).bind(sess.player_id).all();
    return ok({ times: (rows.results || []).map(r => ({ ...r, formatted: fmtTime(r.time_ms) })) });
  }

  // 排行榜 (公开, 按 track + 可选 grade 过滤)
  const trackId = parseInt(url.searchParams.get('track_id') || '0', 10);
  const grade = url.searchParams.get('grade') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  if (!trackId) return err(400, 'track_id 必填');

  const where = ['rt.track_id = ?', 'rt.verified = 1'];
  const binds = [trackId];
  if (grade) { where.push('rt.license_grade = ?'); binds.push(grade); }
  const rows = await env.DB.prepare(
    `SELECT rt.id, rt.player_id, rt.time_ms, rt.kart_name, rt.license_grade, rt.recorded_at,
            p.username AS player_username, p.avatar_emoji
     FROM race_times rt
     LEFT JOIN players p ON p.id = rt.player_id
     WHERE ${where.join(' AND ')}
     ORDER BY rt.time_ms ASC
     LIMIT ?`
  ).bind(...binds, limit).all();
  return ok({
    leaderboard: (rows.results || []).map((r, i) => ({
      rank: i + 1,
      ...r,
      formatted: fmtTime(r.time_ms),
    })),
    track_id: trackId,
    grade: grade || null,
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');

  const body = await request.json().catch(() => ({}));
  const trackId = parseInt(body.track_id || 0, 10);
  const timeMs = parseInt(body.time_ms || 0, 10);
  const kartName = (body.kart_name || '').toString().slice(0, 60);
  const grade = (body.license_grade || '').toString().slice(0, 4);

  if (!trackId) return err(400, 'track_id 必填');
  if (!timeMs || timeMs < 1000 || timeMs > 60 * 60 * 1000) return err(400, 'time_ms 必须在 1秒-1小时 之间');

  const tr = await env.DB.prepare('SELECT id, name FROM race_tracks WHERE id = ? AND is_active = 1').bind(trackId).first();
  if (!tr) return err(404, '赛道不存在');

  const r = await env.DB.prepare(
    `INSERT INTO race_times (player_id, track_id, time_ms, kart_name, license_grade)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(sess.player_id, trackId, timeMs, kartName || null, grade || null).run();
  return ok({ id: r.meta?.last_row_id, formatted: fmtTime(timeMs), verified: 0, message: '已记录, 等待管理员确认后进入排行榜' });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  const action = url.searchParams.get('action');
  if (!id || !action) return err(400, 'id/action 必填');

  if (action === 'verify') {
    await env.DB.prepare('UPDATE race_times SET verified = 1 WHERE id = ?').bind(id).run();
    return ok({ id, verified: 1 });
  }
  if (action === 'unverify') {
    await env.DB.prepare('UPDATE race_times SET verified = 0 WHERE id = ?').bind(id).run();
    return ok({ id, verified: 0 });
  }
  return err(400, '未知 action');
}
