// GET    /api/dm?box=inbox|sent|all&with=username - 列出私信会话
// GET    /api/dm?with=username                  - 与某人完整会话
// POST   /api/dm {to, content}                  - 发私信
// PATCH  /api/dm?id=X                            - 标已读
import { ok, err, stripHtml, isNonEmpty, readToken, getSession } from '../_shared.js';

async function getMe(context) {
  const { env, request } = context;
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return null;
  const me = await env.DB.prepare('SELECT id, username, avatar_emoji FROM players WHERE id = ?').bind(sess.player_id).first();
  return { session: sess, player: me };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const me = await getMe(context);
  if (!me) return err(401, '请先登录玩家账号');

  const url = new URL(request.url);
  const with  = url.searchParams.get('with');
  const box   = url.searchParams.get('box') || 'all';

  // 与某人完整会话
  if (with) {
    const other = await env.DB.prepare('SELECT id, username, avatar_emoji FROM players WHERE username = ?').bind(with).first();
    if (!other) return err(404, '对方不存在');
    const rows = await env.DB.prepare(
      `SELECT id, from_player_id, to_player_id, content, read_at, created_at
       FROM direct_messages
       WHERE (from_player_id = ? AND to_player_id = ?) OR (from_player_id = ? AND to_player_id = ?)
       ORDER BY created_at ASC LIMIT 200`
    ).bind(me.player.id, other.id, other.id, me.player.id).all();
    // 自动把对方发给我的标已读
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await env.DB.prepare(
      "UPDATE direct_messages SET read_at = COALESCE(read_at, ?) WHERE from_player_id = ? AND to_player_id = ? AND read_at IS NULL"
    ).bind(now, other.id, me.player.id).run();
    return ok({ messages: rows.results, other });
  }

  // 列出所有会话
  let rows;
  if (box === 'inbox') {
    rows = await env.DB.prepare(
      `SELECT m.id, m.from_player_id, m.to_player_id, m.content, m.read_at, m.created_at,
              p.username as from_username, p.avatar_emoji as from_avatar
       FROM direct_messages m
       LEFT JOIN players p ON p.id = m.from_player_id
       WHERE m.to_player_id = ?
       ORDER BY m.created_at DESC LIMIT 100`
    ).bind(me.player.id).all();
  } else if (box === 'sent') {
    rows = await env.DB.prepare(
      `SELECT m.id, m.from_player_id, m.to_player_id, m.content, m.read_at, m.created_at,
              p.username as to_username, p.avatar_emoji as to_avatar
       FROM direct_messages m
       LEFT JOIN players p ON p.id = m.to_player_id
       WHERE m.from_player_id = ?
       ORDER BY m.created_at DESC LIMIT 100`
    ).bind(me.player.id).all();
  } else {
    // all - 我参与的所有
    rows = await env.DB.prepare(
      `SELECT m.*, p.username as from_username, p2.username as to_username,
              p.avatar_emoji as from_avatar, p2.avatar_emoji as to_avatar
       FROM direct_messages m
       LEFT JOIN players p ON p.id = m.from_player_id
       LEFT JOIN players p2 ON p2.id = m.to_player_id
       WHERE m.from_player_id = ? OR m.to_player_id = ?
       ORDER BY m.created_at DESC LIMIT 100`
    ).bind(me.player.id, me.player.id).all();
  }
  return ok({ messages: rows.results });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const me = await getMe(context);
  if (!me) return err(401, '请先登录玩家账号');

  let body = {};
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }

  const toUsername = (body.to || '').trim();
  const content    = stripHtml(body.content || '').trim();
  if (!toUsername) return err(400, '请指定收件人用户名');
  if (!isNonEmpty(content, 2000)) return err(400, '私信内容不能为空（1-2000 字符）');

  const target = await env.DB.prepare(
    "SELECT id, username, status FROM players WHERE username = ?"
  ).bind(toUsername).first();
  if (!target) return err(404, '收件人不存在');
  if (target.status !== 'active') return err(400, '对方账号未激活');
  if (target.id === me.player.id) return err(400, '不能给自己发私信');

  const ins = await env.DB.prepare(
    'INSERT INTO direct_messages (from_player_id, to_player_id, content) VALUES (?, ?, ?)'
  ).bind(me.player.id, target.id, content).run();

  return ok({ id: ins.meta.last_row_id, to: target.username });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const me = await getMe(context);
  if (!me) return err(401, '请先登录玩家账号');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');

  const m = await env.DB.prepare('SELECT to_player_id FROM direct_messages WHERE id = ?').bind(id).first();
  if (!m) return err(404, '私信不存在');
  if (m.to_player_id !== me.player.id) return err(403, '只能标已读自己收到的');

  await env.DB.prepare("UPDATE direct_messages SET read_at = datetime('now') WHERE id = ?").bind(id).run();
  return ok({ id, read: true });
}
