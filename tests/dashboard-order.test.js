// 守门：/api/admin/dashboard 的 JSON 键序必须是确定的。
//
// ── 缺陷 ────────────────────────────────────────────────────────────────
// dashboard.js 原来是这么拼结果的：
//
//   const result = {};
//   await Promise.all(
//     Object.entries(SECTIONS).map(async ([key, section]) => {
//       ... await db.prepare(...).all() ...
//       result[key] = tallyByState(...);        // ← 赋值发生在各自 promise 里
//     })
//   );
//
// `result[key] = …` 写在每个 async 回调内部，谁的查询先返回谁先被插入。
// JS 对象的键序对非数组下标的字符串键是**插入序**，而 JSON.stringify 按
// 插入序输出 —— 于是同一个接口、同样的数据，不同的数据库延迟就给出不同
// 的键序。
//
// 为什么要在意：功能上无害（消费方都是 result.bookings.pending 这样按名取值），
// 但它让响应无法做快照比对，也让任何基于 ETag / 响应哈希的缓存或监控出现
// 无意义的抖动。6 个 section 各自一条 SQL，先后顺序完全由 D1 的调度决定。
//
// 修法：并发照旧（保留 6 条查询同时跑的性能），但**收集**与**拼装**分开 ——
// 先把结果收进一个临时对象，再按 SECTIONS 的声明顺序重建 result。
//
// 附带把 tickets 那条也按同一顺序放好：它本来就是在 Promise.all 之后单独
// 赋值的，位置一直在最后，修完仍然是最后。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { database, dispatch } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';
import { hashPassword } from '../functions/_shared/auth.js';

const DB = database();
const env = { DB };
const SUPER = 'dash-super';

const SECTIONS = ['players', 'messages', 'bookings', 'license', 'circuit', 'kart'];

/** 每个 section 声明要展示的状态，与 dashboard.js 的 SECTIONS 一致 */
const STATES = {
  players: ['pending', 'active', 'rejected'],
  messages: ['unread', 'read', 'done'],
  bookings: ['pending', 'confirmed', 'completed', 'cancelled'],
  license: ['pending', 'passed', 'failed'],
  circuit: ['pending', 'approved', 'rejected'],
  kart: ['pending', 'approved', 'rejected'],
};

before(async () => {
  await ensureDatabase(DB);
  const { hash, salt } = await hashPassword('Dash-Order-9!');
  await DB.prepare(
    "INSERT INTO admins(id,username,password_hash,salt,role) VALUES(1,'super',?,?,'super')"
  ).bind(hash, salt).run();
  await DB.prepare(
    "INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES(?,NULL,1,'2099-01-01T00:00:00Z')"
  ).bind(SUPER).run();

  // 三个市民：两个 active，一个状态在 SECTIONS 声明之外（archived）
  for (const [id, name, status] of [[1, 'alice', 'active'], [2, 'bob', 'active'], [3, 'carol', 'archived']]) {
    await DB.prepare(
      "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds) VALUES(?,?,?,'x','x',?,0)"
    ).bind(id, name, name + '@example.invalid', status).run();
  }
  // 一条未读留言，且**没有**被开成工单镜像 → 算一件待办
  await DB.prepare(
    "INSERT INTO messages(id,player_id,name,contact,type,content,status) VALUES(1,2,'bob','bob@example.invalid','service','留言正文','unread')"
  ).run();
  // 一张 open 工单（独立工单，不是上面那条留言的镜像）
  await DB.prepare(
    "INSERT INTO tickets(id,player_id,category,title,status) VALUES(1,2,'service','测试工单','open')"
  ).run();

  // bookings / license_signups / circuit_signups / kart_signups 故意留空：
  // 空表也要走完「查询 → 零填充 → 拼装」整条路，键序照样得对。
  // （circuit/kart 两张表本来就没有 status 列，dashboard 恒为 0 —— 那是既有行为，不归这里管。）
});

after(() => {
  try {
    DB.close();
  } catch {
    // 幂等
  }
});

/**
 * 只取**顶层**的键，按出现顺序。
 *
 * 不能用 /"([a-z_]+)":/g 全局抓 —— 那会把 section 里的 pending/active/total
 * 和 tickets 里的 open 一并当成顶层键，还会漏掉 reply() 补在最前面的 ok。
 */
