// v50: 玩家注册
import { ok, err, handleOptions, hashPassword, createSession, isUsername, isEmail, isNonEmpty, cookieFor } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const body = await request.json().catch(() => ({}));
  const username = (body.username || '').trim();
  const email = (body.email || '').trim();
  const password = body.password || '';
  if (!isUsername(username)) return err(400, '用户名 2-20 字 (字母数字中文_-)');
  if (!isEmail(email)) return err(400, '邮箱格式错');
  if (!isNonEmpty(password, 6) || password.length < 6) return err(400, '密码至少 6 位');

  const exist = await env.DB.prepare('SELECT id FROM players WHERE username = ? OR email = ?').bind(username, email).first();
  if (exist) return err(409, '用户名或邮箱已被注册');

  const { hash, salt } = await hashPassword(password);
  const r = await env.DB.prepare(
    'INSERT INTO players (username, email, password_hash, salt, status, avatar_emoji) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(username, email, hash, salt, 'active', body.avatar_emoji || '👤').run();
  const playerId = r.meta?.last_row_id;
  const token = await createSession(env, { player_id: playerId });
  const player = await env.DB.prepare('SELECT id, username, email, status, avatar_emoji, emeralds FROM players WHERE id = ?').bind(playerId).first();
  return new Response(JSON.stringify({ ok: true, user: player, player, kind: 'player' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookieFor(token) },
  });
}
