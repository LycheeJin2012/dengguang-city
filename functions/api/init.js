// v50: init API (POST 触发 schema 初始化; GET 提供常用聚合数据)
import { ok, err, handleOptions } from '../_shared.js';
import { SCHEMA, MIGRATIONS } from './_schema.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const body = await request.json().catch(() => ({}));
  const action = body.action || 'init';

  if (action === 'init') {
    for (const sql of SCHEMA) await env.DB.prepare(sql).run();
    for (const sql of MIGRATIONS) {
      try { await env.DB.prepare(sql).run(); } catch (e) { /* 已存在列 */ }
    }
    return ok({ initialized: true });
  }
  return err(400, '未知 init action');
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'stats';

  if (action === 'stats') {
    const [p, b, m] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE status = 'active'").first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM bookings').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM messages').first(),
    ]);
    return ok({ stats: { players: p?.n || 0, bookings: b?.n || 0, messages: m?.n || 0 } });
  }
  return err(400, '未知 action');
}
