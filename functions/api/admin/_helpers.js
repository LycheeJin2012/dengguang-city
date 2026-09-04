// v50: admin 后台共享 helpers
// 统一 requireAdmin / requireSuper / 列表分页 / 字段过滤

import { err, getSession, readToken, stripHtml, rateLimit } from '../../_shared.js';

export async function requireAdmin(context) {
  const { env, request } = context;
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return { error: err(401, '需要管理员登录'), sess: null };
  const admin = await env.DB.prepare('SELECT id, username, role FROM admins WHERE id = ?')
    .bind(sess.admin_id).first();
  if (!admin) return { error: err(401, '管理员账号不存在或已删除'), sess: null };
  return { error: null, sess, admin };
}

export async function requireSuper(context) {
  const r = await requireAdmin(context);
  if (r.error) return r;
  if (r.admin.role !== 'super') return { error: err(403, '仅 super 管理员可操作'), sess: r.sess, admin: r.admin };
  return r;
}

// 通用 list 解析 (limit / offset / status / q)
export function parseListParams(request) {
  const url = new URL(request.url);
  return {
    limit: Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500),
    offset: Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0),
    status: url.searchParams.get('status') || '',
    q: (url.searchParams.get('q') || '').trim(),
  };
}

// 通用限流 (admin 操作加一道防护, 默认 60/min)
export function adminRateLimit(adminId, action = 'default') {
  return rateLimit(`admin:${adminId}:${action}`, 60, 60);
}

// 过滤 body: 只保留白名单字段, 自动 stripHtml
export function pickFields(body, allowed) {
  const out = {};
  for (const f of allowed) {
    if (body[f] !== undefined) {
      out[f] = typeof body[f] === 'string' ? stripHtml(body[f]) : body[f];
    }
  }
  return out;
}
