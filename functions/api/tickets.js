// v50: 工单 API (admin 鉴权 GET/PATCH + 玩家 POST service 工单)
// v50 修复: 当 category=message 时, UNION 老 messages 表的留言数据
//   (老数据 id 偏移 1_000_000 避免冲突, status 状态映射)
import { ok, err, handleOptions, getSession, readToken, stripHtml, isNonEmpty } from '../_shared.js';

const CATEGORIES = new Set(['message', 'comment', 'license', 'hotel', 'race', 'kart', 'service']);
const STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

async function requireAdmin(context) {
  const { env, request } = context;
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return null;
  return await env.DB.prepare('SELECT id, role, username FROM admins WHERE id = ?').bind(sess.admin_id).first();
}

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) {
    const idNum = parseInt(id, 10);
    if (idNum >= 1_000_000) {
      const m = await env.DB.prepare(
        `SELECT (m.id + 1000000) AS id, m.player_id, 'message' AS category, 'messages' AS source_table,
                m.id AS source_id, m.name AS title, m.content AS body, m.status,
                'normal' AS priority, NULL AS assignee_id, m.created_at, NULL AS updated_at,
                m.replied_at, m.admin_reply, p.username AS player_username, p.avatar_emoji,
                NULL AS assignee_username
         FROM messages m LEFT JOIN players p ON p.id = m.player_id WHERE m.id = ?`
      ).bind(idNum - 1_000_000).first();
      if (!m) return err(404, '工单不存在');
      if (m.status === 'unread') m.status = 'open';
      else if (m.status === 'read') m.status = 'in_progress';
      else if (m.status === 'done') m.status = 'resolved';
      return ok({ ticket: m });
    }
    const t = await env.DB.prepare(
      `SELECT t.*, p.username AS player_username, p.avatar_emoji, a.username AS assignee_username
       FROM tickets t LEFT JOIN players p ON p.id = t.player_id LEFT JOIN admins a ON a.id = t.assignee_id
       WHERE t.id = ?`
    ).bind(idNum).first();
    if (!t) return err(404, '工单不存在');
    return ok({ ticket: t });
  }

  const category = url.searchParams.get('category') || '';
  const status = url.searchParams.get('status') || '';
  const priority = url.searchParams.get('priority') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);

  const where = []; const binds = [];
  if (category && CATEGORIES.has(category)) { where.push('t.category = ?'); binds.push(category); }
  if (status && STATUSES.has(status)) { where.push('t.status = ?'); binds.push(status); }
  if (priority && PRIORITIES.has(priority)) { where.push('t.priority = ?'); binds.push(priority); }
  if (q) { where.push('(t.title LIKE ? OR t.body LIKE ?)'); binds.push('%' + q + '%', '%' + q + '%'); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const includeLegacyMessages = !category || category === 'message';

  const tRows = await env.DB.prepare(
    `SELECT t.id, t.player_id, t.category, t.source_table, t.source_id, t.title, t.body,
            t.status, t.priority, t.assignee_id, t.created_at, t.updated_at, t.replied_at, t.admin_reply,
            p.username AS player_username, p.avatar_emoji, a.username AS assignee_username
     FROM tickets t LEFT JOIN players p ON p.id = t.player_id LEFT JOIN admins a ON a.id = t.assignee_id
     ${whereSql} ORDER BY t.created_at DESC LIMIT ?`
  ).bind(...binds, limit).all();

  let mRows = [];
  if (includeLegacyMessages) {
    const mWhere = []; const mBinds = [];
    if (status) {
      const mStatusMap = { open: 'unread', in_progress: 'read', resolved: 'done' };
      mWhere.push('m.status = ?');
      mBinds.push(mStatusMap[status] || status);
    }
    if (q) { mWhere.push('(m.name LIKE ? OR m.content LIKE ?)'); mBinds.push('%' + q + '%', '%' + q + '%'); }
    const mWhereSql = mWhere.length ? 'WHERE ' + mWhere.join(' AND ') : '';
    const mr = await env.DB.prepare(
      `SELECT (m.id + 1000000) AS id, m.player_id, 'message' AS category, 'messages' AS source_table,
              m.id AS source_id, m.name AS title, m.content AS body, m.status, 'normal' AS priority,
              NULL AS assignee_id, m.created_at, NULL AS updated_at, m.replied_at, m.admin_reply,
              p.username AS player_username, p.avatar_emoji, NULL AS assignee_username
       FROM messages m LEFT JOIN players p ON p.id = m.player_id
       ${mWhereSql} ORDER BY m.created_at DESC LIMIT ?`
    ).bind(...mBinds, limit).all();
    mRows = (mr.results || []).map(r => {
      if (r.status === 'unread') r.status = 'open';
      else if (r.status === 'read') r.status = 'in_progress';
      else if (r.status === 'done') r.status = 'resolved';
      return r;
    });
  }

  const STATUS_RANK = { open: 0, in_progress: 1, resolved: 2, closed: 3 };
  const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
  const all = [...(tRows.results || []), ...mRows];
  all.sort((a, b) => {
    const sa = STATUS_RANK[a.status] ?? 9;
    const sb = STATUS_RANK[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    const pa = PRIORITY_RANK[a.priority] ?? 9;
    const pb = PRIORITY_RANK[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
  const rows = all.slice(0, limit);

  const counts = await env.DB.prepare(
    `SELECT category, status, COUNT(*) AS n FROM tickets WHERE status IN ('open', 'in_progress') GROUP BY category, status`
  ).all();
  const summary = { total_open: 0, by_category: {} };
  for (const r of counts.results || []) {
    if (!summary.by_category[r.category]) summary.by_category[r.category] = { open: 0, in_progress: 0 };
    summary.by_category[r.category][r.status] = r.n;
    summary.total_open += r.n;
  }
  if (includeLegacyMessages) {
    const mc = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM messages WHERE status IN ('unread', 'read') GROUP BY status`
    ).all();
    for (const r of mc.results || []) {
      if (!summary.by_category.message) summary.by_category.message = { open: 0, in_progress: 0 };
      if (r.status === 'unread') summary.by_category.message.open += r.n;
      else if (r.status === 'read') summary.by_category.message.in_progress += r.n;
      summary.total_open += r.n;
    }
  }

  return ok({ tickets: rows, summary, limit });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const rawId = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  if (!rawId) return err(400, 'id 必填');

  const isLegacy = rawId >= 1_000_000;
  const id = isLegacy ? rawId - 1_000_000 : rawId;
  const table = isLegacy ? 'messages' : 'tickets';
  const body = await request.json().catch(() => ({}));
  const sets = []; const binds = [];

  if (isLegacy) {
    const LEGACY_STATUS = { open: 'unread', in_progress: 'read', resolved: 'done', closed: 'done' };
    if (body.status) { sets.push('status = ?'); binds.push(LEGACY_STATUS[body.status] || body.status); }
    if (typeof body.admin_reply === 'string' && body.admin_reply.length > 0) {
      sets.push('admin_reply = ?'); binds.push(stripHtml(body.admin_reply));
      sets.push('replied_at = ?'); binds.push(new Date().toISOString());
      if (!body.status) { sets.push('status = ?'); binds.push('done'); }
    }
  } else {
    if (body.status && STATUSES.has(body.status)) { sets.push('status = ?'); binds.push(body.status); }
    if (body.priority && PRIORITIES.has(body.priority)) { sets.push('priority = ?'); binds.push(body.priority); }
    if (body.assignee_id !== undefined) { sets.push('assignee_id = ?'); binds.push(body.assignee_id || null); }
    if (typeof body.admin_reply === 'string' && body.admin_reply.length > 0) {
      sets.push('admin_reply = ?'); binds.push(stripHtml(body.admin_reply));
      sets.push('replied_at = ?'); binds.push(new Date().toISOString());
      sets.push('replied_by = ?'); binds.push(admin.id);
      if (!body.status) { sets.push('status = ?'); binds.push('resolved'); }
    }
    if (!sets.length) return err(400, '没有可更新字段');
    sets.push("updated_at = datetime('now')");
  }
  if (!sets.length) return err(400, '没有可更新字段');
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta?.changes) return err(404, '工单不存在或无变化');
  return ok({ id: rawId, updated: true });
}

export async function onRequestPost(context) {
  // 玩家主动提交 service 类工单
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '需要玩家登录');

  const body = await request.json().catch(() => ({}));
  const title = (body.title || '').trim();
  const bodyText = (body.body || '').trim();
  if (!title || !bodyText) return err(400, 'title/body 必填');
  if (title.length > 100) return err(400, 'title 不能超过 100 字');
  if (bodyText.length > 2000) return err(400, 'body 不能超过 2000 字');

  const priority = PRIORITIES.has(body.priority) ? body.priority : 'normal';
  const r = await env.DB.prepare(
    `INSERT INTO tickets (player_id, category, title, body, priority) VALUES (?, 'service', ?, ?, ?)`
  ).bind(sess.player_id, title, bodyText, priority).run();
  return ok({ id: r.meta?.last_row_id, created: true });
}
