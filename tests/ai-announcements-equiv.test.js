// api/ai-bot.js 与 api/announcements.js 的行为差分守门 —— 补上这两个路由的覆盖盲区。
//
// 背景：v88.7 把 functions/ 下 48 个严重压缩的文件还原成可读代码。_shared/ 的 8 个文件
// 由 tests/shared-equiv.test.js 兜着（14 个用例，真 ES256 + 真 PBKDF2），但 api/ 下这两个
// 路由此前**没有任何行为验证** —— 它们的 export 名单没人在意、SQL 没人比对，
// 于是「删掉一个 WHERE」「把 LIMIT 100 写成 LIMIT 1000」「把 ORDER BY id DESC 写成
// created_at DESC」这类改动可以悄无声息地合进去。
//
// 上一轮就翻过这种车：exam-sessions.js 的 action 白名单被兜底 return 吃掉，delete /
// SUBMIT / start 三个 action 从 400 变成 200，而 export 名单检查和 268 个测试全绿。
// 根因是**只验了「有没有变」，没验「变的是不是行为」**。所以这里不比对源码文本，
// 只比对真库上跑出来的**返回值 / 状态码 / 响应头 / 逐条 SQL / 全库快照**。
//
// 两个路由的真实行为面（读完源码后的结论，与工单里的初始描述有出入，见 AIMODEL_NOTE）：
//
//   ai-bot.js         onRequestGet → endpoint(identity → getOrCreateAiBot → reply)
//                    行为集中在 identity 的四道鉴权 + getOrCreateAiBot 的「查到/新建/
//                    撞 UNIQUE 重查/冒名顶替 503」五条分支。**它一次 fetch 都不发** ——
//                    工单里要求的「mock 模型覆盖成功/超时/非 JSON/null/输出超长」
//                    在这个文件上不成立，详见 AIMODEL_NOTE。
//
//   announcements.js 公开只读端点，行为面就是那条 SELECT 的四个维度：
//                    字段集、排序方向、LIMIT、空表。
//
// 基线从 git 动态提取（BASELINE），不依赖磁盘副本目录，干净 checkout 也能复现。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { database, dispatch } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';

const BASELINE = '06e9595';
const BOT_USERNAME = '灯灯客服';

// AIMODEL_NOTE
// 工单要求给 ai-bot.js 配模型桩，覆盖「成功 / 超时 / 非 JSON / null / 输出超长」五条分支。
// 读源码 + 查依赖图后的结论是：**这些分支不属于 ai-bot.js**。它的模块图是
//   api/ai-bot.js → _core/request.js → _shared/session.js
//                 → _shared/ai.js（这里只用到 getOrCreateAiBot）
// 整张图里唯一的 fetch 在 _shared/ai.js 的 aiDraft() 里，而 getOrCreateAiBot 根本不调它，
// ai-bot.js 也不 import 它。
// 所以这里不造假模型场景 —— 那只会得到「桩一次都没被调用」的假覆盖。改成**反着来**：
// 全程把 globalThis.fetch 换成会记账的陷阱，断言整个场景序列**一次都没调过**。
// 这比 mock 五个分支更强：它证明的是「这个端点不会碰模型」这个真正的约束。
// （_shared/ai.js 里 aiDraft 的模型分支仍无覆盖，但它不归本工单，且该文件本次未改动。）

// ---------------------------------------------------------------------------
// 基线副本的落盘
//
// 副本必须落回 functions/api/ 原位，它内部的 '../_core/request.js' 相对 import 才成立。
// 文件名必须与原模块不同：ESM 按绝对路径缓存，同名会让两版拿到同一个模块对象，
// 差分直接白做。清理时**只认本进程登记过的路径**，不去全仓库扫文件名匹配
// （有三个并发进程在跑，正则扫全仓库会把别人正在用的副本删掉）。
// ---------------------------------------------------------------------------

const ownedTmpFiles = new Set();
let tmpSeq = 0;

