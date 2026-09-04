// v50: admin 国际赛车场试车审核
import { ok, err, handleOptions, requireAdmin, parseListParams } from './_helpers.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const p = parseListParams(request);
  const where = []; const binds = [];
  if (p.status) { where.push('c.status = ?'); binds.push(p.status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await env.DB.prepare(
    `SELECT c.*, p.username AS player_username, t.name AS track_name
     FROM circuit_signups c LEFT JOIN players p ON p.id = c.player_id LEFT JOIN race_tracks t ON t.id = c.track_id
     ${whereSql} ORDER BY c.created_at DESC LIMIT ?`
  ).bind(...binds, p.limit).all();
  return ok({ signups: rows.results || [] });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  const body = await request.json().catch(() => ({}));
  if (!body.status) return err(400, 'status 必填');
  await env.DB.prepare('UPDATE circuit_signups SET status = ? WHERE id = ?').bind(body.status, id).run();
  return ok({ id, status: body.status });
}