function topLevelKeys(raw) {
  const keys = [];
  let depth = 0;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '{' || ch === '[') {
      depth++;
      i++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      i++;
    } else if (ch === '"') {
      const start = i++;
      while (i < raw.length && !(raw[i] === '"' && raw[i - 1] !== '\\')) i++;
      const text = raw.slice(start, i + 1);
      i++;
      let j = i;
      while (raw[j] === ' ') j++;
      if (depth === 1 && raw[j] === ':') keys.push(JSON.parse(text));
    } else {
      i++;
    }
  }
  return keys;
}

/** 顶层键序 = ok + 6 个 section（声明序）+ tickets + errors + partial */
const EXPECTED_TOP = ['ok', ...SECTIONS, 'tickets', 'errors', 'partial'];

const fetchDashboard = async (envOverride) => {
  const response = await dispatch(
    new Request('https://local.test/api/admin/dashboard', {
      headers: { Cookie: `lc_session=${SUPER}` },
    }),
    envOverride || env
  );
  assert.equal(response.status, 200, '看板应当 200');
  // 刻意读**原始文本**而不是解析后的对象：只有原文能看出键序
  return response.text();
};

/**
 * 把 6 条 section 查询的**完成顺序**强行排成给定次序。
 *
 * 为什么要这个：缺陷只在「查询完成顺序 ≠ 声明顺序」时才显形，而真库上 6 条 SQL
 * 谁先返回由调度决定 —— 同一进程里通常恰好稳定，不稳定的那次未必碰得到，
 * 那样这条测试就永远绿着。闸门把「谁先 resolve」钉死：每个 section 的 all()
 * 等自己的闸门，闸门按 order 一个宏任务一个地放行，于是赋值顺序 === order。
 * pendingCount 那条 SQL 匹配不到表名正则，不受门控。
 */
