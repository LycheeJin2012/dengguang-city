import { endpoint, identity, body, integer, reply, fail } from '../_core/request.js';

/** 目前只支持站内通知的三种类型 */
const TYPES = ['announcement', 'reply', 'dm'];

/** 同一个玩家 + 同一类型 + 站内 = 唯一一条订阅，取消后再订就是把它启用回来 */
const FIND_EXISTING =
  "SELECT id FROM subscriptions WHERE player_id=? AND type=? AND target_id IS NULL AND channel='site'";

export const onRequestGet = (context) =>
  endpoint(async () => {
    const player = await identity(context);
    const rows = await context.env.DB
      .prepare('SELECT * FROM subscriptions WHERE player_id=?')
      .bind(player.id)
      .all();
    return reply({ subscriptions: rows.results });
  });

export const onRequestPost = (context) =>
  endpoint(async () => {
    const player = await identity(context);
    const input = await body(context.request);

    // channel 缺省即站内；显式传了别的渠道目前不支持
    if (!TYPES.includes(input.type) || (input.channel && input.channel !== 'site')) {
      fail(400, '仅支持站内公告、回复、私信订阅');
    }

    const found = await context.env.DB
      .prepare(FIND_EXISTING)
      .bind(player.id, input.type)
      .first();

    // 已取消过的直接启用，不新建 —— 否则取消订阅会变成取消不掉
    if (found) {
      await context.env.DB
        .prepare('UPDATE subscriptions SET enabled=1 WHERE id=?')
        .bind(found.id)
        .run();
      return reply({ id: found.id });
    }

    // 并发重订阅会插出重复行：上面那次 SELECT 和这条 INSERT 之间有窗口，
    // 实跑 6 个并发请求能留下 4 行。重复行会让「取消订阅」取消不掉 ——
    // 软停用只把一行 enabled=0，另一行还在，用户照样收通知。
    //
    // 这里用单条 INSERT…SELECT…WHERE NOT EXISTS 收口：SQLite 里一条 INSERT
    // 语句是原子的，检查和写入在同一个写锁里，所以两个并发请求只会有一个
    // 真的插进来。不加 UNIQUE 约束是为了不碰生产迁移（_schema.js 里 88 条
    // 迁移都已在生产执行过），而这一条就足以堵住竞态。
    const created = await context.env.DB
      .prepare(
        `INSERT INTO subscriptions(player_id,type,channel)
         SELECT ?,?,'site'
         WHERE NOT EXISTS (
           SELECT 1 FROM subscriptions WHERE player_id=? AND type=? AND channel='site'
         )`
      )
      .bind(player.id, input.type, player.id, input.type)
      .run();

    // 输掉竞态的那一方（changes=0）说明别人刚插好了，把那行的 id 捞回来。
    // 语义与「已存在就复用」一致：重复订阅永远只对应一行。
    if (!created.meta.changes) {
      const winner = await context.env.DB
        .prepare(FIND_EXISTING)
        .bind(player.id, input.type)
        .first();
      return reply({ id: winner.id });
    }

    return reply({ id: created.meta.last_row_id }, 201);
  });

export const onRequestDelete = (context) =>
  endpoint(async () => {
    const player = await identity(context);
    const id = integer(new URL(context.request.url).searchParams.get('id'));

    // 取消订阅是软停用而不是删行：历史通知还要能追溯到当初订过
    const result = await context.env.DB
      .prepare('UPDATE subscriptions SET enabled=0 WHERE id=? AND player_id=?')
      .bind(id, player.id)
      .run();
    if (!result.meta.changes) fail(404, '订阅不存在');

    return reply({ id, disabled: true });
  });
