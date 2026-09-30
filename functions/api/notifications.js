import {
  endpoint,
  identity,
  integer,
  reply,
  fail,
} from '../_core/request.js';

/**
 * GET /api/notifications —— 通知列表 + 未读数。
 * 未读数不受列表过滤影响（?unread=1 时前端要显示「全部已读」按钮的计数）。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const url = new URL(c.request.url);
    const limit = integer(url.searchParams.get('limit') || 100, 'limit', 1, 200);
    const unreadOnly = url.searchParams.get('unread') === '1';

    const list = await c.env.DB
      .prepare(
        `SELECT * FROM notification_log WHERE player_id=? ${
          unreadOnly ? 'AND read_at IS NULL' : ''
        } ORDER BY id DESC LIMIT ?`
      )
      .bind(player.id, limit)
      .all();

    const unreadCount = await c.env.DB
      .prepare('SELECT COUNT(*) AS n FROM notification_log WHERE player_id=? AND read_at IS NULL')
      .bind(player.id)
      .first();

    return reply({ notifications: list.results, unread_count: unreadCount.n });
  });

/**
 * PATCH /api/notifications?action=read-all —— 一键已读。
 * 只动自己未读的那批，不回写已有阅读时间。
 */
export const onRequestPatch = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const url = new URL(c.request.url);

    if (url.searchParams.get('action') === 'read-all') {
      await c.env.DB
        .prepare(
          "UPDATE notification_log SET read_at=datetime('now') WHERE player_id=? AND read_at IS NULL"
        )
        .bind(player.id)
        .run();
      return reply({ read_all: true });
    }

    // 单条已读：先确认这条属于本人（权限检查在写之前），再落时间。
    // COALESCE 保证重复点已读不会改写第一次的阅读时间。
    const id = integer(url.searchParams.get('id'));
    const owned = await c.env.DB
      .prepare('SELECT id FROM notification_log WHERE id=? AND player_id=?')
      .bind(id, player.id)
      .first();
    if (!owned) fail(404, '通知不存在');

    await c.env.DB
      .prepare(
        "UPDATE notification_log SET read_at=COALESCE(read_at,datetime('now')) WHERE id=? AND player_id=?"
      )
      .bind(id, player.id)
      .run();
    return reply({ id, read: true });
  });
