// GET /api/homepage-bundle — 公开首页一次性拉 5 表 + player count
// 拆自 functions/api/init.js (v40.2)
// v42: 自动 seed 2 条默认 track (国际赛车场 + 备用), 保证前端 select 有选项
import { ok, err } from '../_shared.js';

// v42: 默认赛道 seed (首次访问时插入, 已存在则跳过)
const DEFAULT_TRACKS = [
  { name: '🌐 国际赛车场·主赛道', length_km: 5.2, laps: 12, difficulty: '高级',
    description: '5.2km 12 圈, 含 4 个发夹弯 + 1 个长直道 + 2 个高速弯。需 A 级以上驾照。',
    image_url: 'assets/backgrounds/bg-pixel-circuit.jpg', trial_price: 50, sort_order: 1 },
  { name: '🌐 国际赛车场·短赛道', length_km: 2.8, laps: 8, difficulty: '中级',
    description: '2.8km 8 圈, 适合热身与新驾照练车。需 B 级驾照。',
    image_url: '', trial_price: 20, sort_order: 2 },
];

async function seedDefaultTracks(env) {
  // v42: 按 name 查重, 缺哪个补哪个 (不会重复插)
  for (const t of DEFAULT_TRACKS) {
    const exist = await env.DB.prepare('SELECT id FROM race_tracks WHERE name = ?').bind(t.name).first();
    if (exist) continue;
    await env.DB.prepare(
      'INSERT INTO race_tracks (name, length_km, laps, difficulty, description, image_url, trial_price, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
    ).bind(t.name, t.length_km, t.laps, t.difficulty, t.description, t.image_url || null, t.trial_price, t.sort_order).run();
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  // 先 seed 再查 (idempotent)
  await seedDefaultTracks(env);

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