function shuffledEnv(order, baseEnv = env) {
  const gates = new Map();
  for (const key of order) {
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    gates.set(key, { promise, resolve });
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  (async () => {
    for (const key of order) {
      await tick();
      gates.get(key).resolve();
    }
  })();

  return {
    ...baseEnv,
    DB: {
      prepare: (sql) => {
        const stmt = baseEnv.DB.prepare(sql);
        const table = String(sql).match(/FROM\s+(\w+)\s+GROUP BY\s+status/i)?.[1];
        const gate = gates.get(table);
        if (!gate) return stmt;
        return {
          all: async () => {
            await gate.promise;
            return stmt.all();
          },
          run: () => stmt.run(),
          first: (...a) => stmt.first(...a),
        };
      },
      batch: (items) => baseEnv.DB.batch(items),
    },
  };
}

// ── 1. 键序必须是 SECTIONS 的声明顺序 ──────────────────────────────────

test('顶层键序固定为 SECTIONS 声明顺序，tickets 在最后', async () => {
  // 特意用「后声明的先返回」这种顺序取一次 —— 旧写法下键序会跟着它乱
  const topLevel = topLevelKeys(await fetchDashboard(shuffledEnv([...SECTIONS].reverse())));
  assert.deepEqual(topLevel, EXPECTED_TOP, `顶层键序不对。实际：${JSON.stringify(topLevel)}`);
});

// ── 2. 完成顺序变了，响应也必须逐字节相同 ──────────────────────────────

test('6 种不同的查询完成顺序，响应必须逐字节相同', async () => {
  const rotations = [0, 1, 2, 3, 4, 5].map((r) => {
    const s = [...SECTIONS];
    return s.slice(r).concat(s.slice(0, r));
  });
  const first = await fetchDashboard(shuffledEnv(rotations[0]));
  for (let i = 1; i < rotations.length; i++) {
    const next = await fetchDashboard(shuffledEnv(rotations[i]));
    assert.equal(
      next,
      first,
      `完成顺序 ${rotations[i].join('>')} 下响应变了 —— 键序还在跟着查询完成顺序走`
    );
  }
});

// ── 3. values 不能因为改了拼装方式而丢失 ───────────────────────────────

test('每个 section 的 states 与 total 都在，数值和库里对得上', async () => {
  // 响应结构是**扁平**的：section 本身就是 { pending, active, …, total }，
  // 没有 counts 子对象 —— 前端 js/app/admin/shared.js 就是 data.kart.pending 这样取的。
  const data = JSON.parse(await fetchDashboard());
  for (const key of SECTIONS) {
    assert.ok(data[key], `section ${key} 丢了`);
    for (const state of STATES[key]) {
      assert.equal(typeof data[key][state], 'number', `${key}.${state} 应是数字`);
    }
    assert.equal(typeof data[key].total, 'number', `${key}.total 应是数字`);
  }
  assert.equal(data.players.active, 2, '两个 active 市民');
  assert.equal(data.players.pending, 0, '没有待审市民');
  assert.equal(data.players.total, 3, 'archived 也计入 total');
  assert.ok(!('archived' in data.players), '表外的状态不进 counts，但计入 total');
  assert.equal(data.messages.unread, 1);
  assert.equal(data.messages.total, 1);
  // 空表也要走完「查询 → 零填充」整条路
  for (const key of ['bookings', 'license', 'circuit', 'kart']) {
    assert.equal(data[key].total, 0, `${key} 是空表`);
  }
  assert.ok(data.tickets, 'tickets 必须在');
  assert.equal(data.tickets.open, 2, '1 张 open 工单 + 1 条没被开单的未读留言');
  assert.equal(data.partial, false, '没有查询失败，partial 应为 false');
  assert.deepEqual(data.errors, {}, '没有查询失败，errors 应为空');
});

// ── 4. 有查询失败时，errors 的键序也必须按声明序 ────────────────────────
//
// errors 是嵌套在响应里的另一个对象，它原来的键序同样来自完成顺序。
// 这条用**独立的第二个库**做：把两张表直接 DROP 掉，让那两块查询必然失败。
// 不能在主库上 drop —— 那会连带弄坏上面第 3 条。

test('两块查询失败时，errors 的键序仍是 SECTIONS 声明序', async () => {
  const DB2 = database();
  const env2 = { DB: DB2 };
  try {
    await ensureDatabase(DB2);
    const { hash, salt } = await hashPassword('Dash-Order-9!');
    await DB2.prepare(
      "INSERT INTO admins(id,username,password_hash,salt,role) VALUES(1,'super',?,?,'super')"
    ).bind(hash, salt).run();
    await DB2.prepare(
      "INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES(?,NULL,1,'2099-01-01T00:00:00Z')"
    ).bind(SUPER).run();
    // license 在 circuit 之前声明。让 license 失败得「晚」一点。
    await DB2.prepare('DROP TABLE license_signups').run();
    await DB2.prepare('DROP TABLE circuit_signups').run();

    const raw = await fetchDashboard(shuffledEnv([...SECTIONS].reverse(), env2));
    const data = JSON.parse(raw);

    assert.equal(data.license, null, '查不到就该是 null，不能拿 0 冒充');
    assert.equal(data.circuit, null, '查不到就该是 null，不能拿 0 冒充');
    assert.equal(data.players.total, 0, '没塞数据的库，其余 section 正常返回');
    assert.equal(data.partial, true, '有查询失败，partial 应为 true');

    // errors 的键序 = 声明序（license 在 circuit 前），不是完成序（circuit 先完成）
    assert.deepEqual(Object.keys(data.errors), ['license', 'circuit'], 'errors 键序跟着完成顺序走了');
    assert.equal(data.errors.license.code, 'STAT_QUERY_FAILED');
    assert.equal(data.errors.circuit.code, 'STAT_QUERY_FAILED');
    assert.ok(data.errors.license.detail, '失败详情应带上（只对已登录管理员可见）');
  } finally {
    try {
      DB2.close();
    } catch {
      // 幂等
    }
  }
});

// ── 5. 判据自检：旧写法（并发里直接赋值）确实不稳定 ─────────────────────

test('判据自检：把并发里直接赋值改成收集后重排，键序才会稳', () => {
  // 复刻两种拼装方式，对同一批「完成顺序」求键序
  const build = (order, rearrange) => {
    const collected = {};
    for (const key of order) collected[key] = { total: 1, counts: {} };
    if (!rearrange) return collected;
    const rebuilt = {};
    for (const key of SECTIONS) rebuilt[key] = collected[key];
    return rebuilt;
  };
  // 模拟一个「后声明的先返回」的完成顺序
  const shuffled = [...SECTIONS].reverse();

  const asIs = Object.keys(build(shuffled, false));
  const rearranged = Object.keys(build(shuffled, true));

  assert.notDeepEqual(asIs, SECTIONS, '前提：并发里直接赋值时，键序跟着完成顺序走');
  assert.deepEqual(rearranged, SECTIONS, '收集后按声明顺序重排 → 键序恒定');
});
