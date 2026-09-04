// v50: admin 驾照要求管理 alias
import { ok, err, getSession, readToken } from '../_helpers.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员');
  const rows = await env.DB.prepare('SELECT * FROM license_requirements ORDER BY sort_order, id').all();
  return ok({ reqs: rows.results || [] });
}
