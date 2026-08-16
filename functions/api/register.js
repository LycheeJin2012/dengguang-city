// POST /api/register - 玩家注册（注册成功同时创建 session 并 Set-Cookie）
import { ok, err, hashPassword, isUsername, isEmail, isNonEmpty, stripHtml, createSession } from '../_shared.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return err(400, 'Invalid JSON body');
  }

  const username = stripHtml(body.username || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const gameId = stripHtml(body.game_id || '').trim();

  if (!isUsername(username)) return err(400, '用户名必须是 3-32 位字母/数字/下划线/连字符');
  if (!isEmail(email)) return err(400, '邮箱格式不正确');
  if (!isNonEmpty(password, 128) || password.length < 8) return err(400, '密码至少 8 位');
  if (gameId && gameId.length > 64) return err(400, '游戏 ID 太长');

  // 检查重复
  const dupU = await env.DB.prepare('SELECT id FROM players WHERE username = ?').bind(username).first();
  if (dupU) return err(409, '用户名已被占用');
  const dupE = await env.DB.prepare('SELECT id FROM players WHERE email = ?').bind(email).first();
  if (dupE) return err(409, '邮箱已被注册');

  // 哈希 + 插入
  const { hash, salt } = await hashPassword(password);
  const ins = await env.DB.prepare(
    'INSERT INTO players (username, email, password_hash, salt, game_id) VALUES (?, ?, ?, ?, ?)'
  ).bind(username, email, hash, salt, gameId || null).run();

  const userId = ins.meta.last_row_id;

  // 创建 player session + Set-Cookie（注册即登录）
  const { token, expires_at } = await createSession(env, userId, null);
  const cookie = `lc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${8*3600}`;

  return new Response(JSON.stringify({
    ok: true,
    role: 'player',
    user_id: userId,
    token,
    expires_at,
    user: { id: userId, username, email, game_id: gameId || null }
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': cookie
    }
  });
}
