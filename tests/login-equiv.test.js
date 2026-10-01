// login + _helpers 的行为差分（functions/api/login.js / functions/api/_helpers.js）。
//
// 为什么单独开一个文件：这两个是全站风险最高的两块，而上一轮重写**没给它们做过
// 行为验证**——只有 backend-equiv.test.js 里那条「export 名单一致」的静态检查。
// 而那条检查已经被证明抓不住行为回归：上一轮 exam-sessions.js 的 action 白名单被
// 兜底 return 吃掉（delete / SUBMIT / start 全部从 400 变成 200），
// export 名单和 268 个旧测试**一个都没报**。
//
// 所以这里补的是真的行为差分：拿真 SQLite 把登录全流程跑两遍，逐场景比对
// **返回值 / 抛出的异常 / 响应头 / 发出去的每一条 SQL（原文逐字）/ 全库所有表的完整快照**。
//
// ---------------------------------------------------------------------------
// 差分口径（唯一的一处妥协，写明在这里）
//
// 基线的 login.js 通过 '../_core/request.js' / '../_shared/session.js' 拿 fail() /
// body() / string() / getSession()。这两个文件在 06e9595→HEAD 之间也重写过
// （逐行 git diff 可见是纯排版），落盘副本照样 import **现版**的它们。
// 这正是想要的：差分要隔离出 login.js 自己的行为，而不是把两个文件的改动混在一起。
// 代价：哪天 request.js 真出了行为改动，本文件会报红，那时报错指向的是
// 「两版输入相同但环境不同」，排查方向和真回归不一样。
//
// 时间戳：sessions.expires_at 是 new Date(...).toISOString()（真实时钟），
// created_at 一律是 SQLite 的 DEFAULT CURRENT_TIMESTAMP。逐字比对会随机假红，
// 所以这些列做 <TS>/<TS:ISO> 归一。expires_at 的**相对年龄**（8 小时 TTL）
// 另外用 probe 精确断言，见下方 hours。
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { database } from './local-d1.mjs';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { ensureDatabase } from '../functions/_core/database.js';
import { hashPassword } from '../functions/_shared/auth.js';

const BASELINE = '06e9595';
const LOGIN = 'functions/api/login.js';
const HELPERS = 'functions/api/_helpers.js';

