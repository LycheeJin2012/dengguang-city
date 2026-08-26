// v27: 酒店管理独立端点 (替换 manage-data.js 的 keys=hotels,rooms)
// GET /api/admin/manage-hotel → {ok:true, hotels:[...], rooms:[...]}
import { err } from '../../_shared.js';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err('D1 not configured', 500);
  try {
    const h = await env.DB.prepare('SELECT * FROM hotels ORDER BY sort_order, id').all();
    const r = await env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY hotel_id, sort_order, id').all();
    return new Response(JSON.stringify({
      ok: true,
      hotels: h.results || [],
      rooms: r.results || [],
    }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return err('SQL 失败: ' + (e.message || e), 500);
  }
}
