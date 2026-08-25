// v25.60: 调试端点 — 不鉴权, 仅返回各表行数 (排查 admin 5 tab 空白真因)
// 临时用, 排查完会删
import { ok, err } from '../_shared.js';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const tables = [
    'players', 'admins', 'messages', 'message_comments',
    'hotels', 'hotel_rooms', 'race_tracks', 'license_requirements',
    'kart_signups', 'circuit_signups', 'license_signups', 'bookings',
    'announcements', 'gallery_items', 'direct_messages', 'webauthn_challenges',
    'passkeys', 'daily_signin'
  ];
  const out = {};
  for (const t of tables) {
    try {
      const r = await env.DB.prepare(`SELECT COUNT(*) as c FROM ${t}`).first();
      out[t] = r?.c ?? 'err';
    } catch (e) {
      out[t] = 'no_table';
    }
  }
  return ok(out);
}
