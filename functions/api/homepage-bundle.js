import {
  endpoint,
  reply,
} from '../_core/request.js';

/**
 * 首页一次要拉的东西太多，前端原本要打四五个接口。
 * 这里并发取完打成一个包，减少首屏往返。
 */
const TABLES = [
  ['hotels', 'hotels'],
  ['rooms', 'hotel_rooms'],
  ['tracks', 'race_tracks'],
  ['licenseReqs', 'license_requirements'],
];

/** GET /api/homepage-bundle —— 首页聚合包（酒店/房型/赛道/驾照要求 + 公告 + 在线人数）。 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const db = c.env.DB;
    const bundle = {};

    await Promise.all(
      TABLES.map(async ([key, table]) => {
        bundle[key] = (
          await db.prepare(`SELECT * FROM ${table} ORDER BY sort_order,id`).all()
        ).results;
      })
    );

    bundle.announcements = (
      await db
        .prepare(
          'SELECT id,title,content,image_url,created_at,updated_at FROM announcements ORDER BY id DESC LIMIT 5'
        )
        .all()
    ).results;

    // 看板人数要排除 AI 机器人，否则灯灯会自己把自己算进去。
    bundle.playerCount = (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM players WHERE status='active' AND COALESCE(game_id,'')!='AI_BOT'"
        )
        .first()
    ).n;

    return reply({ bundle });
  });
