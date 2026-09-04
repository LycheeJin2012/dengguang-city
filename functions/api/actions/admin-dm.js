// v50: 管理员 DM 监管 (admin 鉴权 GET / DELETE)
import { ok, err, getSession, readToken } from '../_helpers.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员');
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const rows = await env.DB.prepare(
    `SELECT dm.id, dm.from_player_id, dm.to_player_id, dm.body, dm.is_read, dm.created_at,
            p1.username AS from_username, p2.username AS to_username
     FROM direct_messages dm
     LEFT JOIN players p1 ON p1.id = dm.from_player_id
     LEFT JOIN players p2 ON p2.id = dm.to_player_id
     ORDER BY dm.created_at DESC LIMIT ?`
  ).bind(limit).all();
  return ok({ messages: rows.results || [] });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员');
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM direct_messages WHERE id = ?').bind(id).run();
  return ok({ id, deleted: true });
}
