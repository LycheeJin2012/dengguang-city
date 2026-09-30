import { endpoint, identity, reply } from '../../_core/request.js';

/**
 * 后台酒店与房型总览（只读）。
 *
 * 两条独立的查询：房型挂在 hotels 下面，但房型列表本身是全量，
 * 不按 hotel_id 过滤 —— 后台要一眼看到所有酒店的房型配置。
 * 都按 id 升序，保证前端表格顺序稳定。
 */
export const onRequestGet = (context) =>
  endpoint(async () => {
    await identity(context, 'admin');

    const hotels = await context.env.DB.prepare('SELECT * FROM hotels ORDER BY id').all();
    const rooms = await context.env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY id').all();

    return reply({ hotels: hotels.results, rooms: rooms.results });
  });
