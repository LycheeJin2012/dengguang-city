import { autoDispatchSafely } from './dispatch.js';
import { linkedBusinessEvents } from './ticket-policy.js';
import { endpoint, identity, body, string, integer, fail, reply } from './request.js';

/** 四类报名各自落在哪张表 —— 报名与酒店预订共用这套 CRUD，只有表名和状态机不同 */
const tables = {
  kart: 'kart_signups',
  circuit: 'circuit_signups',
  license: 'license_signups',
  bookings: 'bookings',
};

/** 生成的工单归到哪个分类，前端按这个分类筛管理列表 */
const category = {
  kart: 'kart',
  circuit: 'race',
  license: 'license',
  bookings: 'hotel',
};

/**
 * 严格校验 YYYY-MM-DD。
 *
 * 光用正则不够：`2026-02-30` 能过正则，但 Date 会把它悄悄滚到 3 月 2 日。
 * 回写比对一次，才能把这种「看起来合法其实不存在」的日期挡掉。
 */
function date(value, key) {
  const s = string(value, key, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(+new Date(s)) || new Date(s).toISOString().slice(0, 10) !== s) {
    fail(400, `${key} 日期无效`);
  }
  return s;
}

/** 报名/预订的占位符串 */
function placeholders(n) {
  return Array(n).fill('?').join(',');
}

/**
 * 玩家侧的报名与预订。
 *
 * 扣费（国际试车）和建单必须原子：整个流程是**一条 db.batch**，
 * 靠 `changes()` 串联 —— 扣款成功才插报名，报名成功才建工单。
 * 任何一步没生效，后面全部不执行，不会出现「扣了钱没单子」。
 */
export function submissions(kind) {
  return (c) =>
    endpoint(async () => {
      const p = await identity(c);
      const { env, request } = c;
      const table = tables[kind];

      // ---- 读自己的报名 ----
      if (request.method === 'GET') {
        const rows = await env.DB
          .prepare(`SELECT * FROM ${table} WHERE player_id=? ORDER BY id DESC LIMIT 100`)
          .bind(p.id)
          .all();
        return reply({ [kind === 'bookings' ? 'bookings' : 'signups']: rows.results });
      }

      if (request.method !== 'POST') fail(405, '不支持此方法');

      const b = await body(request);
      const v = { player_id: p.id };

      // 预订叫「酒店预订」，其余三类是报名
      const label =
        kind === 'bookings' ? '酒店预订'
        : kind === 'license' ? '驾照报名'
        : kind === 'circuit' ? '国际试车'
        : '卡丁车报名';

      v.contact = string(b.contact, '联系方式', 200);
      v.note = string(b.note ?? '', '备注', 1000, { required: false });
      v.name = p.username; // 报名人一栏以账号名为准，不采信前端传值

      let cost = 0;

      // ---- 酒店预订 ----
      if (kind === 'bookings') {
        v.room_id = integer(b.room_id, '房型 ID');

        // 房型和酒店都得是开放状态，只查房型会漏掉「酒店已停业」的情况
        const r = await env.DB
          .prepare(
            'SELECT r.*,h.is_active AS hotel_active FROM hotel_rooms r JOIN hotels h ON h.id=r.hotel_id WHERE r.id=?'
          )
          .bind(v.room_id)
          .first();
        if (!r) fail(404, '房型不存在');
        if (!r.is_active || !r.hotel_active) fail(400, '房型暂未开放');

        v.room_name = r.name;
        v.in_date = date(b.in_date, '入住');
        v.out_date = date(b.out_date, '退房');
        v.nights = (new Date(v.out_date) - new Date(v.in_date)) / 86400000;
        if (v.nights < 1 || v.nights > 365) fail(400, '入住时长必须为 1–365 晚');

        // 按上海时区算「今天」—— 用 UTC 会在每天 08:00 前把当天当成昨天
        const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
        if (v.in_date < today) fail(400, '不能预订过去的日期');

        // 人数上限跟着房型容量走，所以 max 用 capacity 兜底
        v.persons = integer(b.persons ?? 1, '人数', 1, Math.min(6, r.capacity));
        v.breakfast = r.breakfast_included ? 1 : b.breakfast ? 1 : 0;
      }

      // ---- 驾照报名 ----
      else if (kind === 'license') {
        if (!['written', 'road', 'upgrade'].includes(b.exam_type)) fail(400, '考试类型无效');
        v.exam_type = b.exam_type;
        v.exam_date = b.exam_date ? date(b.exam_date, '考试') : null;
        v.exam_session = string(b.exam_session ?? '', '场次', 100, { required: false });

        // 同一类型只能有一个待审核的报名，避免重复占位
        if (
          await env.DB
            .prepare("SELECT id FROM license_signups WHERE player_id=? AND exam_type=? AND status='pending'")
            .bind(p.id, v.exam_type)
            .first()
        ) {
          fail(409, '你已有待审核的同类型报名');
        }
      }

      // ---- 卡丁车 / 国际试车 ----
      else {
        v.session = string(b.session ?? '', '场次', 100, { required: false });
        v.car = string(b.car ?? '', '车型', 100, { required: false });

        if (kind === 'circuit') {
          v.track_id = integer(b.track_id, '赛道');
          const t = await env.DB
            .prepare('SELECT * FROM race_tracks WHERE id=? AND is_active=1')
            .bind(v.track_id)
            .first();
          if (!t) fail(404, '赛道不存在或未开放');

          if (!['B', 'A', 'S'].includes(b.license)) fail(400, '驾照等级无效');
          v.license = b.license;

          // 试车要扣绿宝石，价格从赛道表读，前端传什么都不作数
          cost = integer(t.trial_price, '试车价格', 0);
          v.emeralds_charged = cost;
        }
      }

      const keys = Object.keys(v);
      const vals = Object.values(v);
      const statements = [];

      // 第一步：国际试车先扣费，且带 emeralds>=cost 条件，余额不够就一条都插不进去
      if (kind === 'circuit') {
        statements.push(
          env.DB.prepare('UPDATE players SET emeralds=emeralds-? WHERE id=? AND emeralds>=?').bind(cost, p.id, cost)
        );
      }

      // 第二步：写报名。三种表的安全策略不同：
      //   circuit —— 必须等扣款生效（changes()=1）才继续
      //   license —— 前面查过没有 pending，这里再用 NOT EXISTS 兜一道防并发
      //   其余   —— 直接 VALUES
      const selectFrom = 'SELECT ' + placeholders(keys.length) + ' WHERE ';
      const valuesClause = 'VALUES(' + placeholders(keys.length) + ')';
      const insertTail =
        kind === 'circuit' ? selectFrom + 'changes()=1'
        : kind === 'license' ? selectFrom + "NOT EXISTS(SELECT 1 FROM license_signups WHERE player_id=? AND exam_type=? AND status='pending')"
        : valuesClause;

      statements.push(
        env.DB.prepare(`INSERT INTO ${table}(${keys.join(',')}) ${insertTail}`).bind(
          ...vals,
          ...(kind === 'license' ? [p.id, v.exam_type] : [])
        )
      );

      // 第三步：报名成功才建工单，body 存整个 v 的 JSON，后台直接读得出上下文
      statements.push(
        env.DB
          .prepare(
            `INSERT INTO tickets(player_id,category,source_table,source_id,title,body)
             SELECT ?,?,?,last_insert_rowid(),?,? WHERE changes()=1`
          )
          .bind(
            p.id,
            category[kind],
            table,
            label + (v.room_name ? ' · ' + v.room_name : ''),
            JSON.stringify(v)
          )
      );

      const result = await env.DB.batch(statements);

      // 扣费那步没生效 = 余额不够。这里要在插报名之前就报出来，
      // 否则玩家会先看到「报名成功」再发现没扣到钱。
      if (kind === 'circuit' && !result[0].meta.changes) fail(402, '绿宝石余额不足');

      const primary = result[kind === 'circuit' ? 1 : 0];
      if (!primary.meta.changes) fail(409, '你已有待审核的同类型报名');

      const dispatch = await autoDispatchSafely(c, result.at(-1).meta.last_row_id);

      return reply(
        { id: primary.meta.last_row_id, nights: v.nights, emeralds_charged: cost, status: 'pending' },
        201
      );
    });
}

