// v25.62: 临时调试 — 模拟 super admin, 跑 9 个 admin 端点 SQL, 定位 render 失败真因
import { ok, err } from '../_shared.js';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  const out = {};

  // 模拟 super admin (id=1 通常是 LycheeJin/super)
  const admin = await env.DB.prepare('SELECT id, role FROM admins ORDER BY id LIMIT 1').first();
  out.simulated_admin = admin;
  if (!admin) return ok({ error: 'no admin in DB', out });

  const fakeCtx = { ...context, _bypass: true };

  // 9 个 admin 端点 SQL (与各自 .js 一致)
  const queries = {
    messages: `SELECT m.*, p.username as player_username FROM messages m LEFT JOIN players p ON p.id = m.player_id ORDER BY m.created_at DESC LIMIT 200`,
    players: `SELECT p.*, lp.username as linked_admin_username FROM players p LEFT JOIN admins lp ON lp.id = p.linked_admin_id ORDER BY p.created_at DESC`,
    bookings: `SELECT b.*, p.username as player_username FROM bookings b LEFT JOIN players p ON p.id = b.player_id ORDER BY b.created_at DESC LIMIT 200`,
    license: `SELECT l.*, p.username as player_username, a.username as reviewer FROM license_signups l LEFT JOIN players p ON p.id = l.player_id LEFT JOIN admins a ON a.id = l.result_by ORDER BY CASE l.status WHEN 'pending' THEN 0 WHEN 'passed' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END, l.created_at DESC LIMIT 300`,
    karts: `SELECT k.*, p.username as player_username FROM kart_signups k LEFT JOIN players p ON p.id = k.player_id ORDER BY k.created_at DESC LIMIT 200`,
    circuits: `SELECT c.*, p.username as player_username FROM circuit_signups c LEFT JOIN players p ON p.id = c.player_id ORDER BY c.created_at DESC LIMIT 200`,
    admins: `SELECT a.id, a.username, a.role, a.created_at, a.linked_player_id, lp.username as linked_player_username, lp.game_id as linked_player_game_id FROM admins a LEFT JOIN players lp ON lp.id = a.linked_player_id ORDER BY a.id ASC`,
  };

  for (const [k, sql] of Object.entries(queries)) {
    try {
      const r = await env.DB.prepare(sql).all();
      out[k] = { count: (r.results || []).length, sample: (r.results || []).slice(0, 2) };
    } catch (e) {
      out[k] = { error: e.message };
    }
  }

  // 公共端点 (renderAnnouncements / renderGallery 用)
  try {
    const r = await env.DB.prepare('SELECT id, title, content, image_url, created_at, updated_at, created_by FROM announcements ORDER BY created_at DESC LIMIT 5').all();
    out.announcements = { count: (r.results || []).length, sample: (r.results || []).slice(0, 2) };
  } catch (e) { out.announcements = { error: e.message }; }

  try {
    const r = await env.DB.prepare('SELECT id, num, cat, label, file_url, sort_order, is_featured, is_published, created_at, updated_at FROM gallery_items WHERE is_published = 1 ORDER BY cat, sort_order, num').all();
    out.gallery = { count: (r.results || []).length, sample: (r.results || []).slice(0, 2) };
  } catch (e) { out.gallery = { error: e.message }; }

  return ok(out);
}
