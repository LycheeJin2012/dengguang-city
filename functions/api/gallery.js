import { endpoint, reply, identity, fail } from '../_core/request.js';
import { resource } from '../_core/resources.js';

/** 图集允许的分类，公开读和管理端写用同一份清单 */
const CATEGORIES = ['city', 'road', 'kart', 'nature', 'announcement'];

/**
 * 公开图集列表。
 *
 * 三个可选筛选：
 *   ?all=1      —— 连未上架的一起看，只有超管能看
 *   ?cat=xxx    —— 分类过滤
 *   ?featured=1 —— 只看精选
 *
 * 排序固定 sort_order,id —— id 兜底是为了让 sort_order 相同时顺序稳定，
 * 否则分页会漏条目或重复。
 */
export const onRequestGet = (context) =>
  endpoint(async () => {
    const url = new URL(context.request.url);
    const all = url.searchParams.get('all') === '1';
    const category = url.searchParams.get('cat');

    if (all) await identity(context, 'super');
    if (category && !CATEGORIES.includes(category)) fail(400, '图集分类无效');

    const where = [];
    const args = [];
    if (!all) where.push('is_active=1');
    if (category) {
      where.push('cat=?');
      args.push(category);
    }
    if (url.searchParams.get('featured') === '1') where.push('is_featured=1');

    const rows = await context.env.DB
      .prepare(
        `SELECT id,num,title,caption,image_url,sort_order,cat,is_featured,is_active AS is_published,title AS label,image_url AS file_url FROM gallery_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sort_order,id LIMIT 200`
      )
      .bind(...args)
      .all();

    return reply({ items: rows.results });
  });

// 管理端增删改走统一资源层（校验规则、字段别名、历史引用保护都在 _core/resources.js）
export const onRequestPost = resource('gallery');
export const onRequestPatch = resource('gallery');
export const onRequestDelete = resource('gallery');
