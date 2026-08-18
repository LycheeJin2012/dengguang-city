// v18 perf: 拆出高频公开端点 announcements-list
// 原本挂在 init.js, 启动 58K 大文件 + 30+ import, 每次 cold start 1.5s+
// 拆出来用极小 bundle, 加速公开公告读取
import { ok, err } from '../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  try {
    const rows = await env.DB.prepare(
      'SELECT a.*, ad.username as admin_username FROM announcements a LEFT JOIN admins ad ON ad.id = a.created_by ORDER BY a.created_at DESC LIMIT 30'
    ).all();
    return ok({ announcements: rows.results || [] });
  } catch (e) {
    return err(500, '查询失败: ' + e.message);
  }
}