const show = (path) =>
  execSync(`git show ${BASELINE}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 28 });

async function loadBoth(path) {
  const dir = path.slice(0, path.lastIndexOf('/'));
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.js$/, '');
  const name = `.equiv-${process.pid}-${++tmpSeq}-${base}.mjs`;
  // 副本落回原目录（api/ 与 _shared/ 都一样），它内部的相对 import 才成立
  const rel = dir + '/' + name;
  // writeFileSync 相对 cwd（仓库根）；import() 相对本文件（tests/），所以加 '../'
  writeFileSync(rel, show(path));
  ownedTmpFiles.add(rel);
  const oldM = await import('../' + rel);
  const newM = await import('../' + path);
  return {
    oldM,
    newM,
    cleanup: () => {
      try { unlinkSync(rel); } catch {}
      ownedTmpFiles.delete(rel);
    },
  };
}

function cleanupTmpFiles() {
  for (const f of ownedTmpFiles) {
    try { unlinkSync(f); } catch {}
  }
  ownedTmpFiles.clear();
}
// 这里只清临时副本，不碰数据库 —— 见下面 seeded() 的注释。
process.on('exit', cleanupTmpFiles);

// ---------------------------------------------------------------------------
// 代理 DB：逐条记录 SQL 文本 + bind 参数
//
// 为什么要记 params：identity 查玩家、AI 查灯灯客服都靠 bind 进去的值，
// 把 '灯灯客服' 换成一个常量或拼错字，只比 SQL 字符串是看不出来的。
// 坑：Statement.first() 内部会调 all()，所以要包一层而不是直接透传，
// 否则一次 first() 会被记成两条，序列比对凭空多一项。
// ---------------------------------------------------------------------------

const normSql = (s) => String(s).replace(/\s+/g, ' ').trim();

function traceDb(DB, log) {
  const record = (st) => log.push({ sql: normSql(st.sql), params: st.params });
  const wrap = (st) => ({
    sql: st.sql,
    params: st.params,
    bind: (...p) => wrap(st.bind(...p)),
    all: () => { record(st); return st.all(); },
    run: () => { record(st); return st.run(); },
    first: (c) => { record(st); return st.first(c); },
  });
  return { prepare: (sql) => wrap(DB.prepare(sql)), batch: (items) => DB.batch(items) };
}

// ---------------------------------------------------------------------------
// 故障注入：只为把 getOrCreateAiBot 的 catch 分支跑出来
//
// 那条分支（INSERT 撞 UNIQUE → 重查一次）正常流程永远走不到：单进程里
// 「查到不存在」和「插入成功」之间没有窗口。真实的并发建号是另一个请求抢先插了。
// 这里用两个开关把这个窗口造出来：
//   hideSelects     —— 前 N 次查灯灯客服一律返回「查不到」（模拟自己慢了一拍）
//   uniqueOnInsert  —— INSERT 抛 UNIQUE（模拟别人抢先插了）
// 两个开关都按**场景序号**驱动，两版拿到完全一样的注入序列。
// ---------------------------------------------------------------------------

const BOT_WHERE = 'FROM players WHERE username = ?';
const BOT_INSERT = 'INSERT INTO players';

/**
 * 建号那条 INSERT 的第 3、4 个 bind 值是随机派生的 password_hash 与 salt
 * （getOrCreateAiBot 拿 crypto.getRandomValues 拼一个一次性密码去跑 PBKDF2）。
 * 两次运行必然不同，不抹掉就是五条恒定的假差异 —— 就是工单里点名的那个坑。
 *
 * 抹法仍然按长度：hash 恒 64 位 hex、salt 恒 32 位，所以两列写反照样会炸。
 * 快照那边还有 `<HEX32>` / `<HEX64>` 的交叉断言兜底，这里只是先滤掉噪音。
 */
function normalizeSqlLog(entries) {
  return entries.map((q) =>
    q.sql.includes(BOT_INSERT)
      ? {
          sql: q.sql,
          params: q.params.map((p, i) =>
            (i === 2 || i === 3) && typeof p === 'string' && /^[0-9a-f]+$/.test(p)
              ? `<HEX${p.length}>`
              : p
          ),
        }
      : q
  );
}

function faultDb(DB, log, fault) {
  const record = (st) => log.push({ sql: normSql(st.sql), params: st.params });
  const hideOnce = (st) => {
    if (fault.hideSelects > 0 && st.sql.includes(BOT_WHERE)) {
      fault.hideSelects--;
      return true;
    }
    return false;
  };
  const wrap = (st) => ({
    sql: st.sql,
    params: st.params,
    bind: (...p) => wrap(st.bind(...p)),
    all: () => {
      record(st);
      if (hideOnce(st)) return Promise.resolve({ results: [] });
      return st.all();
    },
    run: () => {
      record(st);
      if (fault.uniqueOnInsert && st.sql.includes(BOT_INSERT)) {
        return Promise.reject(new Error('UNIQUE constraint failed: players.username'));
      }
      return st.run();
    },
    first: (c) => {
      record(st);
      if (hideOnce(st)) return Promise.resolve(null);
      return st.first(c);
    },
  });
  return { prepare: (sql) => wrap(DB.prepare(sql)), batch: (items) => DB.batch(items) };
}

/**
 * 建一份全新的真库。
 *
 * close() 幂等，且每条用例都必须在 finally 里显式调它：database() 会 fork 一个
 * python3 SQLite 子进程（tests/sqlite-bridge.py），子进程不退 node 就不退，
 * test runner 永远等不到结束。只挂 process.on('exit') 兜底是没用的 —— 那个钩子
 * 要等进程即将退出才跑，而恰恰是这些活着的子进程阻止了退出，死锁。
 * 也不用 process.exit（会吞掉 TAP 输出，让通过/失败都看不见）。
 */
async function seeded() {
  const DB = database();
  await ensureDatabase(DB);
  const log = [];
  const fault = { hideSelects: 0, uniqueOnInsert: false };
  let closed = false;

  // 时间戳全部写死：库里大量列的默认值是 datetime('now')，两版各建一份库，
  // INSERT 时刻差几秒就会让全库快照对不上 —— 那种「差异」是假差异。
  const T = '2026-01-01 00:00:00';
  const FAR = '2099-01-01T00:00:00Z';
  const PAST = '2000-01-01T00:00:00Z';

  // 玩家：1 正常、2 已封禁（identity 会查 status='active'）。
  // 3 是**冒名顶替**的灯灯：username 与灯灯客服同名，但 game_id/email 都不是系统的。
  // 它一开始就在库里，所以场景 8 的首次建号必然撞 UNIQUE —— getOrCreateAiBot 的
  // catch 分支会被真自然地走到（不用故障注入），verifiedBot 必须把它拦下来报 503。
  // 这是防「有人改库把自己变成灯灯」的那道闸。
  await DB.prepare(
    "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds,created_at) VALUES(1,'citizen','c1@example.invalid','x','x','active',1000,?)"
  ).bind(T).run();
  await DB.prepare(
    "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds,created_at) VALUES(2,'banned','c2@example.invalid','x','x','banned',0,?)"
  ).bind(T).run();
  await DB.prepare(
    "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds,created_at) VALUES(3,'灯灯客服','impostor@example.invalid','x','x','active',7,?)"
  ).bind(T).run();

  // created_at 一律显式写死：admins / sessions 的默认值是 datetime('now')，
  // 两版各建一份库必然差一秒，那是一条恒定的假差异。
  await DB.prepare(
    "INSERT INTO admins(id,username,role,password_hash,salt,created_at) VALUES(1,'super','super','x','x',?)"
  ).bind(T).run();

  // 会话：五种身份，逐一对应 identity() 的一道闸。
  //   tok_player  正常市民
  //   tok_banned  已封禁玩家
  //   tok_admin   只有管理员身份（player_id 为 NULL）
  //   tok_expired 已过期
  //   tok_blank   expires_at 是空串（非法时间，getSession 当过期处理）
  //   tok_hotel   酒店老板身份：player_id 也是 NULL，验证它同样过不了「市民账号」那关
  const sessions = [
    ['tok_player', 1, null, FAR],
    ['tok_banned', 2, null, FAR],
    ['tok_admin', null, 1, FAR],
    ['tok_expired', 1, null, PAST],
    ['tok_blank', 1, null, ''],
  ];
  for (const [token, player, admin, expires] of sessions) {
    await DB.prepare("INSERT INTO sessions(token,player_id,admin_id,expires_at,created_at) VALUES(?,?,?,?,?)")
      .bind(token, player, admin, expires, T).run();
  }
  await DB.prepare("INSERT INTO sessions(token,player_id,admin_id,hotel_owner_id,expires_at,created_at) VALUES(?,?,?,?,?,?)")
    .bind('tok_hotel', null, null, 1, FAR, T).run();

  // 另一张业务表也放点数据：快照里不能只有本路由碰过的表，否则「别的地方被误改」看不出来。
  await DB.prepare(
    "INSERT INTO announcements(id,title,content,created_by,created_at,updated_at) VALUES(1,'基线公告','这条从头到尾都在，验证只读端点没删改任何东西。',1,?,?)"
  ).bind(T, T).run();
  await DB.prepare(
    "INSERT INTO tickets(id,player_id,category,source_table,title,body,status,created_at,updated_at) VALUES(1,1,'appeal',NULL,'路灯损坏申请','路灯不亮','open',?,?)"
  ).bind(T, T).run();

  return {
    DB,
    log,
    fault,
    /** 带故障注入的 env，ai-bot 的竞态场景用 */
    env: { DB: faultDb(DB, log, fault) },
    close: () => {
      if (closed) return;
      closed = true;
      try { DB.close(); } catch {}
    },
  };
}

// ---------------------------------------------------------------------------
// 全库快照：所有表的所有行
//
// 排除 lc_schema_versions：它的 applied_at 默认 CURRENT_TIMESTAMP，两版各建一次库
// 必然差几秒，是假差异；改成只比 version 号，schema 是否真的建齐照样能查出来。
// 行在 JS 里按 JSON 排序而不是靠 SQL ORDER BY —— 免得碰上 WITHOUT ROWID 表和
// 混合类型排序的坑。
// ---------------------------------------------------------------------------

async function snapshotAll(DB) {
  const names = (await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all()).results.map((r) => r.name);
  const snap = {};
  for (const name of names) {
    if (name === 'lc_schema_versions') continue;
    const rows = (await DB.prepare(`SELECT * FROM "${name}"`).all()).results;
    snap[name] = rows.map((r) => JSON.stringify(r)).sort();
  }
  snap.__schema_versions__ = (await DB.prepare('SELECT version FROM lc_schema_versions ORDER BY version').all())
    .results.map((r) => r.version);
  return snap;
}

/**
 * 抹掉**必然**随运行变化的值，否则每跑一次就是一条假差异。
 *
 * 两类来源：
 *
 * 1. 灯灯客服是**运行时自动插入**的：password_hash / salt 来自
 *    crypto.getRandomValues()，created_at 来自 datetime('now')。
 *    抹的时候不是整列置空，而是**按长度归一**：hash 恒为 64 位 hex、salt 恒为 32 位。
 *    于是「INSERT 的 bind 顺序被写反，hash 落进 salt 列」这种改动照样会炸
 *    （<HEX64> ≠ <HEX32>），既去掉假差异又没放过真差异。
 *    判定条件用 game_id/email 而不是用户名：场景里会把冒名顶替那行删掉再重建，
 *    按名字过滤在某些状态下会漏判，salt 就变成一条假差异。
 *
 * 2. **迁移脚本自己插进去的行**（dispatch_settings 等）带着
 *    `DEFAULT datetime('now')` 的时间列。ensureDatabase() 在两版里各跑一次，
 *    两次建库只要跨过一个整秒就必然对不上 —— 而且这不是低概率：30 个测试文件并发跑时，
 *    整个机器被 python3 SQLite 子进程压满，两次建库相隔一秒是常事。
 *    实测过：并发下 lc_schema_versions 之外的表也会这么炸。
 *    所以这里对**任何**「长得像 datetime('now') 且落在本次运行时间窗内」的值统一换成
 *    <NOW>。判定带时间窗，本文件里写死的历史/未来 fixture（2026-01-01 / 2000 / 2099）
 *    永远不在窗内，绝不会被误抹。
 */
const RUN_START_MS = Date.now();
const VOLATILE_FROM_MS = RUN_START_MS - 120_000;   // 往回 2 分钟，兜住时钟微调
const VOLATILE_TO_MS = RUN_START_MS + 900_000;     // 往未来延 15 分钟
const SQLITE_DT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** SQLite 的 datetime('now') 是 UTC，别用本地时区解析 */
function isVolatileTimestamp(v) {
  if (typeof v !== 'string' || !SQLITE_DT.test(v)) return false;
  const t = Date.parse(v.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) && t >= VOLATILE_FROM_MS && t <= VOLATILE_TO_MS;
}

function normalizeSnapshot(snap) {
  for (const [table, rows] of Object.entries(snap)) {
    if (table.startsWith('__')) continue;
    snap[table] = rows.map((json) => {
      const row = JSON.parse(json);
      let changed = false;
      for (const [col, v] of Object.entries(row)) {
        if (isVolatileTimestamp(v)) { row[col] = '<NOW>'; changed = true; }
      }
      if (row.game_id === 'AI_BOT' || row.email === 'ai-bot@system.local') {
        for (const col of ['password_hash', 'salt']) {
          if (typeof row[col] === 'string') {
            row[col] = `<HEX${row[col].length}>`;
            changed = true;
          }
        }
        if (typeof row.created_at === 'string') { row.created_at = '<NOW>'; changed = true; }
      }
      return changed ? JSON.stringify(row) : json;
    }).sort();
  }
  return snap;
}

// ---------------------------------------------------------------------------
// 差异定位：首个不同的叶子路径 + 截断后的两值，用来把差异说人话
// ---------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object';
const brief = (v) => {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 160 ? s.slice(0, 160) + '…' : s;
};

function firstDiff(a, b, path = '') {
  if (Object.is(a, b)) return null;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return `${path || '<root>'}: 类型 ${ta} ≠ ${tb}`;
  // 数组和对象都要往下递归 —— 只比长度不够，得逐个元素比
  if (!isObj(a)) return `${path || '<root>'}: ${brief(a)} ≠ ${brief(b)}`;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    if (!(k in a)) return `${path}.${k}: 新版多出 ${brief(b[k])}`;
    if (!(k in b)) return `${path}.${k}: 新版缺少 ${brief(a[k])}`;
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 场景执行装置
// ---------------------------------------------------------------------------

/** 响应全部可比对的部分：状态码、头、原始 body 文本（不 parse，保留字面量） */
async function readResponse(r) {
  return {
    status: r.status,
    headers: Object.fromEntries([...r.headers.entries()].sort()),
    body: await r.text(),
  };
}

function makeContext(env, token, path) {
  return {
    request: new Request('https://local.test' + path, {
      method: 'GET',
      headers: token === null ? {} : { Cookie: 'lc_session=' + token },
    }),
    env,
    params: {},
    waitUntil: (p) => p.catch(() => {}),
    next: async () => new Response(null, { status: 404 }),
  };
}

/**
 * fetch 陷阱：记账且永不真发网络请求。
 *
 * 这个文件里**不应该有任何一次 fetch**（见 AIMODEL_NOTE）。这里把它换成会抛异常的
 * 陷阱而不是空实现：万一重写时不小心在路由里加了一次模型调用，场景会当场炸，
 * 而不是悄悄走出去真的连了网。
 */
function fetchTrap(calls) {
  return async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    throw new Error('测试桩：ai-bot / announcements 不应发起任何网络请求');
  };
}

async function callRoute(mod, handlerName, env, token, path) {
  try {
    const r = await mod[handlerName](makeContext(env, token, path));
    return { threw: false, response: await readResponse(r) };
  } catch (e) {
    // endpoint() 会把几乎所有异常翻成 JSON，所以走到这里说明是 endpoint 之外的炸法，
    // 照样记下来比对 —— 两边炸法不同也是回归。
    return { threw: true, error: String(e && e.message) };
  }
}

// ===========================================================================
// ai-bot 场景序列
//
// 刻意按「鉴权 → 判据 → 建号 → 复用 → 篡改 → 竞态」的顺序排：
// 前面的场景会把状态改掉（建号、删会话、篡改判据），后面的场景依赖那个状态。
// 两版必须从同一个起点、走过同一条路径；乱序就等于各跑各的，差分失去意义。
//
// seeded() 里预置了一个**冒名顶替**的「灯灯客服」（id=3，game_id/email 都不是系统的），
// 于是开箱就有的这几条：
//   - 9~12  把 verifiedBot 的三个判据逐个单独打掉，最后三判据全中 → 放行。
//           顺序是「修好前一个、再打掉后一个」，所以每一次失败都只归因于一个判据，
//           少判一个判据的话，12 就会挂在它本该过的地方。
//   - 13    删掉冒名顶替者，SELECT 查不到 → 真走一次 INSERT 建号（含真 PBKDF2）。
// ===========================================================================

const AI_SCENARIOS = [
  // --- identity() 的四道鉴权 ---
  { label: '不带任何 token → 401 请先登录', token: null },
  { label: '库里查不到的 token → 401 请先登录', token: 'tok_nonexistent' },
  // 过期会话：getSession 会顺手把行删掉。快照里 sessions 因此会少两行 ——
  // 「过期即删」这条逻辑被改成不删，快照就会炸。
  { label: '过期会话 → 401，且过期行被顺手删除', token: 'tok_expired' },
  // expires_at 是空串 → +new Date('') 是 NaN → 走同一条过期分支
  { label: 'expires_at 非法（空串）→ 401，且该行被删除', token: 'tok_blank' },
  { label: '只有管理员身份（player_id 为 NULL）→ 401 需要市民账号', token: 'tok_admin' },
  { label: '只有酒店老板身份（player_id 也是 NULL）→ 401 需要市民账号', token: 'tok_hotel' },
  { label: '玩家已封禁 → 401 账号未激活或已停用', token: 'tok_banned' },
  // 库里没 DB：identity 第一行就 503。**在 getOrCreateAiBot 之前**，
  // 所以这一条不会碰灯灯账号 —— 顺序调换的话后面建号场景就测不到东西了。
  { label: 'env.DB 缺失 → 503 数据库尚未连接', token: 'tok_player', env: 'noDb' },

  // --- verifiedBot() 的三个判据，逐个打掉 ---
  {
    label: '库里的「灯灯客服」是冒名顶替的（game_id 不符）→ 503 需超管核实',
    token: 'tok_player',
    note: 'seeded() 预置，username 相同但 system 身份对不上',
  },
  {
    label: '补上 game_id 但 email 仍不符 → 503',
    token: 'tok_player',
    mutate: (DB) => DB.prepare("UPDATE players SET game_id='AI_BOT' WHERE id=3").run(),
  },
  {
    label: '补上 email 但 status 被改成 banned → 503',
    token: 'tok_player',
    mutate: (DB) => DB.prepare("UPDATE players SET status='banned' WHERE id=3").run(),
  },
  {
    label: '三个判据全中 → 放行 200（证明判据就是这三个，不多不少）',
    token: 'tok_player',
    mutate: (DB) => DB.prepare(
      "UPDATE players SET email='ai-bot@system.local', status='active' WHERE id=3"
    ).run(),
  },

  // --- 建号与复用 ---
  {
    label: '删掉冒名顶替者 → SELECT 查不到，真走一次 INSERT 建号',
    token: 'tok_player',
    mutate: (DB) => DB.prepare('DELETE FROM players WHERE id=3').run(),
    note: '含真 PBKDF2 100000 次派生',
  },
  { label: '再次访问：复用已建好的号，**不再 INSERT**', token: 'tok_player' },

  // --- 对真灯灯逐个篡改：验证三个判据对新建的号同样生效 ---
  {
    label: '真灯灯的 game_id 被改 → 503',
    token: 'tok_player',
    mutate: (DB) => DB.prepare("UPDATE players SET game_id='HUMAN' WHERE email='ai-bot@system.local'").run(),
  },
  {
    label: '真灯灯的 email 被改 → 503',
    token: 'tok_player',
    mutate: (DB) => DB.prepare("UPDATE players SET game_id='AI_BOT', email='bot@example.invalid' WHERE id>3").run(),
  },
  {
    label: '真灯灯的 status 被改 banned → 503',
    token: 'tok_player',
    mutate: (DB) => DB.prepare("UPDATE players SET email='ai-bot@system.local', status='banned' WHERE id>3").run(),
  },
  {
    // 三条判据都被打掉过一轮，这里把 email / status 一起恢复。
    // 注意 status 必须在这里复位：上一条刚把它改成 banned。
    label: '三项全部恢复 → 200',
    token: 'tok_player',
    mutate: (DB) => DB.prepare(
      "UPDATE players SET email='ai-bot@system.local', status='active' WHERE id>3"
    ).run(),
  },

  // --- 认名字而不是认 id，以及撞唯一约束的真实后果 ---
  {
    // 实测行为：改名之后按名字确实查不到，于是去 INSERT 新号 —— 但 players.email
    // 有唯一约束，旧行还占着 ai-bot@system.local，于是撞 UNIQUE → 409。
    // 「改名就能换一个灯灯」是不成立的，这一条把这个事实钉住。
    label: '灯灯客服被改用户名 → 按名字查不到，建号撞 email 唯一约束 → 409',
    token: 'tok_player',
    mutate: (DB) => DB.prepare("UPDATE players SET username='灯灯客服改名了' WHERE email='ai-bot@system.local'").run(),
  },
  {
    label: '把用户名改回去 → 又能查到，200',
    token: 'tok_player',
    mutate: (DB) => DB.prepare("UPDATE players SET username='灯灯客服' WHERE email='ai-bot@system.local'").run(),
  },

  // --- catch 分支：单进程正常流程走不到，用故障注入把并发窗口造出来 ---
  {
    label: '并发建号（自己慢一拍 + INSERT 撞 UNIQUE）→ 重查拿到已有行，200',
    token: 'tok_player',
    fault: { hideSelects: 1, uniqueOnInsert: true },
  },
  {
    // UNIQUE 撞了但重查也查不到 → 原样抛出 → endpoint 认得 /UNIQUE constraint/i → 409。
    // 这条同时锁住了 endpoint 的 409 映射。
    label: '并发建号（INSERT 撞 UNIQUE 且重查为空）→ 409 该记录已存在，请勿重复提交',
    token: 'tok_player',
    mutate: (DB) => DB.prepare("DELETE FROM players WHERE game_id='AI_BOT'").run(),
    fault: { uniqueOnInsert: true },
  },
  { label: '恢复后再次访问 → 重新建号成功，200', token: 'tok_player' },
];

async function runAiScenario(mod, f, sc) {
  if (sc.mutate) await sc.mutate(f.DB);
  if (sc.fault) Object.assign(f.fault, sc.fault);
  else { f.fault.hideSelects = 0; f.fault.uniqueOnInsert = false; }

  const env = sc.env === 'noDb' ? {} : f.env;
  const before = f.log.length;
  const out = await callRoute(mod, 'onRequestGet', env, sc.token, '/api/ai-bot');
  return {
    label: sc.label,
    token: sc.token ?? null,
    outcome: out,
    sql: normalizeSqlLog(f.log.slice(before)),
  };
}

async function runAiAll(mod) {
  const f = await seeded();
  const fetchCalls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = fetchTrap(fetchCalls);
  try {
    const steps = [];
    for (const sc of AI_SCENARIOS) steps.push(await runAiScenario(mod, f, sc));
    // 每个场景开头都会重置故障开关，最后一条也没开故障，所以这里直接取快照即可。
    return { steps, snap: normalizeSnapshot(await snapshotAll(f.DB)), fetchCalls: fetchCalls.length };
  } finally {
    globalThis.fetch = prevFetch;
    f.close();
  }
}

// ===========================================================================
// announcements 场景序列
//
// 行为面就是那条 SELECT 的四个维度：字段集、排序方向、LIMIT、空表。
// 场景按「空表 → 少量 → 带 NULL → 删缺口 → 破 LIMIT → 再破 LIMIT → 回空表」推进，
// 每一步都在**同一个库**上继续，让 LIMIT 100 这个数字真的被顶到。
// ===========================================================================

const ANN_INSERT = 'INSERT INTO announcements(id,title,content,image_url,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)';

const ANN_SCENARIOS = [
  {
    label: '空表：返回 ok:true 与空数组',
    note: '先删掉 seeded() 放的那条基线公告，制造真正的空表',
    mutate: (DB) => DB.prepare('DELETE FROM announcements').run(),
  },

  {
    label: '3 条公告：按 id DESC 排序，中文/表情/换行逐字保留',
    // created_at 故意与 id **反向**排：id=1 的时间最新。
    // 这样「ORDER BY id DESC」和「ORDER BY created_at DESC」会给出两种不同顺序，
    // 只看「返回了 3 条」发现不了排序被改。
    mutate: async (DB) => {
      // created_by 必须绑 admins(id)=1（外键），所以时间戳单独放最后一位。
      const rows = [
        [1, '东门施工维护通知', '东门施工预计于本月末恢复，恢复前请注意绕行。', 'https://img.invalid/a.png', '2026-03-03 00:00:00'],
        [2, '广场嘉年华预告', '本周六中央广场举办嘉年华活动。\n欢迎参加！', null, '2026-03-02 00:00:00'],
        [3, '灯塔点灯仪式 🎉', '今晚八点灯塔亮灯，记得抬头看。', 'https://img.invalid/c.png', '2026-03-01 00:00:00'],
      ];
      for (const [id, title, content, image, created] of rows) {
        await DB.prepare(ANN_INSERT).bind(id, title, content, image, 1, created, null).run();
      }
    },
  },

  {
    label: 'image_url 与 updated_at 为 NULL：null 原样返回，不被吞成空串',
    note: '只看条数看不出这个，必须逐字段比',
    mutate: async (DB) => {
      await DB.prepare(ANN_INSERT)
        .bind(4, '无图无更新时间', '正文在，但两个可选列都是空。', null, 1, '2026-02-01 00:00:00', null)
        .run();
    },
  },

  {
    label: '删掉中间一条(id=2)：排序仍按 id DESC，缺口不影响结果',
    mutate: (DB) => DB.prepare('DELETE FROM announcements WHERE id=2').run(),
  },

  {
    label: '总数堆到 105：只返回 id 最大的 100 条（LIMIT 100 真的被顶到了）',
    // 关键设计：必须**超过** 100 条。总共 105 条时，
    // LIMIT 100 / LIMIT 1000 / 不写 LIMIT 会分别给出 100 / 105 / 105 条 ——
    // 上限被删或被改大都会立刻暴露。若只有 20 条，这三种写法结果完全一样，测试就是假绿。
    mutate: async (DB) => {
      for (let i = 5; i <= 105; i++) {
        await DB.prepare(ANN_INSERT)
          .bind(i, `公告 ${i}`, `第 ${i} 条公告的正文内容。`, i % 2 === 0 ? null : `https://img.invalid/${i}.png`, 1, '2026-01-01 00:00:00', null)
          .run();
      }
    },
  },

  {
    label: '继续堆到 110：窗口向前滑动，仍只返回 100 条且是最新的一批',
    mutate: async (DB) => {
      for (let i = 106; i <= 110; i++) {
        await DB.prepare(ANN_INSERT)
          .bind(i, `公告 ${i}`, `第 ${i} 条公告的正文内容。`, null, 1, '2026-01-01 00:00:00', null)
          .run();
      }
    },
  },

  {
    label: '全表清空后：再次回到空数组',
    note: '再跑一遍空表分支，确认不是只对第一次空表成立',
    mutate: (DB) => DB.prepare('DELETE FROM announcements').run(),
  },
];

