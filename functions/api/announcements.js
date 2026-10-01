import { endpoint, reply } from '../_core/request.js';

/**
 * GET /api/announcements —— 公开只读的公告列表，首页直接消费，不鉴权。
 *
 * 整条路由的行为就是下面这条 SELECT 的四个维度，任何一个被改动都直接影响首页：
 *
 *   字段集  id,title,content,image_url,created_at,updated_at —— 六个字面量，
 *           刻意**不** SELECT *：announcements 还有 created_by 与
 *           FOREIGN KEY 那套管理字段，* 会把内部字段一起发给匿名访客。
 *   排序    ORDER BY id DESC —— 按 id 倒序而不是 created_at DESC。
 *           公告可以补录和改时间，按时间排会突然把老公告顶到最前面。
 *   上限    LIMIT 100 —— 首页只渲染这一屏；全量拉既慢又会被塞满。
 *   只读    没有 WHERE 就没有任何状态依赖，空表时返回空数组而不是 404。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const { results } = await c.env.DB
      .prepare(
        'SELECT id,title,content,image_url,created_at,updated_at FROM announcements ORDER BY id DESC LIMIT 100'
      )
      .all();
    return reply({ announcements: results });
  });
