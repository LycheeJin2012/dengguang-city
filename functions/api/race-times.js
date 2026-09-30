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
 * 把毫秒格式化成 m:ss.mmm。
 * 前端直接展示这份字符串，服务端也算一份，省得两端各写一遍。
 */
const format = (ms) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(
    ms % 1000
  ).padStart(3, '0')}`;

const LICENSE_GRADES = ['B', 'A', 'S'];

/**
 * GET /api/race-times —— 排行榜已下线，只保留「我自己的成绩」。
 * ?my=1 需要登录；不带参数直接 410，把人引到个人主页。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const url = new URL(c.request.url);
    if (url.searchParams.get('my') === '1') {
      const player = await identity(c);
      const result = await c.env.DB
        .prepare(
          'SELECT r.*,t.name AS track_name FROM race_times r LEFT JOIN race_tracks t ON t.id=r.track_id WHERE r.player_id=? ORDER BY r.id DESC LIMIT 100'
        )
        .bind(player.id)
        .all();
      return reply({
        times: result.results.map((row) => ({ ...row, formatted: format(row.time_ms) })),
      });
    }
    fail(410, '排行榜展示已移除，请在个人主页查看自己的成绩');
  });

/** POST /api/race-times —— 报一圈成绩。新记录一律未核验。 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const track = integer(input.track_id);
    // 圈速下限 1ms、上限 1 小时：挡住 0 和明显乱填的数。
    const time = integer(input.time_ms, '圈速', 1000, 3600000);
    const kart = string(input.kart_name ?? '', '车型', 60, { required: false });

    if (!LICENSE_GRADES.includes(input.license_grade)) fail(400, '驾照等级无效');

    const open = await c.env.DB
      .prepare('SELECT id FROM race_tracks WHERE id=? AND is_active=1')
      .bind(track)
      .first();
    if (!open) fail(404, '赛道未开放');

    const result = await c.env.DB
      .prepare(
        'INSERT INTO race_times(player_id,track_id,time_ms,kart_name,license_grade) VALUES(?,?,?,?,?)'
      )
      .bind(player.id, track, time, kart, input.license_grade)
      .run();

    return reply(
      { id: result.meta.last_row_id, formatted: format(time), verified: 0 },
      201
    );
  });

/** PATCH /api/race-times?id=&action=verify|unverify —— 管理员核验成绩。 */
export const onRequestPatch = (c) =>
  endpoint(async () => {
    await identity(c, 'admin');
    const url = new URL(c.request.url);
    const id = integer(url.searchParams.get('id'));
    const action = url.searchParams.get('action');
    if (!['verify', 'unverify'].includes(action)) fail(400, '操作无效');

    const result = await c.env.DB
      .prepare('UPDATE race_times SET verified=? WHERE id=?')
      .bind(action === 'verify' ? 1 : 0, id)
      .run();
    if (!result.meta.changes) fail(404, '成绩不存在');

    return reply({ id, verified: action === 'verify' ? 1 : 0 });
  });
