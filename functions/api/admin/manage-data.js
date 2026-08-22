// v25.11: 用 server-side 注入方式给 admin-new.html 喂数据
// 因为浏览器 fetch 在某些环境会卡死, 用 <script src> 同步加载设 window 全局
// GET /api/admin/manage-data.js?keys=hotels,rooms,tracks,licenseReq
// 返回 JS: window.__manageData = {hotels:[...], rooms:[...], ...}
import { ok, err } from '../../_shared.js';

const ALLOWED_KEYS = new Set(['hotels', 'rooms', 'tracks', 'licenseReq']);

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) {
    return new Response('window.__manageData = {error:"D1 not configured"};', {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    });
  }
  const url = new URL(request.url);
  const keysParam = url.searchParams.get('keys') || 'hotels,rooms,tracks,licenseReq';
  const keys = keysParam.split(',').map(k => k.trim()).filter(k => ALLOWED_KEYS.has(k));

  const data = {};
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
    const js = 'window.__manageData = ' + JSON.stringify(data) + ';';
    return new Response(js, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (e) {
    return new Response('window.__manageData = {error:' + JSON.stringify(String(e.message)) + '};', {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    });
  }
}
