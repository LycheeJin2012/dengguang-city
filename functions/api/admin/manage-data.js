// v26 重写: 直接返回纯 JSON, 不用 JS 响应包装
// 旧版用 `window.__manageData = {...}` 格式, 前端要正则 match 提取 JSON, 容易出错
// 新版直接返回 JSON, 前端 fetch + response.json() 即可
// GET /api/admin/manage-data?keys=hotels,rooms,tracks,licenseReq
// Response: { ok: true, hotels: [...], rooms: [...], tracks: [...], licenseReq: [...] }
import { err } from '../../_shared.js';

const ALLOWED_KEYS = new Set(['hotels', 'rooms', 'tracks', 'licenseReq']);

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err('D1 not configured', 500);

  const url = new URL(request.url);
  const keysParam = url.searchParams.get('keys') || 'hotels,rooms,tracks,licenseReq';
  const keys = keysParam.split(',').map(k => k.trim()).filter(k => ALLOWED_KEYS.has(k));

  const data = { ok: true };
  try {
    if (keys.includes('hotels')) {
      const r = await env.DB.prepare('SELECT * FROM hotels ORDER BY sort_order, id').all();
      data.hotels = r.results || [];
    }
    if (keys.includes('rooms')) {
      const r = await env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY hotel_id, sort_order, id').all();
      data.rooms = r.results || [];
    }
    if (keys.includes('tracks')) {
      const r = await env.DB.prepare('SELECT * FROM race_tracks ORDER BY sort_order, id').all();
      data.tracks = r.results || [];
    }
    if (keys.includes('licenseReq')) {
      const r = await env.DB.prepare('SELECT * FROM license_requirements ORDER BY sort_order, id').all();
      data.licenseReq = r.results || [];
    }
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (e) {
    return err('SQL 失败: ' + (e.message || e), 500);
  }
}
