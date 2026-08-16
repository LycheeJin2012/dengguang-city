// /api/social - 玩家社交（私信 DM + 个人主页 profile）
//
// GET    ?action=me                       - 自己的 profile
// GET    ?action=profile&username=X       - 公开 profile（无需登录）
// PATCH  ?action=me          {bio, avatar} - 编辑自己的 profile
// GET    ?action=dm-list                  - 我的私信会话列表
// GET    ?action=dm-thread&peer=X         - 与某人的私信记录
// POST   ?action=dm-send    {to_username, content} - 发私信
// PATCH  ?action=dm-read&peer=X           - 标记某人来信为已读
import { ok, err, stripHtml, isNonEmpty, readToken, getSession } from '../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // 公开 profile — 无需登录
  if (action === 'profile') {
    const username = (url.searchParams.get('username') || '').trim();
    if (!username) return err(400, 'username 必填');
    const p = await env.DB.prepare(
      "SELECT id, username, avatar_emoji, bio, created_at FROM players WHERE username = ? AND status = 'active'"
    ).bind(username).first();
    if (!p) return err(404, '玩家不存在或账号未激活');
    // 附：最近活动统计（留言数 / 评论数 / 私信数等）
    const msgCount = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM messages WHERE player_id = ?'
    ).bind(p.id).first();
    const cmtCount = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM message_comments WHERE player_id = ?'
    ).bind(p.id).first();
    return ok({
      profile: p,
      stats: {
        messages: msgCount?.n || 0,
        comments: cmtCount?.n || 0
      }
    });
  }

  // 其余需要登录
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录');

  if (action === 'me') {
    const me = await env.DB.prepare(
      'SELECT id, username, email, avatar_emoji, bio, status, created_at FROM players WHERE id = ?'
    ).bind(sess.player_id).first();
    return ok({ profile: me });
  }

  if (action === 'dm-list') {
    // 列出所有跟我有私信往来的会话
    const rows = await env.DB.prepare(
      `SELECT
         CASE WHEN dm.from_player_id = ? THEN dm.to_player_id ELSE dm.from_player_id END AS peer_id,
         MAX(dm.created_at) AS last_at,
         SUM(CASE WHEN dm.to_player_id = ? AND dm.read_at IS NULL THEN 1 ELSE 0 END) AS unread,
         (SELECT content FROM direct_messages d2
          WHERE (d2.from_player_id = ? AND d2.to_player_id = peer_id)
             OR (d2.from_player_id = peer_id AND d2.to_player_id = ?)
          ORDER BY d2.created_at DESC LIMIT 1) AS last_content
       FROM direct_messages dm
       WHERE dm.from_player_id = ? OR dm.to_player_id = ?
       GROUP BY peer_id
       ORDER BY last_at DESC LIMIT 100`
    ).bind(sess.player_id, sess.player_id, sess.player_id, sess.player_id, sess.player_id, sess.player_id).all();
    if (rows.results.length === 0) return ok({ conversations: [] });
    const peerIds = rows.results.map(r => r.peer_id);
    const placeholders = peerIds.map(() => '?').join(',');
    const peers = await env.DB.prepare(
      `SELECT id, username, avatar_emoji FROM players WHERE id IN (${placeholders})`
    ).bind(...peerIds).all();
    const peerMap = {};
    for (const p of peers.results) peerMap[p.id] = p;
    const conversations = rows.results.map(r => ({
      peer_id: r.peer_id,
      last_at: r.last_at,
      unread: r.unread || 0,
      last_content: r.last_content,
      peer: peerMap[r.peer_id] || { id: r.peer_id, username: '(已注销)', avatar_emoji: '❓' }
    }));
    return ok({ conversations });
  }

  if (action === 'dm-thread') {
    const peerUsername = (url.searchParams.get('peer') || '').trim();
    if (!peerUsername) return err(400, 'peer 必填');
    const peer = await env.DB.prepare(
      "SELECT id, username, avatar_emoji FROM players WHERE username = ? AND status = 'active'"
    ).bind(peerUsername).first();
    if (!peer) return err(404, '对方不存在');
    if (peer.id === sess.player_id) return err(400, '不能跟自己发私信');
    const msgs = await env.DB.prepare(
      `SELECT id, from_player_id, to_player_id, content, read_at, created_at
       FROM direct_messages
       WHERE (from_player_id = ? AND to_player_id = ?)
          OR (from_player_id = ? AND to_player_id = ?)
       ORDER BY created_at ASC LIMIT 200`
    ).bind(sess.player_id, peer.id, peer.id, sess.player_id).all();
    return ok({ peer, messages: msgs.results });
  }

  return err(400, '未知 action: ' + action);
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录');

  if (action === 'dm-send') {
    let body = {};
    try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }
    const toUsername = (body.to_username || '').trim();
    const content    = stripHtml(body.content || '').trim();
    if (!toUsername) return err(400, 'to_username 必填');
    if (!isNonEmpty(content, 2000)) return err(400, '私信内容不能为空（1-2000 字符）');
    const peer = await env.DB.prepare(
      "SELECT id, username FROM players WHERE username = ? AND status = 'active'"
    ).bind(toUsername).first();
    if (!peer) return err(404, '收件人不存在或账号未激活');
    if (peer.id === sess.player_id) return err(400, '不能给自己发私信');
    const ins = await env.DB.prepare(
      'INSERT INTO direct_messages (from_player_id, to_player_id, content) VALUES (?, ?, ?)'
    ).bind(sess.player_id, peer.id, content).run();
    return ok({ id: ins.meta.last_row_id, to: peer.username });
  }

  return err(400, '未知 action: ' + action);
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录');

  if (action === 'me') {
    let body = {};
    try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }
    const bio = (body.bio !== undefined ? String(body.bio) : '').trim().slice(0, 500);
    let avatar = (body.avatar_emoji !== undefined ? String(body.avatar_emoji) : '👤').trim().slice(0, 4);
    avatar = avatar.replace(/[\u0000-\u001F\u007F]/g, '');
    if (!avatar) avatar = '👤';
    await env.DB.prepare(
      'UPDATE players SET bio = ?, avatar_emoji = ? WHERE id = ?'
    ).bind(bio, avatar, sess.player_id).run();
    const me = await env.DB.prepare(
      'SELECT id, username, email, avatar_emoji, bio, status, created_at FROM players WHERE id = ?'
    ).bind(sess.player_id).first();
    return ok({ profile: me });
  }

  if (action === 'dm-read') {
    const peerUsername = (url.searchParams.get('peer') || '').trim();
    if (!peerUsername) return err(400, 'peer 必填');
    const peer = await env.DB.prepare(
      'SELECT id FROM players WHERE username = ?'
    ).bind(peerUsername).first();
    if (!peer) return err(404, '对方不存在');
    const r = await env.DB.prepare(
      "UPDATE direct_messages SET read_at = datetime('now') WHERE to_player_id = ? AND from_player_id = ? AND read_at IS NULL"
    ).bind(sess.player_id, peer.id).run();
    return ok({ marked: r.meta.changes || 0 });
  }

  return err(400, '未知 action: ' + action);
}
