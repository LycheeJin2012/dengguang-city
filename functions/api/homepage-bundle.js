// GET /api/homepage-bundle — 公开首页一次性拉 5 表 + player count
// 拆自 functions/api/init.js (v40.2)
// 之前 init.js 1621 行, 每次 GET 跑 56 条 SCHEMA + MIGRATIONS, homepage-bundle 11s
// 独立文件后跳过大 init.js, 6 个 query Promise.all 并发, 期望 < 800ms
import { ok, err } from '../_shared.js';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  const [_hotels, _rooms, _tracks, _licenseReqs, _announcements, _playerCount] = await Promise.all([
    env.DB.prepare('SELECT * FROM hotels ORDER BY sort_order, id').all(),
    env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY sort_order, id').all(),
    env.DB.prepare('SELECT * FROM race_tracks ORDER BY sort_order, id').all(),
    env.DB.prepare('SELECT * FROM license_requirements ORDER BY sort_order, id').all(),
    env.DB.prepare('SELECT id, title, content, image_url, created_at, updated_at, created_by FROM announcements ORDER BY created_at DESC LIMIT 5').all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE status != 'pending' AND status != 'rejected'").all(),
  ]);

  return ok({
    bundle: {
      hotels: _hotels.results || [],
      rooms: _rooms.results || [],
      tracks: _tracks.results || [],
      licenseReqs: _licenseReqs.results || [],
      announcements: _announcements.results || [],
      playerCount: (_playerCount.results && _playerCount.results[0] && _playerCount.results[0].n) || 0,
    }
  }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}
