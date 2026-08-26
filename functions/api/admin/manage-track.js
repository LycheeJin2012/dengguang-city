// v27: 赛车场管理独立端点 (替换 manage-data.js 的 keys=tracks)
// GET /api/admin/manage-track → {ok:true, tracks:[...]}
import { err } from '../../_shared.js';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err('D1 not configured', 500);
  try {
    const r = await env.DB.prepare('SELECT * FROM race_tracks ORDER BY sort_order, id').all();
    return new Response(JSON.stringify({
      ok: true,
      tracks: r.results || [],
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
