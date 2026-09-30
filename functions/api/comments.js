import {
  endpoint,
  identity,
  body,
  string,
  integer,
  reply,
  fail,
} from '../_core/request.js';

/**
 * GET /api/comments —— 留言评论列表。
 * 公开接口，无需登录（只回 author_name，不回 player_id）。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const messageId = integer(new URL(c.request.url).searchParams.get('message_id'));
    const result = await c.env.DB
      .prepare(
        'SELECT id,message_id,player_id,author_name,content,created_at FROM message_comments WHERE message_id=? ORDER BY id LIMIT 200'
      )
      .bind(messageId)
      .all();
    return reply({ comments: result.results });
  });

/** POST /api/comments —— 在留言下发表评论。 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const messageId = integer(input.message_id);
    const content = string(input.content, '评论', 2000);

    // 外键不存在时直接 404，而不是让 INSERT 报外键约束错。
    const message = await c.env.DB
      .prepare('SELECT id FROM messages WHERE id=?')
      .bind(messageId)
      .first();
    if (!message) fail(404, '留言不存在');

    const result = await c.env.DB
      .prepare(
        'INSERT INTO message_comments(message_id,player_id,author_name,content) VALUES(?,?,?,?)'
      )
      .bind(messageId, player.id, player.username, content)
      .run();
    return reply({ id: result.meta.last_row_id }, 201);
  });

/**
 * DELETE /api/comments?id= —— 删评论。
 * 管理员随便删；普通玩家只能删自己的（且必须先证明是自己的）。
 */
export const onRequestDelete = (c) =>
  endpoint(async () => {
    const id = integer(new URL(c.request.url).searchParams.get('id'));
    let player;
    try {
      player = await identity(c, 'admin');
    } catch (e) {
      if (e.status !== 401 && e.status !== 403) throw e;
      player = await identity(c);
      // 归属检查必须在 DELETE 之前，否则会删掉别人的。
      const own = await c.env.DB
        .prepare('SELECT id FROM message_comments WHERE id=? AND player_id=?')
        .bind(id, player.id)
        .first();
      if (!own) fail(403, '只能删除自己的评论');
    }

    await c.env.DB.prepare('DELETE FROM message_comments WHERE id=?').bind(id).run();
    return reply({ deleted: id });
  });
