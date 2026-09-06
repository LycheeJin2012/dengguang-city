// v50-N6 (C1): 玩家排行榜 API
// GET /api/leaderboard?type=messages|bookings|licenses&limit=20
//   type=messages  - 留言数榜 (最活跃市民, 不含匿名)
//   type=bookings  - 酒店预订数榜 (最常出游)
//   type=licenses  - 驾照等级榜 (S 级 + 持有多级驾照的玩家)
//   type=races     - 圈速榜 (转 /api/race-times?track_id=X, 单赛道; 留作 v50.x)
//
// 公开端点 (无需登录), 玩家只能看榜不能改榜
// DB schema 复用 messages/bookings/license_signups/players (零迁移)

import { ok, err } from '../_shared.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  const url = new URL(request.url);
  const type = (url.searchParams.get('type') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || DEFAULT_LIMIT, 10) || DEFAULT_LIMIT, MAX_LIMIT);

  if (type === 'messages') {
    // 留言数榜: JOIN players 拿 username + avatar
    const rows = await env.DB.prepare(`
      SELECT m.player_id, p.username, p.avatar_emoji, COUNT(*) AS message_count
      FROM messages m
      LEFT JOIN players p ON p.id = m.player_id
      WHERE m.player_id IS NOT NULL AND p.status = 'active'
      GROUP BY m.player_id
      ORDER BY message_count DESC, m.player_id ASC
      LIMIT ?
    `).bind(limit).all();
    return ok({
      type: 'messages',
      label: '💬 留言数榜 · 最活跃市民',
      unit: '条',
      entries: (rows.results || []).map((r, i) => ({
        rank: i + 1,
        player_id: r.player_id,
        username: r.username,
        avatar_emoji: r.avatar_emoji || '👤',
        score: r.message_count,
      })),
    });
  }

  if (type === 'bookings') {
    const rows = await env.DB.prepare(`
      SELECT b.player_id, p.username, p.avatar_emoji, COUNT(*) AS booking_count
      FROM bookings b
      LEFT JOIN players p ON p.id = b.player_id
      WHERE b.player_id IS NOT NULL AND p.status = 'active'
      GROUP BY b.player_id
      ORDER BY booking_count DESC, b.player_id ASC
      LIMIT ?
    `).bind(limit).all();
    return ok({
      type: 'bookings',
      label: '🏨 酒店预订数榜 · 最常出游',
      unit: '次',
      entries: (rows.results || []).map((r, i) => ({
        rank: i + 1,
        player_id: r.player_id,
        username: r.username,
        avatar_emoji: r.avatar_emoji || '👤',
        score: r.booking_count,
      })),
    });
  }

  if (type === 'licenses') {
    // 驾照等级榜: 看每个玩家通过的 exam_type (B/A/S), 等级越高越靠前
    // 计算公式: 持有 S 记 3 分, A 记 2 分, B 记 1 分; 同分按 last upgrade_at 排
    let rows;
    try {
      rows = await env.DB.prepare(`
        SELECT ls.player_id, p.username, p.avatar_emoji,
               SUM(CASE WHEN ls.exam_type = 'B' AND ls.result = 'passed' THEN 1 ELSE 0 END) AS has_b,
               SUM(CASE WHEN ls.exam_type = 'A' AND ls.result = 'passed' THEN 1 ELSE 0 END) AS has_a,
               SUM(CASE WHEN ls.exam_type = 'S' AND ls.result = 'passed' THEN 1 ELSE 0 END) AS has_s,
               MAX(ls.result_at) AS latest_at
        FROM license_signups ls
        LEFT JOIN players p ON p.id = ls.player_id
        WHERE ls.player_id IS NOT NULL AND p.status = 'active' AND ls.result = 'passed'
        GROUP BY ls.player_id
        ORDER BY has_s DESC, has_a DESC, has_b DESC, latest_at ASC
        LIMIT ?
      `).bind(limit).all();
    } catch (e) {
      return err(500, 'licenses SQL 失败: ' + e.message);
    }
    return ok({
      type: 'licenses',
      label: '🚗 驾照等级榜 · 老司机',
      unit: '级',
      entries: (rows.results || []).map((r, i) => {
        const grades = [];
        if (r.has_b) grades.push('B');
        if (r.has_a) grades.push('A');
        if (r.has_s) grades.push('S');
        return {
          rank: i + 1,
          player_id: r.player_id,
          username: r.username,
          avatar_emoji: r.avatar_emoji || '👤',
          // 用 S 级 (3) + A 级 (2) + B 级 (1) 算总分
          score: (r.has_s || 0) * 3 + (r.has_a || 0) * 2 + (r.has_b || 0),
          grades: grades.join(' / '),
        };
      }),
    });
  }

  return err(400, 'type 必填 (messages / bookings / licenses)');
}
