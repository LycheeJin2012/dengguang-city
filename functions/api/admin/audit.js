import { endpoint, identity, integer, reply } from '../../_core/request.js';

/**
 * 审计事件查询（只读，仅超管）。
 *
 * 审计表只增不改，所以这个查询的核心是「**翻页要稳定**」：
 * 数据随时在写，如果只用 `id < cursor` 翻页，新插入的行不会影响已翻过的区间，
 * 同一个快照内多次翻页拿到的集合不会重也不会漏。
 */

/** 允许按这几个字段做等值筛选 */
const EQUALITY_FIELDS = ['actor_type', 'resource_type', 'resource_id', 'action'];

/**
 * 按查询参数攒 WHERE 条件与绑定值。
 *
 * 条件是拼进 SQL 的，但**字段名来自上面的白名单常量**，
 * 值一律走绑定参数 —— 这里是审计数据，唯一不能出错的底线是不被注入。
 */
function conditionsFrom(url, snapshot) {
  const conditions = ['id<=?'];
  const args = [snapshot];

  if (url.searchParams.has('cursor')) {
    conditions.push('id<?');
    args.push(integer(url.searchParams.get('cursor')));
  }

  for (const field of EQUALITY_FIELDS) {
    const value = url.searchParams.get(field);
    if (value) {
      conditions.push(field + '=?');
      args.push(value);
    }
  }

  if (url.searchParams.get('actor_id')) {
    conditions.push('actor_id=?');
    args.push(integer(url.searchParams.get('actor_id')));
  }

  if (url.searchParams.get('from')) {
    conditions.push('created_at>=?');
    args.push(url.searchParams.get('from'));
  }

  if (url.searchParams.get('to')) {
    // to 当天是闭区间：datetime(?,'+1 day') 把当天最后一行也包进来。
    conditions.push("created_at<datetime(?,'+1 day')");
    args.push(url.searchParams.get('to'));
  }

  return { conditions, args };
}

export const onRequestGet = (context) =>
  endpoint(async () => {
    await identity(context, 'super');

    const url = new URL(context.request.url);
    // snapshot 默认取当前最大 id 并返回给前端：它就是这一页翻页的基准线。
    // 顺序要紧 —— 先定下 snapshot，再拿它去构造后续条件。
    const maximum = (await context.env.DB.prepare('SELECT COALESCE(MAX(id),0) AS n FROM audit_events').first()).n;
    const snapshot = url.searchParams.has('snapshot')
      ? integer(url.searchParams.get('snapshot'), 'snapshot', 0)
      : maximum;

    const { conditions, args } = conditionsFrom(url, snapshot);
    const limit = integer(url.searchParams.get('limit') || 100, 'limit', 1, 1000);
    const rows = await context.env.DB.prepare(
      `SELECT * FROM audit_events WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ?`
    )
      .bind(...args, limit)
      .all();

    return reply({
      events: rows.results,
      snapshot,
      // 只有刚好取满 limit 才可能有下一页；不满就是最后一页，next_cursor 给 null。
      next_cursor: rows.results.length === limit ? rows.results.at(-1).id : null,
    });
  });
