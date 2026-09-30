import {
  endpoint,
  body,
  string,
  fail,
  reply,
} from '../_core/request.js';
import { isUsername, isEmail } from '../_shared/validators.js';
import { hashPassword } from '../_shared/auth.js';

/**
 * POST /api/register —— 市民注册。
 *
 * 建出来的账号 status 一律是 'pending'：注册只是申请，
 * 要管理员在后台激活才能登录（见 identity() 里对 status='active' 的要求）。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const input = await body(c.request);
    const username = string(input.username, '游戏 ID', 32);
    const email = string(input.email, '邮箱', 254).toLowerCase();

    if (!isUsername(username) || /[<>]/.test(username)) {
      fail(400, '游戏 ID 需 2–32 字符，不含 @、尖括号或控制字符');
    }
    if (!isEmail(email)) fail(400, '邮箱格式不正确');
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) {
      fail(400, '密码需 8–128 位');
    }

    // 唯一性查在插入之前，让重复注册得到 409 而不是 UNIQUE 约束错。
    if (
      await c.env.DB
        .prepare('SELECT id FROM players WHERE username=? OR email=?')
        .bind(username, email)
        .first()
    ) {
      fail(409, '账号或邮箱已注册');
    }

    const { hash, salt } = await hashPassword(input.password);

    // game_id 初始等于 username：游戏内改名逻辑靠它识别「本名」。
    const result = await c.env.DB
      .prepare(
        "INSERT INTO players(username,email,password_hash,salt,game_id,status) VALUES(?,?,?,?,?,'pending')"
      )
      .bind(username, email, hash, salt, username)
      .run();

    return reply(
      { user: { id: result.meta.last_row_id, username, email, status: 'pending' } },
      201
    );
  });
