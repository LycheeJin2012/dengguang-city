// v50: admin 卡丁车试跑审核
import { ok, err, handleOptions, requireAdmin, parseListParams } from './_helpers.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;
  const p = parseListParams(request);
  const where = []; const binds = [];
  if (p.status) { where.push('k.status = ?'); binds.push(p.status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await env.DB.prepare(
    `SELECT k.*, p.username AS player_username
     FROM kart_signups k LEFT JOIN players p ON p.id = k.player_id
     ${whereSql} ORDER BY k.created_at DESC LIMIT ?`
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
  await env.DB.prepare('UPDATE kart_signups SET status = ? WHERE id = ?').bind(body.status, id).run();
  return ok({ id, status: body.status });
}
