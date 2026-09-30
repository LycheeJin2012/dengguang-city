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

    const created = await context.env.DB
      .prepare("INSERT INTO subscriptions(player_id,type,channel) VALUES(?,?,'site')")
      .bind(player.id, input.type)
      .run();

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