async function runAnnScenario(mod, f, sc) {
  if (sc.mutate) await sc.mutate(f.DB);
  const before = f.log.length;
  const out = await callRoute(mod, 'onRequestGet', f.env, null, '/api/announcements');
  return { label: sc.label, outcome: out, sql: f.log.slice(before) };
}

async function runAnnAll(mod) {
  const f = await seeded();
  const fetchCalls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = fetchTrap(fetchCalls);
  try {
    const steps = [];
    for (const sc of ANN_SCENARIOS) steps.push(await runAnnScenario(mod, f, sc));
    return { steps, snap: normalizeSnapshot(await snapshotAll(f.DB)), fetchCalls: fetchCalls.length };
  } finally {
    globalThis.fetch = prevFetch;
    f.close();
  }
}

// ===========================================================================
// 用例 1：ai-bot 行为差分
// ===========================================================================

test(`ai-bot：${AI_SCENARIOS.length} 组场景在真库上逐场景一致（状态码/响应体/响应头/逐条 SQL/全库快照）`, async () => {
  const { oldM, newM, cleanup } = await loadBoth('functions/api/ai-bot.js');
  try {
    const a = await runAiAll(oldM);
    const b = await runAiAll(newM);

    assert.equal(b.steps.length, a.steps.length, '场景条数必须一致');
    const diffs = [];
    for (let i = 0; i < a.steps.length; i++) {
      assert.equal(b.steps[i].label, a.steps[i].label, `第 ${i} 条场景顺序不一致`);
      for (const field of ['outcome', 'sql']) {
        const d = firstDiff(b.steps[i][field], a.steps[i][field], `${a.steps[i].label}.${field}`);
        if (d) diffs.push(d);
      }
    }
    const d = firstDiff(b.snap, a.snap, '全库快照');
    if (d) diffs.push(d);
    assert.deepEqual(diffs, [], diffs.join('\n'));

    // --- 防假绿：必须证明主链路真的被走到了 ---
    const codes = a.steps.map((s) => s.outcome.response.status);
    const bodies = a.steps.map((s) => {
      try { return JSON.parse(s.outcome.response.body); } catch { return null; }
    });
    const sqlAll = a.steps.flatMap((s) => s.sql);
    const stats = {
      场景数: a.steps.length,
      状态码分布: codes.reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {}),
      SQL条数: sqlAll.length,
      建号INSERT: sqlAll.filter((q) => q.sql.includes(BOT_INSERT)).length,
      网络请求: a.fetchCalls,
      逐条: a.steps.map((s, i) => `${i}:${s.outcome.response.status}`).join(' '),
    };

    assert.equal(a.steps.length, 23, `场景数退化了：${JSON.stringify(stats)}`);
    assert.ok(stats.SQL条数 >= 60, `只发了 ${stats.SQL条数} 条 SQL，fixture 很可能没建起来：${JSON.stringify(stats)}`);

    // identity 的三种 401 文案各至少出现一次，外加数据库未连接的 503
    for (const want of ['请先登录', '需要市民账号', '账号未激活或已停用', '数据库尚未连接']) {
      assert.ok(bodies.some((x) => x && x.error === want), `没有场景返回「${want}」：${JSON.stringify(bodies.map((x) => x && x.error))}`);
    }
    // 冒名顶装：三个判据对冒名顶替者各一次、对真灯灯各一次 = 6 次 503，
    // 外加 noDB 那次共 7 次 503。
    const tampered = a.steps.filter(
      (s) => s.outcome.response.status === 503 && /超管核实/.test(s.outcome.response.body)
    );
    assert.equal(tampered.length, 6, `冒名顶装应被拦 6 次（三个判据各两次），实际 ${tampered.length}：${JSON.stringify(stats)}`);
    // 200 且 username 是灯灯客服：判据全中 + 建号 + 复用 + 恢复 + 改回名 + 竞态 + 重建
    const okCount = bodies.filter((x) => x && x.ok === true && x.username === BOT_USERNAME).length;
    assert.equal(okCount, 7, `返回灯灯客服的 200 应为 7 次，实际 ${okCount}：${JSON.stringify(stats)}`);
    // 真建号只发生 2 次（首次建号 + 409 之后重建）；另外 3 次 INSERT 都撞了 UNIQUE，
    // 那正是「撞了就不该真的插进去」的证据 —— 插进去了会多出一行假灯灯。
    assert.equal(stats.建号INSERT, 5, `INSERT players 尝试次数不对：${JSON.stringify(stats)}`);
    // 两条 409：改名撞 email 唯一约束、竞态重查为空
    assert.equal(codes.filter((c) => c === 409).length, 2, `409 应为 2 次：${JSON.stringify(stats)}`);
    assert.ok(
      bodies.some((x) => x && x.error === '该记录已存在，请勿重复提交'),
      `没有场景返回 409 的中文文案：${JSON.stringify(bodies.map((x) => x && x.error))}`
    );

    // 过期会话被顺手删除：sessions 表必须从 6 行掉到 4 行
    const sessions = JSON.parse('[' + a.snap.sessions.join(',') + ']');
    assert.equal(sessions.length, 4, `过期/非法会话应被删掉 2 条，实际剩 ${sessions.length} 条`);
    assert.deepEqual(sessions.map((s) => s.token).sort(), ['tok_admin', 'tok_banned', 'tok_hotel', 'tok_player']);

    // --- 抓「建号时 bind 顺序写反」这类只在自动建号行上显形的改动 ---
    const botRows = JSON.parse('[' + a.snap.players.join(',') + ']')
      .filter((r) => r.game_id === 'AI_BOT' && r.email === 'ai-bot@system.local');
    assert.equal(botRows.length, 1, `最终应只剩 1 个真正的灯灯客服，实际 ${botRows.length}：${JSON.stringify(botRows)}`);
    // hashPassword 生成的是 16 字节 salt（32 hex）与 32 字节 SHA-256（64 hex）。
    // 归一化是按长度做的，所以两列写反会在这里现形。
    assert.equal(botRows[0].salt, '<HEX32>', `salt 长度不对：${JSON.stringify(botRows[0])}`);
    assert.equal(botRows[0].password_hash, '<HEX64>', `hash 长度不对：${JSON.stringify(botRows[0])}`);
    assert.equal(botRows[0].created_at, '<NOW>', `created_at 应当是被归一化的 datetime('now')：${JSON.stringify(botRows[0])}`);
    // INSERT 的 7 个 bind 值顺序（username/email/hash/salt/game_id/bio/emoji）逐字锁住
    assert.equal(botRows[0].username, BOT_USERNAME);
    assert.equal(botRows[0].email, 'ai-bot@system.local');
    assert.equal(botRows[0].status, 'active');
    assert.equal(botRows[0].bio, '我是自动客服灯灯，可为你提供基础指引并转交人工核实。');
    assert.equal(botRows[0].avatar_emoji, '🤖');
    // 冒名顶替者与被改名的旧行都应已被清掉，玩家表不该留下垃圾
    const playerNames = JSON.parse('[' + a.snap.players.join(',') + ']').map((r) => r.username).sort();
    assert.deepEqual(playerNames, ['banned', 'citizen', BOT_USERNAME].sort(), `玩家表残留异常：${playerNames}`);

    // --- 抓「路由里多发一次 fetch」：这个端点不该碰模型 ---
    assert.equal(a.fetchCalls, 0, `ai-bot 发了 ${a.fetchCalls} 次网络请求，它本该一次都不发`);
    assert.equal(b.fetchCalls, 0, `新版 ai-bot 发了 ${b.fetchCalls} 次网络请求`);
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 用例 2：announcements 行为差分
// ===========================================================================

test(`announcements：${ANN_SCENARIOS.length} 组场景在真库上逐场景一致（状态码/响应体/响应头/逐条 SQL/全库快照）`, async () => {
  const { oldM, newM, cleanup } = await loadBoth('functions/api/announcements.js');
  try {
    const a = await runAnnAll(oldM);
    const b = await runAnnAll(newM);

    assert.equal(b.steps.length, a.steps.length, '场景条数必须一致');
    const diffs = [];
    for (let i = 0; i < a.steps.length; i++) {
      assert.equal(b.steps[i].label, a.steps[i].label, `第 ${i} 条场景顺序不一致`);
      for (const field of ['outcome', 'sql']) {
        const d = firstDiff(b.steps[i][field], a.steps[i][field], `${a.steps[i].label}.${field}`);
        if (d) diffs.push(d);
      }
    }
    const d = firstDiff(b.snap, a.snap, '全库快照');
    if (d) diffs.push(d);
    assert.deepEqual(diffs, [], diffs.join('\n'));

    // --- 防假绿 ---
    const parsed = a.steps.map((s) => JSON.parse(s.outcome.response.body));
    const lists = parsed.map((p) => p.announcements);
    const stats = {
      场景数: a.steps.length,
      SQL条数: a.steps.reduce((n, s) => n + s.sql.length, 0),
      条数序列: lists.map((l) => l.length),
    };
    // 一次 SQL 都不发就会全返回空数组 —— 必须确认每个场景都真的查了库，
    // 且只读端点每个请求只发一条 SELECT（多一条就说明有写操作漏进来了）
    assert.equal(stats.SQL条数, ANN_SCENARIOS.length, `每条场景应恰好一条 SQL，实际 ${stats.SQL条数} 条`);
    assert.ok(a.steps.every((s) => s.sql.length === 1), '有场景发了不止一条 SQL');
    assert.ok(a.steps.every((s) => /^SELECT /.test(s.sql[0].sql)), '有场景发的不是 SELECT');

    // 空表分支前后各一次，中间的条数走 3→4→3→100→100
    assert.deepEqual(stats.条数序列, [0, 3, 4, 3, 100, 100, 0], `条数序列不对：${JSON.stringify(stats)}`);

    // 排序方向：id DESC。id=1/2/3 的 created_at 是**反向**排的，
    // 所以「按 created_at 排」会得到 3,2,1，与期望不符即被抓。
    assert.deepEqual(lists[1].map((r) => r.id), [3, 2, 1], `排序不是 id DESC：${JSON.stringify(lists[1].map((r) => r.id))}`);
    // 删掉 id=2 之后仍是 DESC
    assert.deepEqual(lists[3].map((r) => r.id), [4, 3, 1], `删除后排序不对：${JSON.stringify(lists[3].map((r) => r.id))}`);

    // LIMIT 100：总数 105 时只给 100 条，且是 id 最大的那一批（6..105）
    assert.equal(lists[4].length, 100, `105 条时没截到 100：${JSON.stringify(stats)}`);
    assert.equal(lists[4][0].id, 105, '第一条应是 id 最大的');
    assert.equal(lists[4][99].id, 6, '第 100 条应是 id 第 6 大的');
    // 堆到 110 之后窗口滑动：拿到 11..110
    assert.equal(lists[5].length, 100, `110 条时没截到 100：${JSON.stringify(stats)}`);
    assert.equal(lists[5][0].id, 110, '滑动后第一条应是 id=110');
    assert.equal(lists[5][99].id, 11, '滑动后第 100 条应是 id=11');

    // 字段集：逐字锁住 6 列。改成 SELECT * 会多出 created_by。
    const FIELDS = ['id', 'title', 'content', 'image_url', 'created_at', 'updated_at'];
    for (const [i, l] of lists.entries()) {
      for (const r of l) {
        assert.deepEqual(Object.keys(r), FIELDS, `第 ${i} 条场景的字段集不对：${JSON.stringify(Object.keys(r))}`);
      }
    }
    // NULL 原样保留，不被吞成空串
    assert.equal(lists[1].find((r) => r.id === 2).image_url, null, 'image_url 的 NULL 被吞了');
    assert.equal(lists[2].find((r) => r.id === 4).updated_at, null, 'updated_at 的 NULL 被吞了');
    // 中文/换行/表情逐字保留
    assert.equal(lists[1].find((r) => r.id === 3).title, '灯塔点灯仪式 🎉');
    assert.equal(lists[1].find((r) => r.id === 2).content, '本周六中央广场举办嘉年华活动。\n欢迎参加！');

    // 响应壳：ok:true + 三个头
    for (const s of a.steps) {
      assert.equal(s.outcome.response.status, 200);
      assert.equal(JSON.parse(s.outcome.response.body).ok, true);
      assert.equal(s.outcome.response.headers['content-type'], 'application/json; charset=utf-8');
      assert.equal(s.outcome.response.headers['cache-control'], 'no-store');
      assert.equal(s.outcome.response.headers['x-content-type-options'], 'nosniff');
    }
    // 公开只读端点：不该发任何网络请求
    assert.equal(a.fetchCalls, 0, `announcements 发了 ${a.fetchCalls} 次网络请求`);
    assert.equal(b.fetchCalls, 0);

    // --- 只读性：全库快照证明它一个字节都没写 ---
    const tickets = JSON.parse('[' + a.snap.tickets.join(',') + ']');
    assert.equal(tickets.length, 1, '只读端点不该动 tickets 表');
    assert.equal(tickets[0].title, '路灯损坏申请');
    assert.equal(a.snap.announcements.length, 0, '最后一个场景清空了表，快照应当是空的');
    // 快照确实覆盖了 players 表（说明不是只比了本路由碰过的表）
    const players = JSON.parse('[' + a.snap.players.join(',') + ']');
    assert.equal(players.length, 3, `玩家表应仍是 seeded() 的 3 行，实际 ${players.length}`);
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 用例 3：_shared/http.js 的行为差分
//
// 工单把 http.js 列在「已有差分测试兜底」那一栏，**实测不成立**：
// tests/shared-equiv.test.js 的 14 个用例里，auth.js 有 PBKDF2 参考值断言、
// bytes.js 有 hex/b64url 往返断言，但 http.js 只被那个「export 名单一致」的正则检查
// 扫到 —— 那条只认名字，json/ok/err 的响应头、状态码、字段名全都没人比对。
//
// 而它不是死代码：functions/_shared.js 把 json/ok/err 转发出去，谁 import 了
// _shared.js 谁就在用。于是「把 Cache-Control 删掉」「把 error 字段改成 message」
// 这类改动会一路静默地影响所有走这三个 helper 的路由。
// 本工单本来就要重写这个文件，所以顺手把它的行为差分补上。
// ===========================================================================

const HTTP_CASES = [
  { fn: 'json', args: [{ a: 1 }] },
  { fn: 'json', args: [{ 中文: '灯灯', emoji: '🤖' }] },
  { fn: 'json', args: [{ a: 1 }, { status: 201 }] },
  { fn: 'json', args: [{ a: 1 }, { status: 503, headers: { 'X-Extra': 'v' } }] },
  // init.headers 要能覆盖默认头：这是 { ...(init.headers||{}) } 放在后面的意义
  { fn: 'json', args: [{ a: 1 }, { headers: { 'Cache-Control': 'public, max-age=60' } }] },
  { fn: 'json', args: [{ a: 1 }, { headers: { 'Content-Type': 'text/plain' } }] },
  // headers 显式给 null / undefined 时必须退化成 {} 而不是抛
  { fn: 'json', args: [{ a: 1 }, { headers: null }] },
  { fn: 'json', args: [{ a: 1 }, { headers: undefined }] },
  { fn: 'json', args: [null] },
  { fn: 'json', args: [[1, 2, 3]] },

  { fn: 'ok', args: [] },
  { fn: 'ok', args: [{ id: 7 }] },
  { fn: 'ok', args: [{ id: 7 }, { status: 201 }] },
  // data 里自带 ok 时，壳里的 ok:true 必须赢（{ ok: true, ...data } 的顺序）
  { fn: 'ok', args: [{ ok: false, id: 7 }] },

  { fn: 'err', args: [400, '请先登录'] },
  { fn: 'err', args: [404, '接口不存在'] },
  { fn: 'err', args: [409, '该记录已存在，请勿重复提交'] },
  // extra 里的字段必须跟在 error 之后展开，且不能把 error 顶掉
  { fn: 'err', args: [400, '用户名已被占用', { field: 'username' }] },
  { fn: 'err', args: [400, '错误', { error: '被顶掉了吗' }] },
  { fn: 'err', args: [422, '内容过多'] },
];

test(`http：json / ok / err 共 ${HTTP_CASES.length} 组输入两版逐响应一致（状态码/头/body 逐字）`, async () => {
  const { oldM, newM, cleanup } = await loadBoth('functions/_shared/http.js');
  try {
    const run = async (mod, c) => {
      try {
        return { threw: false, ...(await readResponse(mod[c.fn](...c.args))) };
      } catch (e) {
        return { threw: true, error: String(e && e.message) };
      }
    };

    const a = [], b = [];
    for (const c of HTTP_CASES) {
      a.push(await run(oldM, c));
      b.push(await run(newM, c));
    }

    const diffs = [];
    for (let i = 0; i < HTTP_CASES.length; i++) {
      const d = firstDiff(b[i], a[i], `${HTTP_CASES[i].fn}(${JSON.stringify(HTTP_CASES[i].args)})`);
      if (d) diffs.push(d);
    }
    assert.deepEqual(diffs, [], diffs.join('\n'));

    // --- 防假绿：把三个 helper 的关键性质钉死，光靠「两版一样」不够 ---
    const [plain] = a;
    assert.equal(plain.threw, false);
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-type'], 'application/json; charset=utf-8', 'Content-Type 必须带 charset');
    assert.equal(plain.headers['cache-control'], 'no-store', 'no-store 不能丢');
    assert.equal(plain.body, '{"a":1}');

    // 头名大小写：Response 头是小写化的，比对时别写成 'Content-Type'
    assert.ok(!('Cache-Control' in plain.headers), '头应被小写化');

    // init.headers 覆盖默认头
    const override = a[4];
    assert.equal(override.headers['cache-control'], 'public, max-age=60', 'init.headers 必须能覆盖默认头');
    const ctOverride = a[5];
    assert.equal(ctOverride.headers['content-type'], 'text/plain', 'Content-Type 也必须可覆盖');
    // headers: null / undefined 不能抛
    assert.equal(a[6].threw, false, 'headers:null 不该炸');
    assert.equal(a[7].threw, false, 'headers:undefined 不该炸');
    // JSON.stringify(null) 是 "null"，不是空串
    assert.equal(a[8].body, 'null');

    // ok：壳在前，data 在后
    assert.equal(a[10].body, '{"ok":true}');
    assert.equal(a[11].body, '{"ok":true,"id":7}');
    assert.equal(a[12].status, 201, 'ok 必须能把 init 传给 Response');
    // 注意方向：ok() 写的是 { ok: true, ...data }，展开在**后面**，
    // 所以 data 自带的 ok 会顶掉壳里的 ok:true（对象字面量里后写的键赢）。
    // 实际结果里重复的 ok 被 JSON.stringify 折叠成最后一个。
    // 这个方向必须钉死 —— 反过来写成 { ...data, ok: true } 是另一种行为，
    // 两版都一样不算数，得断言具体输出。
    assert.equal(a[13].body, '{"ok":false,"id":7}', 'data 自带的 ok:false 会顶掉壳里的 ok:true');

    // err：字段名是 error（不是 message），extra 在 error 之后
    assert.equal(a[14].body, '{"ok":false,"error":"请先登录"}');
    assert.equal(a[14].status, 400);
    assert.equal(a[17].body, '{"ok":false,"error":"用户名已被占用","field":"username"}');
    // extra 里带 error 时会覆盖 —— 两版行为一致即可，不额外规定
    assert.equal(a[18].body, '{"ok":false,"error":"被顶掉了吗"}');
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 用例 4：端到端走 dispatch（真中间件 + 真审计）
//
// 上面几条是直接调 handler，绕过了 functions/api/_middleware.js。dispatch 按 URL
// 找文件、只能指向磁盘上那一份，所以**只对现版跑**，不参与差分 —— 它的作用是证明
// 「重写没有把路由从中间件上摘下来」（比如 onRequestGet 写错名字，dispatch 就 405 了）。
// ---------------------------------------------------------------------------

test('端到端：现版走 dispatch（真中间件），announcements 匿名可读、ai-bot 无 token 401', async () => {
  const f = await seeded();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = fetchTrap([]);
  try {
    const env = { DB: f.DB };

    // 公开只读端点：匿名可读。它压根不鉴权，所以两种取 token 的方式都无所谓。
    const anon = await dispatch(new Request('https://local.test/api/announcements'), env);
    const anonBody = await anon.json();
    assert.equal(anon.status, 200, '匿名读公告应当 200');
    assert.equal(anonBody.ok, true);
    assert.equal(anonBody.announcements.length, 1, 'fixture 里此时只有 1 条公告');
    assert.equal(anonBody.announcements[0].title, '基线公告');

    // 中间件覆写后的头也要在（证明中间件真的跑过了）
    assert.equal(anon.headers.get('cache-control'), 'no-store');
    assert.ok(anon.headers.get('x-request-id'), '中间件应当注入 x-request-id');
    assert.equal(anon.headers.get('x-content-type-options'), 'nosniff');

    // ai-bot 必须登录
    const noToken = await dispatch(new Request('https://local.test/api/ai-bot'), env);
    assert.equal(noToken.status, 401, '没带 token 应当 401');
    assert.equal((await noToken.json()).error, '请先登录');

    // 带 Cookie 应当过鉴权。库里此时只有冒名顶替的灯灯 → 503 需超管核实。
    const withToken = await dispatch(
      new Request('https://local.test/api/ai-bot', { headers: { Cookie: 'lc_session=tok_player' } }),
      env
    );
    assert.equal(withToken.status, 503, '带着冒名顶替的灯灯应当 503');
    assert.equal((await withToken.json()).error, '灯灯客服账号需要超管核实，暂不可用');

    // 换成真灯灯 → 200，返回其 username（走真建号路径里的复用/建号）
    await f.DB.prepare("DELETE FROM players WHERE id=3").run();
    const real = await dispatch(
      new Request('https://local.test/api/ai-bot', { headers: { Cookie: 'lc_session=tok_player' } }),
      env
    );
    assert.equal(real.status, 200, '带会话 + 真灯灯应当 200');
    assert.deepEqual(await real.json(), { ok: true, username: BOT_USERNAME });

    // 同样的请求用 Authorization: Bearer 取 token 也认（readToken 的两条路径）
    const viaBearer = await dispatch(
      new Request('https://local.test/api/ai-bot', { headers: { Authorization: 'Bearer tok_player' } }),
      env
    );
    assert.equal(viaBearer.status, 200, 'Bearer 取 token 也应当 200');
  } finally {
    globalThis.fetch = prevFetch;
    f.close();
  }
});
