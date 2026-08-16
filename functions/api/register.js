// POST /api/register - 玩家注册（v16：需 admin 审批）
// 注册成功不会自动登录，用户处于 pending 状态，admin 审批后才能登录
import { ok, err, hashPassword, isUsername, isEmail, isNonEmpty, stripHtml } from '../_shared.js';

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
  // v16: username 即游戏ID，不再需要独立 game_id 字段
  const gameId = username; // 同步写入 game_id 字段保持兼容

  if (!isUsername(username)) return err(400, '用户名 2-32 字符（= 你的游戏ID），不能含 @ 或换行');
  if (!isEmail(email)) return err(400, '邮箱格式不正确');
  if (!isNonEmpty(password, 128) || password.length < 8) return err(400, '密码至少 8 位');

  // 检查重复
  const dupU = await env.DB.prepare('SELECT id FROM players WHERE username = ?').bind(username).first();
  if (dupU) return err(409, '用户名已被占用');
  const dupE = await env.DB.prepare('SELECT id FROM players WHERE email = ?').bind(email).first();
  if (dupE) return err(409, '邮箱已被注册');

  // 哈希 + 插入（v16: status=pending，admin 审批后才能登录）
  const { hash, salt } = await hashPassword(password);
  const ins = await env.DB.prepare(
    'INSERT INTO players (username, email, password_hash, salt, game_id, status, avatar_emoji) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(username, email, hash, salt, gameId, 'pending', '👤').run();

  // v16: 注册后不创建 session，pending 用户不能直接登录
  return ok({
    user: {
      id: ins.meta.last_row_id,
      username,
      email,
      game_id: gameId,
      status: 'pending'
    },
    message: '注册申请已提交，等市政厅审批通过后即可登录'
  });
}
