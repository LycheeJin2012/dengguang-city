// v50: 首页一次性拉所有公开数据 (hotels / rooms / tracks / licenseReqs / announcements / player count)
import { ok, err, handleOptions } from '../_shared.js';

const DEFAULT_TRACKS = [
  { name: '🌐 国际赛车场·主赛道', length_km: 5.2, laps: 12, difficulty: '高级',
    description: '5.2km 12 圈, 含 4 个发夹弯 + 1 个长直道 + 2 个高速弯。需 A 级以上驾照。',
    image_url: 'assets/backgrounds/bg-pixel-circuit.jpg', trial_price: 50, sort_order: 1 },
  { name: '🌐 国际赛车场·短赛道', length_km: 2.8, laps: 8, difficulty: '中级',
    description: '2.8km 8 圈, 适合热身与新驾照练车。需 B 级驾照。',
    image_url: '', trial_price: 20, sort_order: 2 },
];

async function seedDefaultTracks(env) {
  for (const t of DEFAULT_TRACKS) {
    const exist = await env.DB.prepare('SELECT id FROM race_tracks WHERE name = ?').bind(t.name).first();
    if (exist) continue;
    await env.DB.prepare(
      'INSERT INTO race_tracks (name, length_km, laps, difficulty, description, image_url, trial_price, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
    ).bind(t.name, t.length_km, t.laps, t.difficulty, t.description, t.image_url || null, t.trial_price, t.sort_order).run();
  }
}

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  await seedDefaultTracks(env);

  const [_hotels, _rooms, _tracks, _licenseReqs, _announcements, _playerCount] = await Promise.all([
    env.DB.prepare('SELECT * FROM hotels ORDER BY sort_order, id').all(),
    env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY sort_order, id').all(),
    env.DB.prepare('SELECT * FROM race_tracks WHERE is_active = 1 ORDER BY sort_order, id').all(),
    env.DB.prepare('SELECT * FROM license_requirements ORDER BY sort_order, id').all(),
    env.DB.prepare('SELECT id, title, content, image_url, is_pinned, created_at FROM announcements ORDER BY is_pinned DESC, created_at DESC LIMIT 5').all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE status = 'active'").first(),
  ]);

  return ok({
    bundle: {
      hotels: _hotels.results || [],
      rooms: _rooms.results || [],
      tracks: _tracks.results || [],
      licenseReqs: _licenseReqs.results || [],
      announcements: _announcements.results || [],
      playerCount: _playerCount?.n || 0,
    }
  }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}
