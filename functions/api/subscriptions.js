// v50: 通知订阅 (玩家鉴权)
import { ok, err, handleOptions, getSession, readToken } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');
  const rows = await env.DB.prepare('SELECT id, topic, enabled, created_at FROM subscriptions WHERE player_id = ?').bind(sess.player_id).all();
  return ok({ subscriptions: rows.results || [] });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');
  const body = await request.json().catch(() => ({}));
  if (!body.topic) return err(400, 'topic 必填');
  await env.DB.prepare(
    'INSERT OR REPLACE INTO subscriptions (player_id, topic, enabled) VALUES (?, ?, ?)'
  ).bind(sess.player_id, body.topic, body.enabled === false ? 0 : 1).run();
  return ok({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');
  const topic = new URL(request.url).searchParams.get('topic');
  if (!topic) return err(400, 'topic 必填');
  await env.DB.prepare('DELETE FROM subscriptions WHERE player_id = ? AND topic = ?').bind(sess.player_id, topic).run();
  return ok({ deleted: true });
}
