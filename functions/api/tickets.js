// v47: 工单 API (admin 后台统一入口, 替代原 messages/license/bookings 3 个 tab)
// GET    /api/tickets                    - 列表 (admin)
//   ?category=message|license|hotel|race|kart|service   按类型过滤
//   ?status=open|in_progress|resolved|closed            按状态过滤
//   ?priority=low|normal|high|urgent                    按优先级过滤
//   ?q=xxx                                               模糊搜索 title/body
// GET    /api/tickets?id=X               - 详情
// PATCH  /api/tickets?id=X               - 状态流转 / 派单 / 回复
//   body: { status?, priority?, assignee_id?, admin_reply? }

import { ok, err, readToken, getSession } from '../_shared.js';

async function requireAdmin(context) {
  const { env, request } = context;
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return null;
  const admin = await env.DB.prepare('SELECT id, role, username FROM admins WHERE id = ?').bind(sess.admin_id).first();
  return admin || null;
}

const CATEGORIES = new Set(['message', 'comment', 'license', 'hotel', 'race', 'kart', 'service']);
const STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) {
    const t = await env.DB.prepare(
      `SELECT t.*, p.username AS player_username, p.avatar_emoji, a.username AS assignee_username
       FROM tickets t
       LEFT JOIN players p ON p.id = t.player_id
       LEFT JOIN admins a ON a.id = t.assignee_id
       WHERE t.id = ?`
    ).bind(id).first();
    if (!t) return err(404, '工单不存在');
    return ok({ ticket: t });
  }

  // 列表: 支持 category / status / priority / q
  const category = url.searchParams.get('category') || '';
  const status = url.searchParams.get('status') || '';
  const priority = url.searchParams.get('priority') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);

  const where = [];
  const binds = [];
  if (category && CATEGORIES.has(category)) { where.push('t.category = ?'); binds.push(category); }
  if (status && STATUSES.has(status)) { where.push('t.status = ?'); binds.push(status); }
  if (priority && PRIORITIES.has(priority)) { where.push('t.priority = ?'); binds.push(priority); }
  if (q) { where.push('(t.title LIKE ? OR t.body LIKE ?)'); binds.push('%' + q + '%', '%' + q + '%'); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = await env.DB.prepare(
    `SELECT t.id, t.player_id, t.category, t.source_table, t.source_id, t.title,
            t.status, t.priority, t.assignee_id, t.created_at, t.updated_at, t.replied_at,
            p.username AS player_username, p.avatar_emoji, a.username AS assignee_username
     FROM tickets t
     LEFT JOIN players p ON p.id = t.player_id
     LEFT JOIN admins a ON a.id = t.assignee_id
     ${whereSql}
     ORDER BY
       CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       t.created_at DESC
     LIMIT ?`
  ).bind(...binds, limit).all();

  // 顺便给每个 category 算 open 数, 方便 tab badge
  const counts = await env.DB.prepare(
    `SELECT category, status, COUNT(*) AS n
     FROM tickets
     WHERE status IN ('open', 'in_progress')
     GROUP BY category, status`
  ).all();
  const summary = { total_open: 0, by_category: {} };
  for (const r of counts.results || []) {
    if (!summary.by_category[r.category]) summary.by_category[r.category] = { open: 0, in_progress: 0 };
    summary.by_category[r.category][r.status] = r.n;
    summary.total_open += r.n;
  }

  return ok({ tickets: rows.results || [], summary, limit });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');

  const body = await request.json().catch(() => ({}));
  const sets = [];
  const binds = [];
  if (body.status && STATUSES.has(body.status)) { sets.push('status = ?'); binds.push(body.status); }
  if (body.priority && PRIORITIES.has(body.priority)) { sets.push('priority = ?'); binds.push(body.priority); }
  if (body.assignee_id !== undefined) { sets.push('assignee_id = ?'); binds.push(body.assignee_id || null); }
  if (typeof body.admin_reply === 'string' && body.admin_reply.length > 0) {
    sets.push('admin_reply = ?'); binds.push(body.admin_reply);
    sets.push('replied_at = ?'); binds.push(new Date().toISOString());
    sets.push('replied_by = ?'); binds.push(admin.id);
    if (!body.status) { sets.push('status = ?'); binds.push('resolved'); }
  }
  if (!sets.length) return err(400, '没有可更新字段');
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const r = await env.DB.prepare(
    `UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...binds).run();
  if (!r.meta?.changes) return err(404, '工单不存在或无变化');
  return ok({ id, updated: true });
}

export async function onRequestPost(context) {
  // 玩家主动提交 service 类工单 (e.g. "我的密码忘了" / "我想反馈问题")
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '需要玩家登录');

  const body = await request.json().catch(() => ({}));
  const title = (body.title || '').trim();
  const bodyText = (body.body || '').trim();
  if (!title || !bodyText) return err(400, 'title/body 必填');
  if (title.length > 100) return err(400, 'title 不能超过 100 字');
  if (bodyText.length > 2000) return err(400, 'body 不能超过 2000 字');

  const priority = PRIORITIES.has(body.priority) ? body.priority : 'normal';

  const r = await env.DB.prepare(
    `INSERT INTO tickets (player_id, category, source_table, source_id, title, body, priority)
     VALUES (?, 'service', NULL, NULL, ?, ?, ?)`
  ).bind(sess.player_id, title, bodyText, priority).run();
  return ok({ id: r.meta?.last_row_id, created: true });
}