const show = (path) => execSync(`git show ${BASELINE}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 28 });
const read = (p) => readFileSync(p, 'utf8');

const exportNames = (src) =>
  [...src.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)]
    .map((m) => m[1])
    .concat(
      [...src.matchAll(/export\s*\{([^}]*)\}/g)]
        .flatMap((m) => m[1].split(',').map((p) => p.trim().split(/\s+as\s+/).pop().trim()))
        .filter(Boolean)
    )
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

// ===========================================================================
// 确定性化
// ===========================================================================

/**
 * createSession → randomToken(24) → crypto.getRandomValues。
 * 不固定的话两版拿到不同 token，Set-Cookie 和 sessions.token 就永远对不上。
 * 计数器在每个版本跑之前归零 —— 于是 token 本身就是可比对的。
 */
let rndSeq = 0;
Object.defineProperty(globalThis.crypto, 'getRandomValues', {
  configurable: true,
  writable: true,
  value: (arr) => {
    for (let i = 0; i < arr.length; i++) {
      rndSeq = (Math.imul(rndSeq, 1103515245) + 12345) & 0x7fffffff;
      arr[i] = (rndSeq >>> 16) & 0xff;
    }
    return arr;
  },
});

/** 中间件要的 request id（不进任何断言，只是不让它变成噪声） */
let uuidSeq = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  configurable: true,
  writable: true,
  value: () => `20000000-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`,
});

/** 全部账号共用一组固定 salt 算出来的哈希：PBKDF2 10 万次很贵，只算一次 */
const PW = 'LocalTest67!';
const SALT = '00112233445566778899aabbccddeeff';
const HASH = (await hashPassword(PW, SALT)).hash;

// ===========================================================================
// 临时副本
//
// 坑（backend-equiv.test.js 里记着）：副本必须落回 functions/api/ 原位，
// 里面的 '../_core/request.js' 相对 import 才成立；挪到 tests/ 下直接断链。
// 文件名必须与原模块不同：ESM 按绝对路径缓存，同名会让基线版和现版拿到**同一个**
// 模块对象，差分静悄悄退化成「自己跟自己比」。
// 清理只认本进程登记过的路径，不扫全仓库（有并发进程在跑）。
// ===========================================================================

const ownedTmpFiles = new Set();
let tmpSeq = 0;

function cleanupTmpFiles() {
  for (const f of ownedTmpFiles) { try { unlinkSync(f); } catch {} }
  ownedTmpFiles.clear();
}
process.on('exit', cleanupTmpFiles);
process.on('uncaughtException', (e) => { cleanupTmpFiles(); throw e; });

async function loadPair(path, stem) {
  const name = `.equiv-${process.pid}-${++tmpSeq}-${stem}.mjs`;
  const rel = path.replace(/\/[^/]+$/, '/') + name;
  writeFileSync(rel, show(path));
  ownedTmpFiles.add(rel);
  const [oldM, newM] = await Promise.all([import('../' + rel), import('../' + path)]);
  return {
    old: oldM,
    new: newM,
    cleanup: () => { try { unlinkSync(rel); } catch {} ownedTmpFiles.delete(rel); },
  };
}

// ===========================================================================
// 真库 + 种子
// ===========================================================================

const FAR = '2099-01-01 00:00:00';

/** 玩家：1 active / 3 停用 / 4 待审 / 5 指向不存在的管理员 / 6 指向不互认的管理员 / 7,8 绑酒店 */
const PLAYERS = [
  // id, username,   status,    linked_admin_id
  [1, 'alice',   'active',  null],
  [2, 'bob',     'active',  2],
  [3, 'banned',  'banned',  null],
  [4, 'pending', 'pending', null],
  [5, 'dora',    'active',  99],
  [6, 'erin',    'active',  3],
  [7, 'frida',   'active',  null],
  [8, 'gina',    'active',  null],
];

/** 管理员：1 super / 2 与玩家 2 互认 / 3 存在但没反向绑定 / 4 绑着不存在的玩家 */
const ADMINS = [
  // id, username,  role,   linked_player_id
  [1, 'root',    'super', null],
  [2, 'wzc',     'admin', 2],
  [3, 'auditor', 'admin', null],
  [4, 'ghost',   'admin', 999],
];

const OWNERS = [
  // id, username, status,    linked_player_id
  [1, 'owner',  'active',   7],
  [2, 'owner2', 'disabled', 8],
  [3, 'owner3', 'active',   null],
];

/**
 * 预置会话，覆盖 GET / _helpers 的每条分支。
 * expires_at 必须是合法的未来时间 —— getSession 见到缺失/非法就当场删会话返 401。
 */
const SESSIONS = [
  // token,              player_id, admin_id, hotel_owner_id, expires_at
  ['s-player',          1,  null, null, FAR],
  ['s-admin',           null, 1,   null, FAR],
  ['s-both',            2,  2,    null, FAR],   // 合并会话
  ['s-owner',           null, null, 1,  FAR],
  ['s-owner-beats',     7,  null, 3,  FAR],     // 会话里的 owner3 优先于玩家 7 反查到的 owner1
  ['s-owner-inactive',  null, null, 2,  FAR],    // owner 已停用 → 没有任何身份
  ['s-empty',           null, null, null, FAR],  // 三种身份都没有
  ['s-banned',          3,  null, null, FAR],    // 玩家已停用 → player 查不到
  ['s-banned-admin',    3,  1,    null, FAR],    // 玩家停用但管理员还在
  ['s-ghost',           999, null, null, FAR],   // 会话指向不存在的玩家
  ['s-expired',         1,  null, null, '2020-01-01 00:00:00'],
  ['s-badtime',         1,  null, null, '不是时间'],
  ['s-lost',            null, 555, null, FAR],   // 管理员已被删
  ['s-link-ok',         2,  null, null, FAR],    // 互认绑定，应保留 linked_admin_id
  ['s-dangling',        5,  null, null, FAR],    // 指向不存在的管理员 99 → 应抹掉
  ['s-nonrecip',        6,  null, null, FAR],    // 管理员 3 没有反向绑定 → 应抹掉
  ['s-adminlink',       null, 2,  null, FAR],    // 管理员绑着玩家 2
  ['s-adminghost',      null, 4,  null, FAR],    // 管理员的 linked_player_id 指向不存在的玩家
];

async function seeded() {
  const DB = database();
  await ensureDatabase(DB);
  for (const [id, username, status, linked] of PLAYERS) {
    await DB.prepare(
      'INSERT INTO players(id,username,email,password_hash,salt,status,emeralds,linked_admin_id) VALUES(?,?,?,?,?,?,?,?)'
    ).bind(id, username, `${username}@example.invalid`, HASH, SALT, status, 100 * id, linked).run();
  }
  for (const [id, username, role, linked] of ADMINS) {
    await DB.prepare('INSERT INTO admins(id,username,password_hash,salt,role,linked_player_id) VALUES(?,?,?,?,?,?)')
      .bind(id, username, HASH, SALT, role, linked).run();
  }
  for (const [id, username, status, linked] of OWNERS) {
    await DB.prepare("INSERT INTO hotel_owners(id,username,password_hash,salt,status,linked_player_id) VALUES(?,?,?,?,?,?)")
      .bind(id, username, HASH, SALT, status, linked).run();
  }
  for (const [token, p, a, o, exp] of SESSIONS) {
    await DB.prepare('INSERT INTO sessions(token,player_id,admin_id,hotel_owner_id,expires_at) VALUES(?,?,?,?,?)')
      .bind(token, p, a, o, exp).run();
  }
  return { DB, env: { DB }, close: () => DB.close() };
}

/** 防假绿：种子必须真的建起来了 */
async function assertFixture(DB) {
  const count = async (t) => (await DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n;
  assert.equal(await count('players'), PLAYERS.length, '玩家种子没建起来');
  assert.equal(await count('admins'), ADMINS.length, '管理员种子没建起来');
  assert.equal(await count('hotel_owners'), OWNERS.length, '酒店老板种子没建起来');
  assert.equal(await count('sessions'), SESSIONS.length, '会话种子没建起来');
}

// ===========================================================================
// 快照 / 上下文 / 差分执行器
// ===========================================================================

const TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

const squash = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => {
    if (typeof v === 'string') {
      if (k === 'request_id') return [k, '<UUID>'];
      if (TS_RE.test(v)) return [k, `<TS${v.includes('T') ? ':ISO' : ''}>`];
    }
    return [k, v];
  }));

/**
 * 响应体也要归一时间戳。
 *
 * 漏过一次：GET /api/login 的返回体里带 players.created_at（SQL 默认 datetime('now')），
 * 种子插入正好跨秒时两版就对不上，表现为「有时候这条挂、有时候那条挂」的假红。
 * 只归一库里那一半是不够的 —— 值同样会从响应体漏出来。
 */
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  }
  if (typeof value === 'string' && TS_RE.test(value)) {
    return `<TS${value.includes('T') ? ':ISO' : ''}>`;
  }
  return value;
}

async function snapshot(DB) {
  const names = (await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all()).results.map((x) => x.name);
  const out = { __tableCount: names.length };
  for (const t of names) {
    const rows = (await DB.prepare(`SELECT * FROM "${t}"`).all()).results.map(squash);
    rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    out[t] = rows;
  }
  return out;
}

/** 记录发出去的每一条 SQL —— 逐字记，不归一空白：工单明写「SQL 逐字保留」 */
function tracedDb(DB, log) {
  return {
    prepare: (sql) => { log.push(String(sql)); return DB.prepare(sql); },
    batch: (items) => {
      for (const it of items) log.push(String(it.sql));
      return DB.batch(items);
    },
  };
}

const HANDLER = { GET: 'onRequestGet', POST: 'onRequestPost', DELETE: 'onRequestDelete' };

/** 取路由的导出 handler。缺了直接炸 —— 静默 TypeError 会让「两版一起错」伪装成差分通过 */
function handlerOf(mod, method) {
  const name = HANDLER[method];
  if (!name) throw new Error(`未知方法 ${method}`);
  if (typeof mod[name] !== 'function') throw new Error(`${name} 不是函数 —— 副本装错了，或 export 名字变了`);
  return mod[name];
}

function makeContext(env, step, cookies) {
  const headers = { ...(step.headers || {}) };
  if (step.body !== undefined) headers['Content-Type'] = 'application/json';
  if (step.token !== undefined && step.token !== null) headers.Cookie = `lc_session=${step.token}`;
  // 用前面某一步种下的真实 token（从 Set-Cookie 里取），走端到端串联
  if (step.useTokenFrom !== undefined) headers.Cookie = `lc_session=${cookies[step.useTokenFrom]}`;
  return {
    env,
    waitUntil: (p) => p.catch(() => {}),
    request: new Request('https://local.test' + (step.url || '/api/login'), {
      method: step.method || 'GET',
      headers,
      body: step.body === undefined ? undefined : typeof step.body === 'string' ? step.body : JSON.stringify(step.body),
    }),
  };
}

async function readResponse(r) {
  return {
    status: r.status,
    headers: Object.fromEntries([...r.headers.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    json: normalize(await r.json()),
  };
}

/** 一条场景跑完。SQL 步骤用于在同一串有序输入里插库操作（与请求一起按序比） */
async function runOne(env, mod, step, cookies) {
  if (step.sql) {
    const r = await env.DB.prepare(step.sql).run();
    return { label: step.label, status: 'SQL', changes: r.meta.changes };
  }
  const fn = handlerOf(mod, step.method || 'GET');
  const c = makeContext(env, step, cookies);
  let rec;
  try {
    const response = step.through
      ? await middleware({ ...c, next: () => fn(c) })
      : await fn(c);
    rec = await readResponse(response);
  } catch (e) {
    rec = { threw: e.status ?? null, message: e.message };
  }
  const setCookie = rec.headers?.['set-cookie'] || '';
  const m = /lc_session=([^;]*)/.exec(setCookie);
  if (m && m[1]) cookies.push(m[1]);
  if (step.label) rec.label = step.label;
  return rec;
}

/** 顺手把响应里的 token 换成占位符，方便人读断言失败信息 */
const brief = (steps) =>
  steps.map((s, i) => `${i}: ${s.status === 'SQL' ? 'SQL' : s.threw ? 'THROW ' + s.message : s.status + ' ' + JSON.stringify(s.json)}`);
const statuses = (steps) => steps.map((s) => s.status);
const byLabel = (steps) => Object.fromEntries(steps.filter((s) => s.label).map((s) => [s.label, s]));

/**
 * 同一串有序输入在两版上各跑一遍（各自一份全新真库），比对：
 * 逐场景响应 + 每条 SQL 原文 + 全库快照 + probe。
 */
async function differential(modPair, { steps, probe }) {
  const results = [];
  for (const mod of [modPair.old, modPair.new]) {
    const f = await seeded();
    try {
      await assertFixture(f.DB);
      rndSeq = 0;
      uuidSeq = 0;

      const sqlLog = [];
      const env = { DB: tracedDb(f.DB, sqlLog) };
      const cookies = [];
      const out = [];
      for (const s of steps) out.push(await runOne(env, mod, s, cookies));
      results.push({ steps: out, sql: sqlLog, db: await snapshot(f.DB), probe: probe ? await probe(f.DB) : null });
    } finally {
      f.close();
    }
  }
  const [a, b] = results;
  if (process.env.EQUIV_DEBUG) {
    console.error('--- steps ---\n' + JSON.stringify(a.steps, null, 1));
    console.error('--- sql ---\n' + JSON.stringify(a.sql, null, 1));
  }
  assert.deepEqual(b.steps, a.steps,
    `逐场景响应不一致\n基线:\n  ${brief(a.steps).join('\n  ')}\n现版:\n  ${brief(b.steps).join('\n  ')}`);
  assert.deepEqual(b.sql, a.sql, '发出去的 SQL 逐字不一致（工单要求 SQL 原文保留）');
  assert.deepEqual(b.db, a.db, '全库快照不一致');
  assert.deepEqual(b.probe, a.probe, 'probe 结果不一致');
  return a;
}

// ===========================================================================
// 场景
// ===========================================================================

const POST = (label, body, headers) => ({ label, method: 'POST', body, headers });
const ip = (n) => ({ 'CF-Connecting-IP': n });

/** POST：成功 / 密码错 / 账号不存在 / 停用 / 字段缺失 / 字段类型错 / 目标回退 / 重复登录 */
const POST_STEPS = [
  POST('玩家登录成功', { username: 'alice', password: PW }),
  POST('超级管理员登录', { username: 'root', password: PW, target: 'admin' }),
  POST('普通管理员登录', { username: 'wzc', password: PW, target: 'admin' }),
  POST('酒店老板登录', { username: 'owner', password: PW, target: 'hotel_owner' }),
  POST('停用的酒店老板', { username: 'owner2', password: PW, target: 'hotel_owner' }),
  POST('账号两空格应被 trim', { username: '  alice  ', password: PW }),
  POST('密码错', { username: 'alice', password: '不对的密码' }),
  POST('账号不存在', { username: 'nobody', password: PW }),
  POST('管理员账号用 player 目标登', { username: 'root', password: PW, target: 'player' }),
  POST('玩家已停用', { username: 'banned', password: PW }),
  POST('玩家待审', { username: 'pending', password: PW }),
  POST('缺 password', { username: 'alice' }),
  POST('password 是数字', { username: 'alice', password: 123456 }),
  POST('password 是 null', { username: 'alice', password: null }),
  POST('password 空串', { username: 'alice', password: '' }),
  POST('password 128 字符界内', { username: 'alice', password: 'x'.repeat(128) }),
  POST('password 129 字符越界', { username: 'alice', password: 'x'.repeat(129) }),
  POST('缺 username', { password: PW }),
  POST('username 是数字', { username: 7, password: PW }),
  POST('username 空串', { username: '', password: PW }),
  POST('username 全空格', { username: '   ', password: PW }),
  POST('username 64 字符界内', { username: 'u'.repeat(64), password: PW }),
  POST('username 65 字符越界', { username: 'u'.repeat(65), password: PW }),
  POST('body 不是 JSON', '这不是 JSON'),
  POST('body 是数组', '[1,2,3]'),
  POST('body 是 null', 'null'),
  POST('body 是裸字符串', '"字符串"'),
  POST('body 是空', ''),
  POST('target 非法值回退 player', { username: 'alice', password: PW, target: 'super' }),
  POST('target 大写 ADMIN 回退 player', { username: 'alice', password: PW, target: 'ADMIN' }),
  POST('target 是数字回退 player', { username: 'alice', password: PW, target: 1 }),
  POST('同名重复登录', { username: 'alice', password: PW }),
  POST('另一个 IP 上密码错（指纹分桶）', { username: 'alice', password: 'x' }, ip('8.8.8.8')),
  POST('带 IP 头的成功登录', { username: 'bob', password: PW }, ip('9.9.9.9')),
];

/** 期望：[状态码, 错误文案]；文案为 null 表示成功 */
const EXPECT_POST = {
  '玩家登录成功': [200, null],
  '超级管理员登录': [200, null],
  '普通管理员登录': [200, null],
  '酒店老板登录': [200, null],
  '停用的酒店老板': [403, '账号尚未激活或已停用'],
  '账号两空格应被 trim': [200, null],
  '密码错': [401, '账号或密码错误'],
  '账号不存在': [401, '账号或密码错误'],
  '管理员账号用 player 目标登': [401, '账号或密码错误'],
  '玩家已停用': [403, '账号尚未激活或已停用'],
  '玩家待审': [403, '账号尚未激活或已停用'],
  '缺 password': [400, '密码无效'],
  'password 是数字': [400, '密码无效'],
  'password 是 null': [400, '密码无效'],
  'password 空串': [400, '密码无效'],
  'password 128 字符界内': [401, '账号或密码错误'],
  'password 129 字符越界': [400, '密码无效'],
  '缺 username': [400, '账号 必须是文字'],
  'username 是数字': [400, '账号 必须是文字'],
  'username 空串': [400, '账号 需填写且不超过 64 字符'],
  'username 全空格': [400, '账号 需填写且不超过 64 字符'],
  'username 64 字符界内': [401, '账号或密码错误'],
  'username 65 字符越界': [400, '账号 需填写且不超过 64 字符'],
  'body 不是 JSON': [400, '请求不是有效 JSON'],
  'body 是数组': [400, '请求必须是 JSON 对象'],
  'body 是 null': [400, '请求必须是 JSON 对象'],
  'body 是裸字符串': [400, '请求必须是 JSON 对象'],
  'body 是空': [400, '账号 必须是文字'],
  'target 非法值回退 player': [200, null],
  'target 大写 ADMIN 回退 player': [200, null],
  'target 是数字回退 player': [200, null],
  '同名重复登录': [200, null],
  '另一个 IP 上密码错（指纹分桶）': [401, '账号或密码错误'],
  '带 IP 头的成功登录': [200, null],
};

const EXPECT_OK_POST = {
  '玩家登录成功': { user_id: 1, role: 'player' },
  '超级管理员登录': { user_id: 1, role: 'super' },
  '普通管理员登录': { user_id: 2, role: 'admin' },
  '酒店老板登录': { user_id: 1, role: 'hotel_owner' },
  '停用的酒店老板': null,
  '账号两空格应被 trim': { user_id: 1, role: 'player' },
  'target 非法值回退 player': { user_id: 1, role: 'player' },
  'target 大写 ADMIN 回退 player': { user_id: 1, role: 'player' },
  'target 是数字回退 player': { user_id: 1, role: 'player' },
  '同名重复登录': { user_id: 1, role: 'player' },
  '带 IP 头的成功登录': { user_id: 2, role: 'player' },
};

/** GET：会话解析的全部组合 */
const GET_STEPS = [
  { label: '无 token', token: null },
  { label: '不存在的 token', token: 'no-such-token' },
  { label: '过期会话', token: 's-expired' },
  { label: 'expires_at 非法', token: 's-badtime' },
  { label: '玩家会话', token: 's-player' },
  { label: '管理员会话', token: 's-admin' },
  { label: '合并会话', token: 's-both' },
  { label: '酒店老板会话', token: 's-owner' },
  { label: '会话里的 owner 优先于反查', token: 's-owner-beats' },
  { label: 'owner 停用且无其他身份', token: 's-owner-inactive' },
  { label: '会话三种身份全空', token: 's-empty' },
  { label: '玩家停用且无管理员', token: 's-banned' },
  { label: '玩家停用但管理员在', token: 's-banned-admin' },
  { label: '会话指向不存在的玩家', token: 's-ghost' },
  { label: '管理员已被删', token: 's-lost' },
  { label: '互认绑定应保留', token: 's-link-ok' },
  { label: '悬空绑定应抹掉', token: 's-dangling' },
  { label: '不互认的绑定应抹掉', token: 's-nonrecip' },
  { label: '管理员绑着玩家', token: 's-adminlink' },
  { label: '管理员绑着不存在的玩家', token: 's-adminghost' },
  { label: 'X-Session-Token 取 token', token: null, tokenHeader: ['X-Session-Token', 's-player'] },
  { label: 'Authorization Bearer', token: null, tokenHeader: ['Authorization', 'Bearer s-admin'] },
  { label: 'Authorization 裸值', token: null, tokenHeader: ['Authorization', 's-player'] },
];

/** 由 token 造出与 getSession 返回同形的会话对象，保证两版入参完全一致 */
function sessionRow(token) {
  const row = SESSIONS.find((s) => s[0] === token);
  if (!row) throw new Error('未知会话 ' + token);
  return { token, player_id: row[1], admin_id: row[2], hotel_owner_id: row[3], expires_at: row[4] };
}

const describeResponse = async (r) => ({
  status: r.status,
  headers: Object.fromEntries([...r.headers.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  json: await r.json(),
});

/**
 * _helpers 跑完上面那 36 个场景时**逐条**发出去的 SQL。
 *
 * 为什么钉死整张清单而不只比两版相等：把 `if (a.linked_player_id)` 改成 `if (a.id)`
 * 对任何可达数据都返回同样的值（多查一次库，查不到就照样 return a）——
 * 只比返回值的话这种改动完全隐形（这正是第一轮变异测试漏掉的那一个）。
 * 钉住语句序列才能把「多查一次」「少一个 WHERE」这类改动变成可见差异。
 */
const HELPERS_SQL = [
  // parseSession：6 次查会话（无 cookie / 无关键词 / 玩家 / 管理员 ×2 / 幽灵 / 过期），
  // 其中两次带 admin_id 的顺带查管理员；过期那条顺手删会话
  'SELECT token, player_id, admin_id, hotel_owner_id, expires_at FROM sessions WHERE token = ?',
  'SELECT token, player_id, admin_id, hotel_owner_id, expires_at FROM sessions WHERE token = ?',
  'SELECT id, role, username FROM admins WHERE id = ?',
  'SELECT token, player_id, admin_id, hotel_owner_id, expires_at FROM sessions WHERE token = ?',
  'SELECT id, role, username FROM admins WHERE id = ?',
  'SELECT token, player_id, admin_id, hotel_owner_id, expires_at FROM sessions WHERE token = ?',
  'SELECT token, player_id, admin_id, hotel_owner_id, expires_at FROM sessions WHERE token = ?',
  'DELETE FROM sessions WHERE token = ?',
  // resolveSubjectFromSession：玩家分支 4 次、管理员分支 4 次、其中管理员 2 号绑着玩家 2
  "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'",
  "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'",
  "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'",
  "SELECT a.id, a.username, a.role, a.linked_player_id, 'admin' AS kind FROM admins a WHERE a.id = ?",
  "SELECT a.id, a.username, a.role, a.linked_player_id, 'admin' AS kind FROM admins a WHERE a.id = ?",
  "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'",
  "SELECT a.id, a.username, a.role, a.linked_player_id, 'admin' AS kind FROM admins a WHERE a.id = ?",
  "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'",
  "SELECT a.id, a.username, a.role, a.linked_player_id, 'admin' AS kind FROM admins a WHERE a.id = ?",
  "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'",
  "SELECT id, username, 'player' AS kind FROM players WHERE id = ? AND status = 'active'",
  // resolveSubjectByUsername：9 次调用，每次「先查玩家，查不到再查管理员」
  "SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'",
  "SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'",
  "SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?",
  "SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'",
  "SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?",
  "SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'",
  "SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?",
  "SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'",
  "SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?",
  "SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'",
  "SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?",
  "SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'",
  "SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?",
  "SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'",
  "SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?",
  "SELECT id, username, 'player' AS kind FROM players WHERE username = ? AND status = 'active'",
  "SELECT id, username, role, 'admin' AS kind FROM admins WHERE username = ?",
];

// ===========================================================================
// 测试
// ===========================================================================

test(`login / _helpers 没改任何 export 名单（对照 ${BASELINE}）`, () => {
  for (const path of [LOGIN, HELPERS]) {
    assert.deepEqual(exportNames(read(path)), exportNames(show(path)), `${path} 的 export 名单变了`);
  }
});

test('login POST：成功 / 失败 / 字段校验 / 目标回退 / 重复登录，两版逐场景一致', async () => {
  const pair = await loadPair(LOGIN, 'login');
  try {
    const a = await differential(pair, {
      steps: POST_STEPS,
      probe: async (DB) => {
        const s = (await DB.prepare('SELECT * FROM sessions').all()).results;
        const att = (await DB.prepare('SELECT * FROM auth_attempts ORDER BY id').all()).results;
        const fresh = s.filter((r) => !r.token.startsWith('s-'));
        return {
          sessionCount: s.length,
          sessionShape: fresh.map((r) => `${r.player_id}/${r.admin_id}/${r.hotel_owner_id}`).sort(),
          tokensAreHex48: fresh.every((r) => /^[0-9a-f]{48}$/.test(r.token)),
          tokensDistinct: new Set(s.map((r) => r.token)).size === s.length,
          attempts: att.map((r) => r.fingerprint),
          // expires_at 归一成了 <TS:ISO>，相对年龄在这里单独验
          hours: fresh.map((r) => Math.round((+new Date(r.expires_at) - Date.now()) / 3600_000)).sort((x, y) => x - y),
        };
      },
    });

    // ---- 防假绿：先证明 fixture 真的建起来了、真的干了活 ----
    assert.equal(a.steps.length, POST_STEPS.length, '场景数对不上');
    assert.equal(Object.keys(EXPECT_POST).length, POST_STEPS.length, '期望表没盖住全部场景');
    assert.ok(a.sql.length >= 60, `SQL 条数只有 ${a.sql.length}，差分可能根本没跑起来`);

    const got = byLabel(a.steps);
    for (const [label, [code, msg]] of Object.entries(EXPECT_POST)) {
      assert.ok(got[label], `场景没跑到：${label}`);
      assert.equal(got[label].status, code, `${label} 的状态码不对`);
      assert.deepEqual(got[label].json, msg === null ? { ok: true, ...EXPECT_OK_POST[label] } : { ok: false, error: msg },
        `${label} 的响应体不对`);
    }

    // 成功路径的返回体逐字锁住
    assert.deepEqual(got['超级管理员登录'].json, { ok: true, user_id: 1, role: 'super' }, 'role 取自 admins.role');
    assert.deepEqual(got['普通管理员登录'].json, { ok: true, user_id: 2, role: 'admin' });
    assert.deepEqual(got['酒店老板登录'].json, { ok: true, user_id: 1, role: 'hotel_owner' });
    assert.deepEqual(got['带 IP 头的成功登录'].json, { ok: true, user_id: 2, role: 'player' });

    // Set-Cookie 逐字
    assert.match(got['玩家登录成功'].headers['set-cookie'],
      /^lc_session=[0-9a-f]{48}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800$/,
      'Set-Cookie 属性不全：' + got['玩家登录成功'].headers['set-cookie']);

    // ---- probe：会话真的签发了、指纹真的分了桶 ----
    assert.equal(a.probe.sessionCount, SESSIONS.length + 10, '10 次成功登录各应建一个会话');
    assert.deepEqual(a.probe.hours, new Array(10).fill(8), '新会话的 expires_at 应为 8 小时后');
    assert.equal(a.probe.tokensAreHex48, true, 'token 应是 24 字节的十六进制');
    assert.equal(a.probe.tokensDistinct, true, '重复登录必须签发不同的会话');
    // 成功会清掉自己那一桶，最终剩 4 桶：nobody / root-as-player / 64 字符账号 / 另一个 IP 上的 alice
    assert.equal(a.probe.attempts.length, 4, '失败尝试应留下 4 条 auth_attempts');
    assert.equal(new Set(a.probe.attempts).size, 4, 'auth_attempts 指纹应按 IP+账号分桶');
    // 10 次成功登录各签发什么身份的会话：6 次玩家 alice、1 次玩家 bob、2 次管理员、1 次酒店老板
    assert.deepEqual(a.probe.sessionShape, [
      '2/null/null', 'null/1/null', 'null/2/null', 'null/null/1',
      ...new Array(6).fill('1/null/null'),
    ].sort(), '签发的会话身份组合不对');

    // ---- SQL 顺序：限流计数在密码比对之前，清 attempts 在签发会话之前 ----
    const idxCount = a.sql.findIndex((s) => s.includes('FROM auth_attempts WHERE fingerprint='));
    const idxLookup = a.sql.findIndex((s) => s.startsWith('SELECT * FROM players WHERE username='));
    const idxClear = a.sql.indexOf('DELETE FROM auth_attempts WHERE fingerprint=?');
    const idxCreate = a.sql.findIndex((s) => s.startsWith('INSERT INTO sessions'));
    assert.ok(idxCount >= 0 && idxLookup > idxCount, '限流计数必须早于账号查询');
    assert.ok(idxClear > idxLookup && idxCreate > idxClear, '清失败计数必须夹在账号查询与建会话之间');
    assert.ok(a.sql.includes('INSERT INTO auth_attempts(fingerprint) VALUES(?)'), '密码错应留下失败记录');
    // 6 个失败场景（密码错 ×2、账号不存在 ×2、128 字符密码、64 字符账号名）各写一次；
    // 两个停用账号密码已验过，不该写 —— 若写成 8 条就说明 403 分支多记了
    assert.equal(a.sql.filter((s) => s === 'INSERT INTO auth_attempts(fingerprint) VALUES(?)').length, 6,
      '停用/待审账号不该留下失败计数');
  } finally {
    pair.cleanup();
  }
});

test('login POST：十分钟内 10 次失败后锁死；换 IP / 换账号 / 过期记录都不锁', async () => {
  const pair = await loadPair(LOGIN, 'login');
  // 同一 IP + 同一账号连打 10 次
  const fail = (label, addr) => POST(label, { username: 'nobody', password: PW }, ip(addr));
  const fail10 = (label, addr) => Array.from({ length: 10 }, (_, i) => fail(`${label}-${i + 1}`, addr));
  const probe = async (DB) => ({
    attempts: (await DB.prepare('SELECT COUNT(*) AS n FROM auth_attempts').first()).n,
    sessions: (await DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n,
  });
  try {
    // 第一轮：10 次失败后锁死；再验证换 IP / 换账号不共用同一个桶
    const a = await differential(pair, {
      steps: [
        ...fail10('第一轮', '7.7.7.1'),
        POST('第 11 次应 429', { username: 'nobody', password: PW }, ip('7.7.7.1')),
        POST('同 IP 换账号不锁', { username: 'nobody2', password: PW }, ip('7.7.7.1')),
        POST('换 IP 同账号不锁', { username: 'nobody', password: PW }, ip('7.7.7.2')),
      ],
      probe,
    });
    assert.equal(a.steps.length, 13);
    assert.deepEqual(statuses(a.steps), [...new Array(10).fill(401), 429, 401, 401]);
    assert.deepEqual(byLabel(a.steps)['第 11 次应 429'].json, { ok: false, error: '尝试次数过多，请稍后重试' });
    assert.equal(a.probe.attempts, 12, '12 次 401 各留一条，429 不写记录');
    assert.equal(a.probe.sessions, SESSIONS.length, '全程没有一次成功登录，不该签发会话');

    // 第二轮：把失败记录老化到 10 分钟之外，锁必须解开
    const b = await differential(pair, {
      steps: [
        ...fail10('第二轮', '7.7.7.1'),
        { label: '老化失败记录', sql: "UPDATE auth_attempts SET created_at='2020-01-01 00:00:00'" },
        POST('老化后不再锁', { username: 'nobody', password: PW }, ip('7.7.7.1')),
        POST('再攒一次也不满 10', { username: 'nobody', password: PW }, ip('7.7.7.1')),
      ],
      probe,
    });
    assert.deepEqual(statuses(b.steps), [...new Array(10).fill(401), 'SQL', 401, 401]);
    assert.equal(byLabel(b.steps)['老化失败记录'].changes, 10, '老化语句应改到 10 行');
    assert.equal(b.probe.attempts, 12);
  } finally {
    pair.cleanup();
  }
});

test('login POST：失败计数在成功后被清掉（成功路径不留脏计数）', async () => {
  const pair = await loadPair(LOGIN, 'login');
  const h = ip('5.5.5.5');
  try {
    const a = await differential(pair, {
      steps: [
        POST('先错一次', { username: 'alice', password: '错' }, h),
        POST('再错一次', { username: 'alice', password: '错' }, h),
        POST('改对密码', { username: 'alice', password: PW }, h),
        POST('同桶应重新计数', { username: 'alice', password: '错' }, h),
      ],
      probe: async (DB) => ({
        attempts: (await DB.prepare('SELECT COUNT(*) AS n FROM auth_attempts').first()).n,
        newSessions: (await DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token NOT LIKE 's-%'").first()).n,
      }),
    });
    const got = byLabel(a.steps);
    assert.deepEqual(statuses(a.steps), [401, 401, 200, 401]);
    assert.deepEqual(got['改对密码'].json, { ok: true, user_id: 1, role: 'player' });
    assert.equal(a.probe.attempts, 1, '成功后同桶计数应被清空，只剩最后一次失败');
    assert.equal(a.probe.newSessions, 1);
    const clear = a.sql.indexOf('DELETE FROM auth_attempts WHERE fingerprint=?');
    const create = a.sql.findIndex((s) => s.startsWith('INSERT INTO sessions'));
    assert.ok(clear >= 0 && create > clear, '清计数必须发生在签发会话之前');
  } finally {
    pair.cleanup();
  }
});

test('login GET：会话身份解析全分支，两版逐场景一致', async () => {
  const pair = await loadPair(LOGIN, 'login');
  try {
    const a = await differential(pair, {
      steps: GET_STEPS.map((s) => (s.tokenHeader
        ? { ...s, headers: { ...(s.headers || {}), [s.tokenHeader[0]]: s.tokenHeader[1] } }
        : s)),
      probe: async (DB) => ({
        sessions: (await DB.prepare('SELECT token FROM sessions ORDER BY token').all()).results.map((r) => r.token),
      }),
    });
    assert.equal(a.steps.length, GET_STEPS.length);
    assert.ok(a.sql.length >= 45, `SQL 条数只有 ${a.sql.length}，GET 分支可能没跑到`);

    const S = byLabel(a.steps);
    const json = (label) => S[label].json;
    assert.deepEqual(json('无 token'), { ok: false, error: '请先登录' });
    assert.deepEqual(json('不存在的 token'), { ok: false, error: '请先登录' });
    assert.deepEqual(json('过期会话'), { ok: false, error: '请先登录' });
    assert.deepEqual(json('expires_at 非法'), { ok: false, error: '请先登录' });

    // 玩家
    assert.equal(S['玩家会话'].status, 200);
    assert.equal(json('玩家会话').role, 'player');
    assert.equal(json('玩家会话').player.username, 'alice');
    assert.equal(json('玩家会话').user.username, 'alice', 'user 就是 player 本身');
    assert.equal(json('玩家会话').player.linked_admin_id, null);
    assert.equal(json('玩家会话').admin, null);
    assert.equal(json('玩家会话').hotel_owner, null);
    assert.equal(json('玩家会话').combined, false);
    assert.deepEqual(Object.keys(json('玩家会话')).sort(), ['admin', 'combined', 'hotel_owner', 'ok', 'player', 'role', 'user'],
      'GET 返回的字段集合变了');

    // 管理员
    assert.equal(json('管理员会话').role, 'super', 'role 取自 admins.role');
    assert.equal(json('管理员会话').admin.username, 'root');
    assert.equal(json('管理员会话').player, null);
    assert.equal(json('管理员会话').combined, false);

    // 合并
    assert.equal(json('合并会话').combined, true, '玩家+管理员同会话 → combined');
    assert.equal(json('合并会话').role, 'admin', '合并会话里 role 以管理员为准');
    assert.equal(json('合并会话').player.username, 'bob');
    assert.equal(json('合并会话').admin.username, 'wzc');

    // 酒店老板
    assert.equal(json('酒店老板会话').role, 'hotel_owner');
    assert.deepEqual(json('酒店老板会话').hotel_owner, { id: 1, username: 'owner', linked_player_id: 7 });
    assert.equal(json('会话里的 owner 优先于反查').hotel_owner.id, 3, '会话里的 owner3 应压过按玩家 7 反查到的 owner1');
    assert.deepEqual(json('owner 停用且无其他身份'), { ok: false, error: '会话已失效' });
    assert.deepEqual(json('会话三种身份全空'), { ok: false, error: '会话已失效' });
    assert.deepEqual(json('玩家停用且无管理员'), { ok: false, error: '会话已失效' });
    assert.deepEqual(json('会话指向不存在的玩家'), { ok: false, error: '会话已失效' });
    assert.deepEqual(json('管理员已被删'), { ok: false, error: '会话已失效' });

    assert.equal(S['玩家停用但管理员在'].status, 200, '玩家停用但管理员还在，仍能查到身份');
    assert.equal(json('玩家停用但管理员在').player, null);
    assert.equal(json('玩家停用但管理员在').role, 'super');
    assert.equal(json('玩家停用但管理员在').combined, false);

    // 绑定三条判定
    assert.equal(json('互认绑定应保留').player.linked_admin_id, 2, '互认绑定必须保留');
    assert.equal(json('互认绑定应保留').user.linked_admin_id, 2, 'user 与 player 同一个对象，绑定要一起看');
    assert.equal(json('悬空绑定应抹掉').player.linked_admin_id, null, '指向不存在的管理员 → 抹掉');
    assert.equal(json('不互认的绑定应抹掉').player.linked_admin_id, null, '管理员没反向绑定 → 抹掉');
    assert.equal(json('管理员绑着玩家').admin.username, 'wzc');
    assert.equal(json('管理员绑着不存在的玩家').admin.username, 'ghost', '绑定的玩家查不到时仍回管理员自己');

    // 取 token 的三种方式
    assert.equal(S['X-Session-Token 取 token'].status, 200);
    assert.equal(json('X-Session-Token 取 token').player.username, 'alice');
    assert.equal(json('Authorization Bearer').admin.username, 'root', 'Authorization: Bearer 也要认');
    assert.equal(json('Authorization 裸值').player.username, 'alice', 'Authorization 裸值也要认');

    // 过期 / 非法时间的会话被顺手删掉，其余必须一动不动
    assert.deepEqual(a.probe.sessions, SESSIONS.map((s) => s[0]).filter((t) => t !== 's-expired' && t !== 's-badtime').sort(),
      '只有过期与非法时间的会话该被删');
    // 悬空绑定的判定必须真的发过那条互认校验 SQL
    assert.ok(a.sql.includes('SELECT id FROM admins WHERE id=? AND linked_player_id=?'),
      '没看到 linked_player_id 的互认校验 SQL —— 绑定抹除判定可能没跑到');
  } finally {
    pair.cleanup();
  }
});

test('login DELETE：退出会话并清 cookie，两版一致', async () => {
  const pair = await loadPair(LOGIN, 'login');
  try {
    const a = await differential(pair, {
      steps: [
        { label: '正常退出', method: 'DELETE', token: 's-player' },
        { label: '重复退出', method: 'DELETE', token: 's-player' },
        { label: '无 token 退出', method: 'DELETE', token: null },
        { label: '不存在的 token 退出', method: 'DELETE', token: 'no-such-token' },
        { label: '退出管理员会话', method: 'DELETE', token: 's-admin' },
      ],
      probe: async (DB) => ({
        sessions: (await DB.prepare('SELECT token FROM sessions ORDER BY token').all()).results.map((r) => r.token),
      }),
    });
    assert.deepEqual(statuses(a.steps), [200, 200, 200, 200, 200]);
    assert.deepEqual(byLabel(a.steps)['正常退出'].json, { ok: true, logged_out: true });
    assert.equal(byLabel(a.steps)['正常退出'].headers['set-cookie'],
      'lc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0', '退出 cookie 必须把 Max-Age 归零');
    assert.deepEqual(a.probe.sessions, SESSIONS.map((s) => s[0]).filter((t) => t !== 's-player' && t !== 's-admin').sort(),
      '只能删掉被点名的那两个会话');
  } finally {
    pair.cleanup();
  }
});

test('login 端到端：过真中间件（登录设备历史 + 统一响应头），两版一致', async () => {
  const pair = await loadPair(LOGIN, 'login');
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  try {
    const a = await differential(pair, {
      steps: [
        { label: '登录', method: 'POST', body: { username: 'alice', password: PW }, headers: { 'User-Agent': ua }, through: true },
        { label: '用新 cookie 查自己', method: 'GET', useTokenFrom: 0, through: true },
        { label: '管理员也登一次', method: 'POST', body: { username: 'root', password: PW, target: 'admin' }, headers: { 'User-Agent': ua }, through: true },
        { label: '退出', method: 'DELETE', useTokenFrom: 0, through: true },
        { label: '退出后查自己', method: 'GET', useTokenFrom: 0, through: true },
      ],
      probe: async (DB) => ({
        // probe 里的行也要 squash：走的是原始结果，不经过 snapshot()，created_at 是真实时钟
        history: (await DB.prepare('SELECT * FROM login_history ORDER BY id').all()).results.map(squash),
        devices: (await DB.prepare("SELECT token,player_id,device_label FROM sessions WHERE token NOT LIKE 's-%' ORDER BY token").all())
          .results.map((r) => `${r.player_id ? 'player' : 'admin'}:${r.device_label}`),
        leftovers: (await DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token NOT LIKE 's-%'").first()).n,
      }),
    });
    const got = byLabel(a.steps);
    assert.equal(a.steps.length, 5);
    assert.deepEqual(statuses(a.steps), [200, 200, 200, 200, 401]);
    assert.equal(got['登录'].headers['x-request-id'], '20000000-0000-4000-8000-000000000001');
    assert.equal(got['登录'].headers['x-content-type-options'], 'nosniff');
    assert.equal(got['登录'].headers['cache-control'], 'no-store');
    assert.deepEqual(got['用新 cookie 查自己'].json.player.username, 'alice');
    assert.deepEqual(got['管理员也登一次'].json, { ok: true, user_id: 1, role: 'super' });
    assert.deepEqual(got['退出'].json, { ok: true, logged_out: true });
    assert.deepEqual(got['退出后查自己'].json, { ok: false, error: '请先登录' });
    assert.ok(a.probe.history.length >= 1, '中间件应记下登录设备历史');
    assert.equal(a.probe.history[0].method, 'password');
    assert.equal(a.probe.history[0].device_label, 'macOS · Safari');
    // 设备标签只打在带 player_id 的会话上；玩家那条在第 4 步已退出，只剩管理员那条未被打标
    assert.deepEqual(a.probe.devices, ['admin:未记录设备'], '会话上的设备标签不对');
    assert.equal(a.probe.leftovers, 1, '退出后玩家会话应被销毁，只剩管理员那条');
  } finally {
    pair.cleanup();
  }
});

test('_helpers：parseSession / resolveSubject* / getRpId / getOrigin / ok / err 两版一致', async () => {
  const pair = await loadPair(HELPERS, 'helpers');
  const NAMES = ['parseSession', 'resolveSubjectFromSession', 'resolveSubjectByUsername', 'getRpId', 'getOrigin', 'ok', 'err'];
  try {
    for (const n of NAMES) {
      assert.equal(typeof pair.old[n], 'function', `基线 _helpers 少了 ${n}`);
      assert.equal(typeof pair.new[n], 'function', `现版 _helpers 少了 ${n}`);
    }
    const run = async (mod) => {
      const f = await seeded();
      try {
        await assertFixture(f.DB);
        const sql = [];
        const env = { DB: tracedDb(f.DB, sql) };
        const withCookie = (c) => new Request('https://local.test/api/x', { headers: c ? { Cookie: c } : {} });
        const out = {};

        // parseSession：只认 Cookie
        out.noCookie = await mod.parseSession(env, withCookie(null));
        out.otherCookie = await mod.parseSession(env, withCookie('other=1'));
        out.playerCookie = await mod.parseSession(env, withCookie('a=1; lc_session=s-player; b=2'));
        out.adminCookie = await mod.parseSession(env, withCookie('lc_session=s-admin'));
        out.adminLinkCookie = await mod.parseSession(env, withCookie('lc_session=s-adminlink'));
        out.ghostCookie = await mod.parseSession(env, withCookie('lc_session=no-such-token'));
        out.expiredCookie = await mod.parseSession(env, withCookie('lc_session=s-expired'));
        out.headerOnly = await mod.parseSession(env, new Request('https://local.test/api/x', { headers: { 'X-Session-Token': 's-player' } }));
        out.authOnly = await mod.parseSession(env, new Request('https://local.test/api/x', { headers: { Authorization: 'Bearer s-admin' } }));

        // resolveSubjectFromSession
        out.sNull = await mod.resolveSubjectFromSession(env, null);
        out.sPlayer = await mod.resolveSubjectFromSession(env, sessionRow('s-player'));
        out.sBanned = await mod.resolveSubjectFromSession(env, sessionRow('s-banned'));
        out.sGhost = await mod.resolveSubjectFromSession(env, sessionRow('s-ghost'));
        out.sAdmin = await mod.resolveSubjectFromSession(env, sessionRow('s-admin'));
        out.sAdminLink = await mod.resolveSubjectFromSession(env, sessionRow('s-adminlink'));
        out.sAdminGhost = await mod.resolveSubjectFromSession(env, sessionRow('s-adminghost'));
        out.sLost = await mod.resolveSubjectFromSession(env, sessionRow('s-lost'));
        out.sOwner = await mod.resolveSubjectFromSession(env, sessionRow('s-owner'));
        out.sOwnerBeats = await mod.resolveSubjectFromSession(env, sessionRow('s-owner-beats'));
        out.sEmpty = await mod.resolveSubjectFromSession(env, sessionRow('s-empty'));
        out.sBoth = await mod.resolveSubjectFromSession(env, sessionRow('s-both'));
        out.sMissingAll = await mod.resolveSubjectFromSession(env, {});
        out.sZero = await mod.resolveSubjectFromSession(env, { player_id: 0, admin_id: 0 });

        // resolveSubjectByUsername
        out.uPlayer = await mod.resolveSubjectByUsername(env, 'alice');
        out.uBanned = await mod.resolveSubjectByUsername(env, 'banned');
        out.uPending = await mod.resolveSubjectByUsername(env, 'pending');
        out.uAdmin = await mod.resolveSubjectByUsername(env, 'root');
        out.uAdmin2 = await mod.resolveSubjectByUsername(env, 'auditor');
        out.uMissing = await mod.resolveSubjectByUsername(env, '不存在');
        out.uEmpty = await mod.resolveSubjectByUsername(env, '');
        out.uHotelOwner = await mod.resolveSubjectByUsername(env, 'owner');
        out.uCase = await mod.resolveSubjectByUsername(env, 'ALICE');

        // 纯函数
        out.rp = ['https://www.local.test/api/x', 'https://local.test/api/x', 'https://a.b.c.test/x', 'http://localhost:8787/x']
          .map((u) => mod.getRpId(new Request(u)));
        out.origin = ['https://local.test/api/x', 'http://localhost:8787/x'].map((u) => mod.getOrigin(new Request(u)));
        out.ok = [
          await describeResponse(mod.ok({})),
          await describeResponse(mod.ok({ id: 1, ok: false })),
          await describeResponse(mod.ok({ n: 1, s: '灯' })),
        ];
        out.err = [
          await describeResponse(mod.err(400, '不好')),
          await describeResponse(mod.err(503, '没了')),
          await describeResponse(mod.err(599, '')),
        ];

        return { out, db: await snapshot(f.DB), sql };
      } finally {
        f.close();
      }
    };

    const a = await run(pair.old);
    const b = await run(pair.new);
    assert.deepEqual(b.out, a.out, '_helpers 各函数两版返回不一致');
    assert.deepEqual(b.sql, a.sql, '_helpers 发出去的 SQL 逐字不一致（多查一次 / 少一个 WHERE 都会被抓到）');
    assert.deepEqual(b.db, a.db, '_helpers 跑完的全库快照不一致');
    assert.equal(Object.keys(a.out).length, 36, 'helper 场景数对不上');
    // 防假绿：锁住「真的发过查询」——只比返回值的话，多查一次库是看不出来的
    assert.deepEqual(a.sql, HELPERS_SQL, '_helpers 发出去的 SQL 序列与钉死的清单不符');

    // ---- 防假绿：锁住 helper 的关键判定 ----
    assert.deepEqual(a.out.noCookie, { sess: null, me: null });
    assert.deepEqual(a.out.otherCookie, { sess: null, me: null });
    assert.equal(a.out.playerCookie.sess.player_id, 1);
    assert.equal(a.out.playerCookie.me, null, '玩家会话不该解析出管理员');
    assert.deepEqual(a.out.adminCookie.me, { id: 1, role: 'super', username: 'root' });
    assert.deepEqual(a.out.adminLinkCookie.me, { id: 2, role: 'admin', username: 'wzc' });
    assert.deepEqual(a.out.ghostCookie, { sess: null, me: null });
    assert.deepEqual(a.out.expiredCookie, { sess: null, me: null }, '过期会话按未登录处理');
    assert.deepEqual(a.out.headerOnly, { sess: null, me: null }, 'parseSession 只认 Cookie，不看 X-Session-Token');
    assert.deepEqual(a.out.authOnly, { sess: null, me: null }, 'parseSession 只认 Cookie，不看 Authorization');

    assert.equal(a.out.sNull, null);
    assert.deepEqual(a.out.sBanned, null, '停用玩家不解析出 subject');
    assert.deepEqual(a.out.sGhost, null);
    assert.deepEqual(a.out.sLost, null, '管理员查不到就返回 null');
    assert.deepEqual(a.out.sOwner, null, '酒店老板身份不是 subject 的来源');
    assert.deepEqual(a.out.sOwnerBeats, { id: 7, username: 'frida', kind: 'player' },
      '带 player_id 的会话先按玩家解析，不看 hotel_owner_id');
    assert.deepEqual(a.out.sEmpty, null);
    assert.deepEqual(a.out.sMissingAll, null);
    assert.deepEqual(a.out.sZero, null);
    assert.deepEqual(a.out.sPlayer, { id: 1, username: 'alice', kind: 'player' });
    assert.equal(a.out.sBoth.kind, 'player', '玩家身份优先于管理员');
    assert.deepEqual(a.out.sAdmin, { id: 1, username: 'root', role: 'super', linked_player_id: null, kind: 'admin' });
    assert.deepEqual(a.out.sAdminLink, { id: 2, username: 'bob', kind: 'player', _via_admin: 2, _admin_username: 'wzc' },
      '管理员绑着玩家时应回退成该玩家');
    assert.equal(a.out.sAdminGhost.username, 'ghost', '绑定的玩家查不到时回管理员自己');
    assert.equal(a.out.sAdminGhost.kind, 'admin');
    assert.equal(a.out.sAdminGhost._via_admin, undefined);

    assert.deepEqual(a.out.uPlayer, { id: 1, username: 'alice', kind: 'player' });
    assert.equal(a.out.uBanned, null, '停用玩家按用户名查不到');
    assert.equal(a.out.uPending, null, '待审玩家按用户名查不到');
    assert.deepEqual(a.out.uAdmin, { id: 1, username: 'root', role: 'super', kind: 'admin' });
    assert.equal(a.out.uAdmin2.role, 'admin');
    assert.equal(a.out.uMissing, null);
    assert.equal(a.out.uEmpty, null);
    assert.equal(a.out.uHotelOwner, null, '酒店老板不在 subject 的两个来源里');
    assert.equal(a.out.uCase, null, '用户名区分大小写');

    assert.deepEqual(a.out.rp, ['local.test', 'local.test', 'a.b.c.test', 'localhost']);
    assert.deepEqual(a.out.origin, ['https://local.test', 'http://localhost:8787']);
    assert.equal(a.out.ok[0].status, 200);
    assert.equal(a.out.ok[0].json.ok, true);
    assert.equal(a.out.ok[1].json.ok, false, 'ok() 里 data 的 ok 会覆盖 true');
    assert.equal(a.out.ok[2].json.s, '灯');
    assert.deepEqual(a.out.ok[0].headers, { 'content-type': 'application/json; charset=utf-8' });
    assert.equal(a.out.err[0].status, 400);
    assert.deepEqual(a.out.err[0].json, { ok: false, error: '不好' });
    assert.equal(a.out.err[2].status, 599, 'err 不该自己限制状态码');
  } finally {
    pair.cleanup();
  }
});