/**
 * 管理侧的报名/预订处理。
 *
 * 状态变更和工单状态、联动事件合成一次 batch：报名状态、工单状态、
 * 业务侧事件要么全变要么全不变。
 */
export function adminSubmissions(kind) {
  return (c) =>
    endpoint(async () => {
      await identity(c, 'admin');
      const { env, request } = c;
      const table = tables[kind];
      const url = new URL(request.url);

      // ---- 读全量（带玩家名，供后台列表显示）----
      if (request.method === 'GET') {
        const rows = await env.DB
          .prepare(
            `SELECT b.*,p.username AS player_username FROM ${table} b LEFT JOIN players p ON p.id=b.player_id ORDER BY b.id DESC LIMIT 500`
          )
          .all();
        return reply({ [kind === 'bookings' ? 'bookings' : 'signups']: rows.results });
      }

      const id = integer(url.searchParams.get('id'));
      const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
      if (!row) fail(404, '记录不存在');

      // 历史要留痕，所以只改状态，不给删除
      if (request.method === 'DELETE') fail(409, '请更新状态以保留历史记录');
      if (request.method !== 'PATCH') fail(405, '不支持此方法');

      const b = await body(request);
      const s = b.status || url.searchParams.get('status');

      // 三类报名的状态机各不相同
      const states =
        kind === 'bookings' ? ['pending', 'confirmed', 'completed', 'cancelled']
        : kind === 'license' ? ['pending', 'passed', 'failed']
        : ['pending', 'approved', 'rejected'];
      if (!states.includes(s)) fail(400, '状态无效');

      // 报名状态映射到工单状态。已分派且未办结的工单，在办结时退回「办理中」，
      // 避免分派过的工单一办结就直接消失。
      const ticketStatus =
        s === 'pending' ? 'open'
        : ['rejected', 'failed', 'cancelled'].includes(s) ? 'closed'
        : s === 'confirmed' || s === 'approved' ? 'in_progress'
        : 'resolved';

      await env.DB.batch([
        env.DB.prepare(`UPDATE ${table} SET status=? WHERE id=?`).bind(s, id),
        env.DB
          .prepare(
            `UPDATE tickets SET status=CASE WHEN assignee_id IS NOT NULL AND status!='resolved' AND ?='resolved' THEN 'in_progress' ELSE ? END,updated_at=datetime('now') WHERE source_table=? AND source_id=?`
          )
          .bind(ticketStatus, ticketStatus, table, id),
        ...(await linkedBusinessEvents(c, table, id, s)),
      ]);

      return reply({ id, status: s });
    });
}
