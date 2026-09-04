// v50: 赛道圈速 (公开 GET / 玩家 POST)
import { ok, err, handleOptions, getSession, readToken } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const trackId = url.searchParams.get('track_id');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  let rows;
  if (trackId) {
    rows = await env.DB.prepare(
      `SELECT r.id, r.player_id, p.username, p.avatar_emoji, r.time_ms, r.kart_name, r.license_grade, r.recorded_at
       FROM race_times r LEFT JOIN players p ON p.id = r.player_id
       WHERE r.track_id = ? AND r.verified = 1 ORDER BY r.time_ms ASC LIMIT ?`
    ).bind(trackId, limit).all();
  } else {
    rows = await env.DB.prepare(
      `SELECT r.id, r.player_id, p.username, p.avatar_emoji, r.track_id, r.time_ms, r.kart_name, r.license_grade, r.recorded_at
       FROM race_times r LEFT JOIN players p ON p.id = r.player_id
       WHERE r.verified = 1 ORDER BY r.recorded_at DESC LIMIT ?`
    ).bind(limit).all();
  }
  return ok({ times: rows.results || [] });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录玩家账号');
  const body = await request.json().catch(() => ({}));
  const timeMs = parseInt(body.time_ms || '0', 10);
  const trackId = parseInt(body.track_id || '0', 10);
  if (!timeMs || timeMs < 1000 || timeMs > 60 * 60 * 1000) return err(400, 'time_ms 必须在 1s-1h');
  if (!trackId) return err(400, 'track_id 必填');
  const r = await env.DB.prepare(
    'INSERT INTO race_times (player_id, track_id, time_ms, kart_name, license_grade, verified) VALUES (?, ?, ?, ?, ?, 0)'
  ).bind(sess.player_id, trackId, timeMs, body.kart_name || null, body.license_grade || null).run();
  return ok({ id: r.meta?.last_row_id, created: true, verified: false });
}
