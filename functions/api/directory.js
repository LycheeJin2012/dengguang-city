import { endpoint, identity, reply, string, fail } from '../_core/request.js';

/** ?kind= 缺省看玩家；只有管理员能翻管理员名录。 */
const DEFAULT_KIND = 'players';

/**
 * GET /api/directory —— 玩家/管理员名录，供 @提及 和搜索用。
 *
 * 权限是「登录即可看玩家，管理员才能看管理员」：先按普通市民身份试一次，
 * 失败时再退到管理员身份；两种都失败才报错。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    try {
      await identity(c);
    } catch (e) {
      // 非 401/403 说明是真故障（数据库没连上之类），照原样抛，别降级。
      if (e.status !== 401 && e.status !== 403) throw e;
      await identity(c, 'admin');
    }

    const url = new URL(c.request.url);
    const kind = url.searchParams.get('kind') || DEFAULT_KIND;
    const q = string(url.searchParams.get('q') || '', '搜索', 64, { required: false });

    if (kind === 'admins') {
      // 空 q 时 (?='') 成立，等于全量；否则用户名模糊匹配或直接按数字 ID 找。
      const admins = (
        await c.env.DB
          .prepare(
            "SELECT id,username FROM admins WHERE (?='' OR username LIKE ? OR CAST(id AS TEXT)=?) ORDER BY id LIMIT 100"
          )
          .bind(q, '%' + q + '%', q)
          .all()
      ).results;
      return reply({ admins });
    }

    if (kind !== 'players') fail(400, '目录类型无效');

    // 玩家名录只暴露 active 账号，数量上限比管理员名录小。
    const players = (
      await c.env.DB
        .prepare(
          "SELECT id,username FROM players WHERE status='active' AND (?='' OR username LIKE ? OR CAST(id AS TEXT)=?) ORDER BY username LIMIT 50"
        )
        .bind(q, '%' + q + '%', q)
        .all()
    ).results;
    return reply({ players });
  });
