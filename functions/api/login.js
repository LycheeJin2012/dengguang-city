import { endpoint, body, string, fail, reply } from '../_core/request.js';
import { verifyPassword } from '../_shared/auth.js';
import { readToken, getSession, createSession, destroySession } from '../_shared/session.js';

// 会话 cookie。Max-Age=0 是登出时用的 —— 浏览器收到即刻过期，token 从此失效。
const cookie = (token, age = 28800) =>
  `lc_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

/** GET /api/login：读当前身份。 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const session = await getSession(c.env, readToken(c.request));
    if (!session) fail(401, '请先登录');
    const db = c.env.DB;

    // 三种身份各自独立判定存废。玩家与酒店老板要过 status='active'，
    // 管理员不过 —— admins 表没有 status 列。
    const admin = session.admin_id
      ? await db
          .prepare('SELECT id,username,role,linked_player_id FROM admins WHERE id=?')
          .bind(session.admin_id)
          .first()
      : null;
    const player = session.player_id
      ? await db
          .prepare(
            "SELECT id,username,email,game_id,status,avatar_emoji,bio,linked_admin_id,emeralds,created_at FROM players WHERE id=? AND status='active'"
          )
          .bind(session.player_id)
          .first()
      : null;
    const owner = session.hotel_owner_id
      ? await db
          .prepare("SELECT id,username,linked_player_id FROM hotel_owners WHERE id=? AND status='active'")
          .bind(session.hotel_owner_id)
          .first()
      : null;

    // 会话还在，但三种身份全查不到（都被停用/删除了）→ 会话已失效。
    // 这与「没有会话」是两种错，所以文案也不同。
    if (!admin && !player && !owner) fail(401, '会话已失效');

    // 合并账号可能一侧被单独删掉：反向绑定查不到就把这一侧抹掉，
    // 免得前端拿着一个指向不存在管理员的 linked_admin_id。
    if (
      player?.linked_admin_id &&
      !(await db
        .prepare('SELECT id FROM admins WHERE id=? AND linked_player_id=?')
        .bind(player.linked_admin_id, player.id)
        .first())
    ) {
      player.linked_admin_id = null;
    }

    // 酒店老板可以是会话里直接带的，也可以是由玩家身份反查出来的。
    const hotelOwner =
      owner ||
      (player
        ? await db
            .prepare("SELECT id,username FROM hotel_owners WHERE linked_player_id=? AND status='active'")
            .bind(player.id)
            .first()
        : null);

    return reply({
      role: admin?.role || (owner ? 'hotel_owner' : 'player'),
      user: admin || player || owner,
      admin,
      player,
      hotel_owner: hotelOwner,
      combined: !!admin && !!player,
    });
  });

/** POST /api/login：账号密码登录，签发会话。 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const b = await body(c.request);
    const username = string(b.username, '账号', 64);
    const password = b.password;
    if (typeof password !== 'string' || !password || password.length > 128) fail(400, '密码无效');

    // 限流按「IP + 用户名」计数，不按账号：同一 IP 换着账号猜也逃不掉。
    const ip = c.request.headers.get('CF-Connecting-IP') || 'local';
    const key = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + username))
      )
    )
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    const count = await c.env.DB
      .prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE fingerprint=? AND created_at>datetime('now','-10 minutes')")
      .bind(key)
      .first();
    if (count.n >= 10) fail(429, '尝试次数过多，请稍后重试');

    // target 决定去哪张表找账号；认不出来一律当玩家，避免拿玩家通道试管理员。
    const target = ['admin', 'hotel_owner'].includes(b.target) ? b.target : 'player';
    const player =
      target === 'player'
        ? await c.env.DB.prepare('SELECT * FROM players WHERE username=?').bind(username).first()
        : null;
    const owner =
      target === 'hotel_owner'
        ? await c.env.DB.prepare('SELECT * FROM hotel_owners WHERE username=?').bind(username).first()
        : null;
    const admin =
      target === 'admin'
        ? await c.env.DB.prepare('SELECT * FROM admins WHERE username=?').bind(username).first()
        : null;
    const account = player || admin || owner;

    // 账号不存在与密码错误必须回同一个 401，否则能被拿来枚举账号。
    if (!account || !(await verifyPassword(password, account.password_hash, account.salt))) {
      await c.env.DB.prepare('INSERT INTO auth_attempts(fingerprint) VALUES(?)').bind(key).run();
      fail(401, '账号或密码错误');
    }

    // 密码对了才谈状态。注意这一步在清空限流计数之前：停用账号的尝试
    // 不该被当成「登录成功」而把计数抹掉。管理员没有 status 列，不参与判定。
    if ((player && player.status !== 'active') || (owner && owner.status !== 'active')) {
      fail(403, '账号尚未激活或已停用');
    }

    // 到这里才算真正登录成功，清掉这个指纹下的失败计数。
    await c.env.DB.prepare('DELETE FROM auth_attempts WHERE fingerprint=?').bind(key).run();
    const session = await createSession(
      c.env,
      player?.id || null,
      admin?.id || null,
      owner?.id || null
    );

    const response = reply({
      user_id: account.id,
      role: admin?.role || (owner ? 'hotel_owner' : 'player'),
    });
    response.headers.set('Set-Cookie', cookie(session.token));
    return response;
  });

/** DELETE /api/login：登出。 */
export const onRequestDelete = (c) =>
  endpoint(async () => {
    await destroySession(c.env, readToken(c.request));
    const response = reply({ logged_out: true });
    // Max-Age=0 让浏览器立刻丢掉 cookie；库里那行也已经被 destroySession 删了。
    response.headers.set('Set-Cookie', cookie('', 0));
    return response;
  });
