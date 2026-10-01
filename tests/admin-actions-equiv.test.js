// functions/api/actions/ 下两个高风险路由的行为差分守门。
//
// 背景：v88.7 的「去压缩」重写跨了 118 个后端文件，但下面这两个文件在重写前
// **没有一条行为验证**，而它们恰好是这一轮里最可疑的三个：
//
//   1. admin-passkey-debug.js —— 文件名带 debug，三个端点全 super only，
//      里面还有一处 DELETE FROM passkeys（无 WHERE 上限、无二次确认）。
//      上一轮审查只确认了「匿名/玩家/管理员/super 返回 401/401/403/200」，
//      那是**鉴权矩阵**，不是行为验证：三个 action 各自的成功分支、
//      参数边界、错误分支，一条都没跑过。
//
//   2. admin-player.js —— 2 行 / 最长 209 字符，整个文件就是一句话：
//      action==='admin-player-list' 时**把 request 换成 new Request(url,{headers})**
//      （于是 method 变回 GET），否则原样透传。这是 init.js:96 上所有
//      admin-player-* 动作的唯一入口，改错了前端整页管理员列表就没了。
//      注意：这个改写是**有意的**，重写时不能「顺手修掉」。
//
//   3. ~~announcements.js~~ —— 原先也是这一列的第三个：全仓库无人 import 的
//      孤儿，只能靠直接 POST 非文档 URL 命中，与正规实现已漂移，且有三个
//      已坐实缺陷（parseInt 太宽松 / 放行 data:image/svg+xml / SQL 错误外泄）。
//      **已于 6608a46 之后删除**，理由：它没有任何调用方，正规公告路由走
//      init.js:99-107 → _core/resources.js（那条路有 notification_log 扇出、
//      严格图片白名单）。留着等于让一套校验更松的实现继续可路由。
//      那三个缺陷随文件一起消失，不必再逐条钉。
//
// 上一轮就是这么翻车的：重写完只验 export 名单没变，结果 exam-sessions.js
// 的 action 白名单被兜底 return 吃掉（delete / SUBMIT / start 全从 400 变 200），
// 而 export 名单检查和当时的 268 个测试**全都发现不了**。所以这里不比 export，
// 比真库上的逐场景行为。
//
// 每个文件跑**完全相同的有序输入序列**（同一份库、同样的调用顺序），
// 逐场景比对：HTTP 状态码 / 解析后的 JSON / 抛出的异常 / console.error 次数 /
// 逐条 SQL（带 bind 参数）/ 全库所有表的完整快照。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, readdirSync } from 'node:fs';
import { database, dispatch } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';
import { verifyPassword } from '../functions/_shared/auth.js';

const BASELINE = '06e9595';

const TARGETS = {
  passkey: 'functions/api/actions/admin-passkey-debug.js',
  player: 'functions/api/actions/admin-player.js',
};

const show = (path) =>
  execSync(`git show ${BASELINE}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 28 });

// ---------------------------------------------------------------------------
// 基线副本的落盘
//
// 副本必须待在原目录（functions/api/actions/），它内部的 '../../_core/xxx.js'
// 相对 import 才成立。文件名必须与原模块不同：ESM 按绝对路径缓存，同名会让
// 两版拿到同一个模块对象，差分直接白做 —— 所以用 .mjs 后缀 + 进程号。
// 清理时**只认本进程登记过的路径**，绝不扫全仓库（有并发进程在跑）。
// ---------------------------------------------------------------------------
const ownedTmpFiles = new Set();
let tmpSeq = 0;

async function loadBoth(path) {
  const slug = path.replace(/^functions\/api\/actions\//, '').replace(/\.js$/, '');
  const rel = 'functions/api/actions/' + `.equiv-${process.pid}-${++tmpSeq}-${slug}.mjs`;
  writeFileSync(rel, show(path));            // 相对 cwd（仓库根）
  ownedTmpFiles.add(rel);
  const oldM = await import('../' + rel);  // import 相对本文件（tests/）
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
// 这里只清临时副本，**不碰数据库**（原因见 seeded() 的注释）。
process.on('exit', cleanupTmpFiles);
process.on('uncaughtException', (e) => {
  cleanupTmpFiles();
  throw e;
});

// ---------------------------------------------------------------------------
// 代理 DB：逐条记录 SQL 文本 + bind 参数
//
// 为什么连 params 一起比：改 bind 参数（比如 parseInt 换成 Number、LIKE 少了 %）
// 不会改 SQL 文本，只改送进去的值。
// 注意：Statement.first() 内部会调 all()，所以要包一层而不是直接透传，
// 否则一次 first() 会被记成两条，序列比对凭空多一项。
// ---------------------------------------------------------------------------
const normSql = (s) => String(s).replace(/\s+/g, ' ').trim();

/**
 * 绑进 SQL 的随机盐要折叠：hashPassword() 的 salt 是 crypto 随机数，
 * INSERT INTO players 把它当参数带进去，两版必然不同 —— 那是假差异。
 * 折叠的是 32/64 位的小写 hex（正好是 salt 与 PBKDF2 hash 的形状）。
 * 「哈希是否真对应提交的明文」由专项用例拿 verifyPassword 验，不靠比对随机字节。
 */
const HEXY = /^(?:[0-9a-f]{32}|[0-9a-f]{64})$/;
const tracedParams = (params) => params.map((p) => (typeof p === 'string' && HEXY.test(p) ? '<hash>' : p));

function traceDb(DB, log) {
  const wrap = (st) => ({
    sql: st.sql,
    params: st.params,
    bind: (...p) => wrap(st.bind(...p)),
    all: () => { log.push({ sql: normSql(st.sql), params: tracedParams(st.params) }); return st.all(); },
    run: () => { log.push({ sql: normSql(st.sql), params: tracedParams(st.params) }); return st.run(); },
    first: (c) => { log.push({ sql: normSql(st.sql), params: tracedParams(st.params) }); return st.first(c); },
  });
  return { prepare: (sql) => wrap(DB.prepare(sql)), batch: (items) => DB.batch(items) };
}

// 本次运行开始时刻：用来判断某个时间戳是不是「本次运行现生成的」
const RUN_START = Date.now();
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * 折叠本次运行现生成的墙钟时间。
 *
 * 哪些值会中招：announcements 的 created_at / updated_at 都是列默认值
 * datetime('now')，announcement-update 的 SQL 里还写死了 datetime('now')。
 * 两版各建一份库、隔几秒跑，值必然不同 —— 那是**假差异**。
 * fixture 里显式写死的时间戳（2026-01-01 等）不在窗口内，逐字保留、照常比对。
 * 有专门的用例断言「这些格子确实落在运行窗口内」，所以把 datetime('now')
 * 换成硬编码常量照样会被抓住。
 */
function freshStamp(v) {
  if (typeof v !== 'string' || !STAMP.test(v)) return v;
  const t = Date.parse(v.replace(' ', 'T') + 'Z');   // SQLite datetime() 是 UTC
  return t >= RUN_START - 120_000 && t <= Date.now() + 120_000 ? '<now>' : v;
}

// password_hash / salt 含随机盐：hashPassword(password) 的 salt 是 crypto 随机数，
// 两版必然不同。折叠成 <hash>，但把真值交出去给专项用例验（见 T4）。
const HASH_COLS = new Set(['password_hash', 'salt']);
const HASH_TABLES = new Set(['players', 'admins']);

/**
 * 建一份全新的真库。
 *
 * close() 幂等，且每条用例都必须在 finally 里显式调它：database() 会 fork 一个
 * python3 SQLite 子进程，子进程不退 node 就不退，test runner 永远等不到结束。
 * 只挂 process.on('exit') 兜底是没用的 —— 那个钩子要等进程即将退出才跑，而恰恰是
 * 这些活着的子进程阻止了退出，等于死锁。也不用 process.exit（会吞掉 TAP 输出）。
 */
async function seeded() {
  const DB = database();
  await ensureDatabase(DB);
  const log = [];
  let closed = false;

  // 全部显式写死时间戳：库里大量列的默认值是 datetime('now')，两版各建一份库，
  // INSERT 时刻差几秒就会让全库快照对不上 —— 那种「差异」是假差异。
  const T = '2026-01-01 00:00:00';

  // 4 个市民：列表分支的 ORDER BY id DESC 与 LIKE 过滤都靠它们被数出来
  const players = [
    [1, 'citizen', 'c1@example.invalid', 'GI1', 'active', '第一个市民', 1000],
    [2, 'builder', 'c2@example.invalid', 'GI2', 'active', '第二个市民', 500],
    [3, 'blocked', 'c3@example.invalid', 'GI3', 'rejected', '已停用市民', 0],
    [4, 'newbie', 'c4@example.invalid', 'GI4', 'active', '第四个市民', 77],
  ];
  for (const [id, name, email, game, status, bio, emeralds] of players) {
    await DB.prepare(
      'INSERT INTO players(id,username,email,game_id,password_hash,salt,status,bio,avatar_emoji,emeralds,created_at,linked_admin_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)'
    ).bind(id, name, email, game, 'x', 'x', status, bio, '🙂', emeralds, T).run();
  }

  // 2 个管理员：1 个 super、1 个普通 admin（角色决定 403 还是放行）
  await DB.prepare(
    "INSERT INTO admins(id,username,password_hash,salt,role,created_at) VALUES(1,'super','x','x','super',?)"
  ).bind(T).run();
  await DB.prepare(
    "INSERT INTO admins(id,username,password_hash,salt,role,created_at) VALUES(2,'wzc','x','x','admin',?)"
  ).bind(T).run();

  // 会话覆盖匿名/玩家/管理员/super 四档，外加三个边界：
  //   expired —— 过期，getSession 会顺手把它删掉（快照里看得见）
  //   ghost   —— admin_id 指向不存在的管理员行（快照里 me 为 null）
  //   both    —— 玩家+管理员合并账号，两份身份都在（admin-passkey-debug 认
  //              sess.admin_id，announcements 也认，所以它能过鉴权）
  const sessions = [
    ['player', 1, null, '2099-01-01 00:00:00'],
    ['admin2', null, 2, '2099-01-01 00:00:00'],
    ['super', null, 1, '2099-01-01 00:00:00'],
    ['expired', null, 1, '2000-01-01 00:00:00'],
    ['ghost', null, 999, '2099-01-01 00:00:00'],
    ['both', 1, 1, '2099-01-01 00:00:00'],
  ];
  for (const [token, playerId, adminId, expires] of sessions) {
    await DB.prepare(
      'INSERT INTO sessions(token,player_id,admin_id,expires_at,created_at) VALUES(?,?,?,?,?)'
    ).bind(token, playerId, adminId, expires, T).run();
  }

  // passkey 与公告数据（helper 定义在下方，函数声明会提升）
  await seededPasskeys(DB);
  await seedAnnouncements(DB);

  return {
    DB,
    log,
    env: { DB: traceDb(DB, log) },
    close: () => {
      if (closed) return;
      closed = true;
      try { DB.close(); } catch {}
    },
  };
}

/** 5 条公告，供 delete / update 的 id 分支用 */
async function seedAnnouncements(DB) {
  await DB.prepare('DELETE FROM announcements').run();
  const rows = [
    [1, '东门施工维护通知', '东门施工预计于本月末恢复，恢复前请注意绕行。', 'https://local.test/a.png', 1, '2026-01-01 00:00:00', null],
    [2, '广场嘉年华预告', '本周六中央广场举办嘉年华活动，欢迎参加。', null, 1, '2026-01-02 00:00:00', '2026-01-03 00:00:00'],
    [3, '地下集市开张', '地下集市现已开张，欢迎前来。', 'data:image/png;base64,AAA', 2, '2026-01-04 00:00:00', null],
    [4, '会先被误删的公告', '这条公告的 id 会被 parseInt 误伤。', null, 1, '2026-01-05 00:00:00', null],
    [5, '会被 update 覆盖的公告', '这条公告的 image_url 会被改成 null。', 'https://local.test/old.png', 1, '2026-01-06 00:00:00', null],
  ];
  for (const [id, title, content, image, by, created, updated] of rows) {
    await DB.prepare(
      'INSERT INTO announcements(id,title,content,image_url,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
    ).bind(id, title, content, image, by, created, updated).run();
  }
}
// ---------------------------------------------------------------------------
// 全库快照
// ---------------------------------------------------------------------------

/**
 * 所有表的所有行。
 *
 * 排除 lc_schema_versions：applied_at 默认 CURRENT_TIMESTAMP，两版各建一次库
 * 必然差几秒，是假差异；改成只比 version 号，schema 是否真的建齐照样能查出来。
 * 行在 JS 里按 JSON 排序而不是靠 SQL ORDER BY —— 免得碰上 WITHOUT ROWID 表和
 * 混合类型排序的坑。
 *
 * 返回 { snap, creds }：creds 里是 players/admins 密码列的真值（被折叠前先抄一份），
 * 供 T4 拿 verifyPassword 验「哈希确实对应提交的明文」—— 这比比对随机盐强得多。
 */
async function snapshotAll(DB) {
  const names = (await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all()).results.map((r) => r.name);
  const snap = {};
  const creds = { players: {}, admins: {} };
  for (const name of names) {
    if (name === 'lc_schema_versions') continue;
    const rows = (await DB.prepare(`SELECT * FROM "${name}"`).all()).results;
    snap[name] = rows
      .map((r) => {
        const out = {};
        for (const k of Object.keys(r)) {
          if (HASH_TABLES.has(name) && HASH_COLS.has(k)) {
            creds[name][`${r.id}:${r.username}`] = { hash: r[k], table: name };
            out[k] = '<hash>';
            continue;
          }
          out[k] = freshStamp(r[k]);
        }
        return JSON.stringify(out);
      })
      .sort();
  }
  snap.__schema_versions__ = (await DB.prepare('SELECT version FROM lc_schema_versions ORDER BY version').all())
    .results.map((r) => r.version);
  return { snap, creds };
}

// ---------------------------------------------------------------------------
// 跑一个场景
// ---------------------------------------------------------------------------

const URLS = {
  passkey: 'https://local.test/api/actions/admin-passkey-debug',
  player: 'https://local.test/api/init',
};

const qs = (base, obj = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    p.append(k, String(v));
  }
  const s = p.toString();
  return s ? base + '?' + s : base;
};

/**
 * 调用一次 handler，把四类可观测结果全收上来。
 *
 * console.error 只记**次数**不记内容：endpoint() 打的是错误对象，
 * 序列化后带文件路径与行号，基线副本和现版路径本来就不同，逐字比全是假差异。
 * 次数本身是有意义的信号：多一条日志 = 多了一条以前没走过的错误路径。
 */
async function runOne(mod, f, sc) {
  if (sc.before) await sc.before(f.DB);
  const mark = f.log.length;
  const headers = new Headers({ 'Content-Type': 'application/json', ...(sc.headers || {}) });
  const raw = sc.rawBody !== undefined ? sc.rawBody : sc.body === undefined ? undefined : JSON.stringify(sc.body);
  const request = new Request(sc.url, {
    method: sc.method || 'POST',
    headers,
    body: raw === undefined ? undefined : raw,
  });
  const env = sc.noDB ? {} : f.env;
  const context = { request, env, waitUntil: (p) => Promise.resolve(p).catch(() => {}) };

  let http = null;
  let payload;
  let threw = null;
  let errCount = 0;
  const realErr = console.error;
  console.error = () => { errCount++; };
  try {
    const r = await mod.onRequestPost(context);
    http = r.status;
    try { payload = await r.json(); } catch { payload = '<非 JSON 响应>'; }
  } catch (e) {
    threw = e?.message ?? String(e);
  } finally {
    console.error = realErr;
  }
  return { http, payload, threw, errCount, sql: f.log.slice(mark) };
}

/** 两版跑同一条有序序列 */
async function runAll(mod, fixture, list) {
  const f = fixture;
  const results = [];
  try {
    for (const sc of list) results.push({ label: sc.label, ...(await runOne(mod, f, sc)) });
    return { results, snap: await snapshotAll(f.DB) };
  } finally {
    f.close();
  }
}

function firstDiff(a, b, path = '') {
  if (Object.is(a, b)) return null;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return `${path || '<root>'}: 类型 ${ta} ≠ ${tb}`;
  if (ta !== 'object' && ta !== 'array') return `${path || '<root>'}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    if (!(k in a)) return `${path}.${k}: 新版多出 ${JSON.stringify(b[k])}`;
    if (!(k in b)) return `${path}.${k}: 新版缺少 ${JSON.stringify(a[k])}`;
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// §SCENARIOS：admin-passkey-debug.js
//
// 分支清单（读完代码定的，没猜）：
//   鉴权：parseSession 无 cookie / token 查不到 → 401；有 session 无 admin_id → 401；
//         过期 session（getSession 顺手删掉）→ 401；role≠super → 403；admins 行不在 → 403。
//   action=admin-passkey-debug：列全部 passkey，ORDER BY id DESC。
//   action=admin-passkey-fix-jwks：逐条 JSON.parse，crv==='P-256' && x && y 计数；
//         解析失败与「解析出 null/数字/数组」都走 per-row catch 跳过。
//   action=admin-passkey-reregister：player_id 走 parseInt(…, 10)，falsy → 400；
//         否则 DELETE FROM passkeys WHERE player_id = ?，返回 changes。
//   其他/缺省 action → 404。try 包裹三个分支 → 500。
// ---------------------------------------------------------------------------

const PK = (q) => qs(URLS.passkey, q);
const C = (token) => ({ Cookie: 'lc_session=' + token });
const VALID = '标题没问题的公告';
const BODY = { title: VALID, content: '内容没问题的公告正文' };

/** 把 passkeys 恢复成 fixture 的 10 条（reregister 有删操作，后面几条要重新数） */
async function resetPasskeys(DB) {
  await DB.prepare('DELETE FROM passkeys').run();
  await seededPasskeys(DB);
}
async function seededPasskeys(DB) {
  const T = '2026-01-01 00:00:00';
  const JWK_OK = '{"kty":"EC","crv":"P-256","x":"X1","y":"Y1"}';
  const passkeys = [
    [1, 1, null, 'citizen-laptop', JWK_OK, '2026-01-05 00:00:00'],
    [2, 1, null, 'citizen-phone', JWK_OK, null],
    [3, 2, null, 'builder-desktop', '{"crv":"P-256","x":"X2"}', null],
    [4, 2, null, 'builder-tablet', 'not-json', null],
    [5, 3, null, 'blocked-old', 'null', null],
    [6, null, 1, 'super-admin-key', '{"crv":"P-384","x":"A","y":"B"}', null],
    [7, 1, null, 'citizen-number', '123', null],
    [8, 1, null, 'citizen-array', '[]', null],
    [9, 2, null, 'builder-no-x', '{"crv":"P-256","y":"B"}', null],
    [10, 1, null, 'citizen-full', '{"kty":"EC","crv":"P-256","x":"X3","y":"Y3","kid":"k3"}', null],
  ];
  for (const [id, playerId, adminId, name, jwk, used] of passkeys) {
    await DB.prepare(
      "INSERT INTO passkeys(id,player_id,admin_id,name,credential_id,public_key_jwk,counter,transports,last_used_at,created_at) VALUES(?,?,?,?,?,?,0,NULL,?,?)"
    ).bind(id, playerId, adminId, name, 'cred' + id, jwk, used, T).run();
  }
}

const PK_SCENARIOS = [
  // --- 鉴权矩阵（action 用 admin-passkey-debug，四档身份都过一遍）---
  { label: '匿名：无 Cookie 头 → 401', url: PK({ action: 'admin-passkey-debug' }) },
  { label: '匿名：Cookie 为空串 → 401', url: PK({ action: 'admin-passkey-debug' }), headers: { Cookie: '' } },
  { label: '匿名：token 库里查不到 → 401', url: PK({ action: 'admin-passkey-debug' }), headers: C('nosuchtoken') },
  { label: '匿名：只有 X-Session-Token 头（不带 Cookie）→ 401（parseSession 只认 Cookie）', url: PK({ action: 'admin-passkey-debug' }), headers: { 'X-Session-Token': 'super' } },
  { label: '普通玩家会话（无 admin_id）→ 401', url: PK({ action: 'admin-passkey-debug' }), headers: C('player') },
  { label: '过期会话 → 401，且会话行被 getSession 顺手删掉', url: PK({ action: 'admin-passkey-debug' }), headers: C('expired') },
  { label: '普通管理员（role=admin）→ 403', url: PK({ action: 'admin-passkey-debug' }), headers: C('admin2') },
  { label: '会话指向已不存在的管理员行（me=null）→ 403', url: PK({ action: 'admin-passkey-debug' }), headers: C('ghost') },
  { label: '玩家+管理员合并账号（带 admin_id）→ 200', url: PK({ action: 'admin-passkey-debug' }), headers: C('both') },

  // --- action=admin-passkey-debug ---
  { label: 'super + admin-passkey-debug → 200，列全部 passkey（ORDER BY id DESC）', url: PK({ action: 'admin-passkey-debug' }), headers: C('super'), http: 200 },
  { label: 'super + action 重复出现两次 → searchParams.get 取第一个（admin-passkey-debug）', rawUrl: URLS.passkey + '?action=admin-passkey-debug&action=admin-passkey-reregister', headers: C('super'), http: 200 },
  { label: 'super + admin-passkey-fix-jwks → 200 计数（10 条里 3 条合法）', url: PK({ action: 'admin-passkey-fix-jwks' }), headers: C('super'), http: 200 },
  {
    label: 'super + admin-passkey-fix-jwks：库里一条 passkey 都没有 → total=0 valid=0',
    url: PK({ action: 'admin-passkey-fix-jwks' }), headers: C('super'), http: 200,
    before: async (DB) => { await DB.prepare('DELETE FROM passkeys').run(); },
  },
  { label: 'admin-passkey-fix-jwks：鉴权在 action 之前，普通管理员 → 403', url: PK({ action: 'admin-passkey-fix-jwks' }), headers: C('admin2'), http: 403 },
  { label: 'admin-passkey-reregister：普通管理员 → 403（body 根本不会被读）', url: PK({ action: 'admin-passkey-reregister' }), headers: C('admin2'), body: { player_id: 1 }, http: 403 },

  // --- action=admin-passkey-reregister：参数边界 ---
  { label: 'reregister player_id=1 → 200，删掉该玩家 3 条', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 1 }, http: 200, before: resetPasskeys },
  { label: 'reregister player_id=2 → 200，删掉 4 条（含解析失败那两条）', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 2 }, http: 200, before: resetPasskeys },
  { label: 'reregister player_id=3 → 200，一条都没有 → deleted=0', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 3 }, http: 200, before: resetPasskeys },
  { label: 'reregister player_id=1（管理员自己的）→ 200，只删 player_id 匹配的那条', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 1 }, http: 200, before: resetPasskeys },
  { label: 'reregister player_id=999（不存在）→ 200，deleted=0', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 999 }, http: 200, before: resetPasskeys },
  { label: 'reregister player_id=-5 → 已修：integer() 的 min=1 挡住负数', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: -5 }, http: 400, before: resetPasskeys },
  { label: 'reregister player_id=0 → 已修：400，文案换成 integer() 的标准提示', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 0 }, http: 400 },
  { label: 'reregister player_id="0"（字符串零）→ 已修：400，文案同上', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: '0' }, http: 400 },
  { label: 'reregister player_id="abc" → 已修：NaN 被 integer() 拒掉，文案同上', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 'abc' }, http: 400 },
  { label: 'reregister player_id=true → 已修：integer() 拒掉，文案同上', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: true }, http: 400 },
  { label: 'reregister body 是坏 JSON → 已修：仍 400，文案同上', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), rawBody: '{oops', http: 400 },
  { label: 'reregister 完全没有 body → 已修：仍 400，文案同上', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), http: 400 },
  // 注意对比：announcements.js 里同样的 JSON null 是**裸抛**（无 try），而这个文件
  // 的三个分支都在 try 里，所以同一类 TypeError 在这里被兜成 500。
  { label: 'reregister body 是 JSON null → null.player_id 抛 TypeError，但被外层 try 兜成 500', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), rawBody: 'null', http: 500 },
  // ↓ 2026-10-01 已修：player_id 改走 integer() 严格整数校验。
  // 原来用 parseInt，'1abc' / 1.9 都会被吃成 1，然后**真的**执行
  // `DELETE FROM passkeys WHERE player_id=1` —— 一次手滑就能删掉别人全部通行密钥。
  // 这四条现在全部 400，且一条 passkey 都不该被删（`before` 负责重置 fixture）。
  { label: 'reregister player_id="1abc" → 已修：严格整数校验拒掉，不删任何 passkey', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: '1abc' }, http: 400, before: resetPasskeys },
  { label: 'reregister player_id=1.9 → 已修：非整数拒掉', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 1.9 }, http: 400, before: resetPasskeys },
  // Number('0x10') === 16 —— JS 的 Number() 认十六进制字面量（不像 parseInt 传了
  // radix=10 就只认十进制）。它解析出的 16 是一个确定存在的玩家 id，不存在
  // 「打错一个字就删掉别人密钥」的风险，所以照常放行。
  { label: 'reregister player_id="0x10" → 已修：parseInt(radix=10) 得 0→400，Number() 得 16→200"', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: '0x10' }, http: 200, before: resetPasskeys },
  // ' 2 ' 照常 200：Number(' 2 ')===2，解析出的就是玩家 2 本人，不存在删错人的风险
  { label: 'reregister player_id=" 2 " → Number() 会 trim 空白，解析成 2，照常放行', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: ' 2 ' }, http: 200, before: resetPasskeys },

  // --- 未知 action ---
  { label: '不带 action 参数 → 404', url: PK(), headers: C('super'), http: 404 },
  { label: 'action=admin-passkey → 404', url: PK({ action: 'admin-passkey' }), headers: C('super'), http: 404 },
  { label: 'action=admin-passkey-debug-typo → 404（不做前缀匹配）', url: PK({ action: 'admin-passkey-debug-typo' }), headers: C('super'), http: 404 },
  { label: 'action=Admin-Passkey-Debug → 404（大小写敏感）', url: PK({ action: 'Admin-Passkey-Debug' }), headers: C('super'), http: 404 },
  { label: 'action=admin-passkey-reregister（超管也不给 player_id 时）→ 404? 不：给 400，见上', url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 1 }, http: 200, before: resetPasskeys },

  // --- try/catch → 500：用真库触发一条真 SQL 错误 ---
  // 注：SQLite 的 trigger 只有 BEFORE/AFTER INSERT|UPDATE|DELETE，**没有 BEFORE SELECT**，
  // 所以「SELECT 时报错」只能靠把表真删掉。删表场景必须排在该文件的最后一条，
  // 它之后的快照里这张表就不存在了（两版一样，不影响差分）。
  {
    label: 'reregister 命中 RAISE(ABORT) 触发器 → 500 debug 错误（异常被外层 try 兜住）',
    url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 1 }, http: 500,
    before: async (DB) => {
      await resetPasskeys(DB);
      await DB.prepare("CREATE TRIGGER boom_del BEFORE DELETE ON passkeys BEGIN SELECT RAISE(ABORT,'boom-del'); END").run();
    },
    after: async (DB) => { await DB.prepare('DROP TRIGGER boom_del').run(); },
  },
  {
    label: 'fix-jwks 时 passkeys 表整个不存在 → 500 debug 错误: no such table: passkeys',
    url: PK({ action: 'admin-passkey-fix-jwks' }), headers: C('super'), http: 500,
    before: async (DB) => { await DB.prepare('DROP TABLE IF EXISTS passkeys').run(); },
  },
  {
    label: 'admin-passkey-debug 时表也不存在 → 500 debug 错误: no such table: passkeys',
    url: PK({ action: 'admin-passkey-debug' }), headers: C('super'), http: 500,
  },
];

// ---------------------------------------------------------------------------
// §SCENARIOS：admin-player.js
//
// 分支清单：
//   改写：action==='admin-player-list' → request 换成 new Request(url,{headers})
//         （method 掉回 GET、body 丢掉），其余动作原样透传。
//   players() 鉴权：没登录 → 401；会话没 admin_id → 403；管理员行不在 → 401。
//   GET 分支：status / q 过滤（LIKE 未转义），ORDER BY id DESC LIMIT 500。
//   POST 分支：非 super → 403；然后 username / email / password / JSON 四道校验；
//              唯一约束 → 409；其余未预期异常 → 500（endpoint 兜底）。
// ---------------------------------------------------------------------------

const PL = (q) => qs(URLS.player, q);
const NEW_PLAYER = { username: 'newcomer', email: 'new@example.invalid', password: 'fixture-pass-123' };
// 顺序序列跑在同一个库上：每个成功创建的账号都必须用不同的 email，
// 否则第二条就撞 UNIQUE 变成 409，把「创建成功」这条分支盖掉。
let created = 0;
const freshPlayer = (over = {}) => ({
  username: 'newcomer' + (++created),
  email: 'new' + created + '@example.invalid',
  password: 'fixture-pass-123',
  ...over,
});

const PL_SCENARIOS = [
  // --- 列表分支 ---
  { label: 'admin-player-list + super → 200 全量列表（4 个市民，ORDER BY id DESC）', url: PL({ action: 'admin-player-list' }), headers: C('super'), http: 200 },
  { label: 'admin-player-list + 普通管理员 → 200（读不要求 super）', url: PL({ action: 'admin-player-list' }), headers: C('admin2'), http: 200 },
  { label: 'admin-player-list + 玩家会话 → 403 需要管理员权限', url: PL({ action: 'admin-player-list' }), headers: C('player'), http: 403 },
  { label: 'admin-player-list + 匿名 → 401 请先登录', url: PL({ action: 'admin-player-list' }), http: 401 },
  { label: 'admin-player-list + 过期会话 → 401（会话行被删）', url: PL({ action: 'admin-player-list' }), headers: C('expired'), http: 401 },
  { label: 'admin-player-list + 会话指向不存在的管理员 → 401 管理员账号已失效', url: PL({ action: 'admin-player-list' }), headers: C('ghost'), http: 401 },
  { label: 'admin-player-list + Authorization: Bearer → 200（readToken 认这个头）', url: PL({ action: 'admin-player-list' }), headers: { Authorization: 'Bearer super' }, http: 200 },
  { label: 'admin-player-list + Authorization 不带 Bearer 前缀 → 200', url: PL({ action: 'admin-player-list' }), headers: { Authorization: 'super' }, http: 200 },
  { label: 'admin-player-list + status=active → 200 过滤到 3 个', url: PL({ action: 'admin-player-list', status: 'active' }), headers: C('super'), http: 200 },
  { label: 'admin-player-list + status=rejected → 200 只剩 1 个', url: PL({ action: 'admin-player-list', status: 'rejected' }), headers: C('super'), http: 200 },
  { label: 'admin-player-list + status=bogus → 200 空数组（没有就少查一个字段，不报错）', url: PL({ action: 'admin-player-list', status: 'bogus' }), headers: C('super'), http: 200 },
  { label: 'admin-player-list + status=active&q=builder → 200 两条条件同时生效', url: PL({ action: 'admin-player-list', status: 'active', q: 'builder' }), headers: C('super'), http: 200 },
  { label: 'admin-player-list + q=citizen → 200 命中 username', url: PL({ action: 'admin-player-list', q: 'citizen' }), headers: C('super'), http: 200 },
  { label: 'admin-player-list + q=c2@example → 200 命中 email（username 与 email 都搜）', url: PL({ action: 'admin-player-list', q: 'c2@example' }), headers: C('super'), http: 200 },
  { label: 'admin-player-list + q=zzz → 200 空数组', url: PL({ action: 'admin-player-list', q: 'zzz' }), headers: C('super'), http: 200 },
  { label: 'admin-player-list + q=%（未转义的 LIKE 通配）→ 200 全部命中', url: PL({ action: 'admin-player-list', q: '%' }), headers: C('super'), http: 200 },
  { label: 'admin-player-list + q=_1（下划线也是 LIKE 单字符通配）→ 200', url: PL({ action: 'admin-player-list', q: '_1' }), headers: C('super'), http: 200 },
  { label: 'admin-player-list + q=xx%27 OR 1=1（注入串）→ 200 当普通字符处理', url: PL({ action: 'admin-player-list', q: "x' OR 1=1 --" }), headers: C('super'), http: 200 },
  { label: 'admin-player-list 且带着 POST body → 200 仍走列表分支（body 被丢掉）', url: PL({ action: 'admin-player-list' }), headers: C('super'), body: NEW_PLAYER, http: 200 },
  { label: 'admin-player-list + body + 普通管理员 → 200（改写生效的话不会掉进 POST 的 403）', url: PL({ action: 'admin-player-list' }), headers: C('admin2'), body: NEW_PLAYER, http: 200 },
  { label: '合成探针：方法本身是 PATCH 时，改写仍把它拉回 GET 分支 → 200（去掉改写会变 405）', url: PL({ action: 'admin-player-list' }), method: 'PATCH', headers: C('super'), http: 200 },
  { label: '合成探针：PATCH + 普通管理员 → 200（去掉改写会变 405/403）', url: PL({ action: 'admin-player-list' }), method: 'PATCH', headers: C('admin2'), http: 200 },

  // --- 创建分支（action 不等于 admin-player-list 就原样透传，于是走 POST）---
  { label: 'admin-player-create + super + 合法 body → 201，落库一条市民', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: freshPlayer(), http: 201 },
  { label: 'admin-player-create + 普通管理员 → 403 仅 SUPER 可创建账号', url: PL({ action: 'admin-player-create' }), headers: C('admin2'), body: NEW_PLAYER, http: 403 },
  { label: 'admin-player-create + 玩家会话 → 403 需要管理员权限', url: PL({ action: 'admin-player-create' }), headers: C('player'), body: NEW_PLAYER, http: 403 },
  { label: 'admin-player-create + 匿名 → 401', url: PL({ action: 'admin-player-create' }), body: NEW_PLAYER, http: 401 },
  { label: 'admin-player-approve（漂移：非 list 动作照样进创建分支）+ super → 201', url: PL({ action: 'admin-player-approve' }), headers: C('super'), body: freshPlayer(), http: 201 },
  { label: 'admin-player-approve + 普通管理员 → 403（不是走 PATCH 的 unknown 操作）', url: PL({ action: 'admin-player-approve' }), headers: C('admin2'), body: NEW_PLAYER, http: 403 },
  { label: 'action 参数出现两次：取第一个（admin-player-create 赢过后面的 list）→ 201', rawUrl: URLS.player + '?action=admin-player-create&action=admin-player-list', headers: C('super'), body: freshPlayer(), http: 201 },
  { label: '不带 action → 201（同样进创建分支；这是 init.js 用 startsWith 派发才安全的原因）', url: PL(), headers: C('super'), body: freshPlayer(), http: 201 },

  // --- 创建分支的四道入参校验 ---
  { label: 'create 缺 username → 400 游戏 ID 必须是文字', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { email: 'a@example.invalid', password: 'fixture-pass-123' }, http: 400 },
  { label: 'create username 为空串 → 400 游戏 ID 需填写且不超过 32 字符', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { ...NEW_PLAYER, username: '   ' }, http: 400 },
  { label: 'create username 超 32 字符 → 400 同一句', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { ...NEW_PLAYER, username: 'u'.repeat(33) }, http: 400 },
  { label: 'create username 是保留名 灯灯客服 → 400 游戏 ID 格式无效', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { ...NEW_PLAYER, username: '灯灯客服' }, http: 400 },
  { label: 'create username 含 @ → 400 游戏 ID 格式无效', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { ...NEW_PLAYER, username: 'a@b' }, http: 400 },
  { label: 'create username 含尖括号 → 400 游戏 ID 格式无效', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { ...NEW_PLAYER, username: 'a<b>' }, http: 400 },
  { label: 'create 缺 email → 400 邮箱必须是文字', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { username: 'okname', password: 'fixture-pass-123' }, http: 400 },
  { label: 'create email 不是邮箱 → 400 邮箱无效', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { ...NEW_PLAYER, email: 'nope' }, http: 400 },
  { label: 'create 密码不足 8 位 → 400 密码需 8–128 位', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { ...NEW_PLAYER, password: 'short' }, http: 400 },
  { label: 'create 密码超 128 位 → 400 同一句', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { ...NEW_PLAYER, password: 'p'.repeat(129) }, http: 400 },
  { label: 'create body 是坏 JSON → 400 请求不是有效 JSON', url: PL({ action: 'admin-player-create' }), headers: C('super'), rawBody: '{oops', http: 400 },
  { label: 'create body 是 JSON 数组 → 400 请求必须是 JSON 对象', url: PL({ action: 'admin-player-create' }), headers: C('super'), rawBody: '[]', http: 400 },
  // email 撞 fixture 里 c1@example.invalid（players.email 是 UNIQUE）→ 409
  { label: 'create email 重复 → 409 该记录已存在，请勿重复提交', url: PL({ action: 'admin-player-create' }), headers: C('super'), body: { username: 'dupname', email: 'c1@example.invalid', password: 'fixture-pass-123' }, http: 409 },
  { label: 'create 完全没有 body → 400 请求不是有效 JSON（text() 拿到空串 → JSON.parse 失败）', url: PL({ action: 'admin-player-create' }), headers: C('super'), http: 400 },
  { label: 'env 里没有 DB → 503 数据库尚未连接（identity 的第一道）', url: PL({ action: 'admin-player-list' }), noDB: true, http: 503 },
  {
    label: 'players 表整个不存在 → 500 服务处理失败，请稍后重试（endpoint 兜底，且 console.error 一次）',
    url: PL({ action: 'admin-player-list' }), headers: C('super'), http: 500,
    before: async (DB) => { await DB.prepare('DROP TABLE players').run(); },
  },
];

// ---------------------------------------------------------------------------
// §SCENARIOS：announcements.js（孤儿实现）
//
// 分支清单：
//   env.DB 缺失 → 500（这条只在直连 handler 时可达，中间件会先 503）。
//   无 token → 401；有 token 但查不到会话/没 admin_id → 403；
//   过期会话 → getSession 先删后返 null，所以是 403 而不是 401（源码里那句
//   '会话已过期' 因此永远走不到，是死代码 —— 原样保留，重写不许删）。
//   管理员行不在 / role≠super → 403。
//   announcement-delete：parseInt 取 id，falsy → 400；否则 DELETE，成功永远
//   回 deleted:true（哪怕一行都没删）。
//   然后 create / update 共用字段校验：title 2-80、content 2-2000、
//   image_url 要 https:// 或 data:image/ 开头。校验**先于** action 分发，
//   所以未知 action 配非法 title 返的是 400 而不是 404。
//   create / update 各有 try/catch → 500。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 场景执行：把 sc.rawUrl（带原始查询串的场景用）与 after 钩子接上
// ---------------------------------------------------------------------------
const attach = (list) => list.map((sc) => ({ ...sc, url: sc.rawUrl || sc.url }));

async function runList(mod, list) {
  const f = await seeded();
  const results = [];
  try {
    for (const sc of attach(list)) {
      const r = await runOne(mod, f, sc);
      results.push({ label: sc.label, ...r });
      if (sc.after) await sc.after(f.DB);   // 撤销造出来的触发器/表
    }
    return { results, ...(await snapshotAll(f.DB)) };
  } finally {
    f.close();
  }
}
/**
 * 三条差分用例共用的比对：状态码 / 异常 / SQL / 全库快照 + 预期状态码自检
 *
 * `intentional` 是「有意分歧」判定：2026-10-01 起 admin-passkey-debug 不再是
 * 纯等价重写 —— player_id 的校验从 parseInt 换成了 integer()，这是修 bug。
 * 落在名单里的场景允许有差异，但**仍然逐条比对、仍然跑状态码自检**，
 * 只是不把它们算成回归。名单外的任何差异照旧炸。
 */
function compareRuns(a, b, who, intentional = () => false) {
  assert.equal(b.results.length, a.results.length, `${who}: 场景条数不一致`);
  const diffs = [];
  for (let i = 0; i < a.results.length; i++) {
    const ra = a.results[i];
    const rb = b.results[i];
    assert.equal(rb.label, ra.label, `第 ${i} 条场景顺序不一致`);
    for (const field of ['http', 'payload', 'threw', 'errCount', 'sql']) {
      const d = firstDiff(rb[field], ra[field], `${ra.label} · ${field}`);
      if (d && !intentional(ra.label)) diffs.push(d);
    }
  }
  assert.deepEqual(diffs, [], diffs.join('\n'));

  const snapDiff = firstDiff(b.snap, a.snap, `${who} · 全库快照`);
  assert.equal(snapDiff, null, snapDiff || '');

  // 防假绿：每个场景都声明了预期状态码，两版都得对得上。
  // 声明错了这里就炸 —— 那说明读代码读错了，正是要立刻知道的事。
  // http 写 'THROW' 的场景（请求体是 JSON null 之类）比的是 threw 非空。
  for (const [i, sc] of attach(PASSKEY_AND_FRIENDS(who)).entries()) {
    if (sc.http === undefined) continue;
    // 有意修复的场景，声明的是**修复后**的期望，基线版按定义就不符合
    // （它正是被修掉的那个行为），所以只校验现版。
    const sides = intentional(sc.label)
      ? [['现版', b.results[i]]]
      : [['基线版', a.results[i]], ['现版', b.results[i]]];
    for (const [tag, r] of sides) {
      if (sc.http === 'THROW') {
        assert.ok(r.threw !== null, `${who} ${tag}第 ${i} 条「${sc.label}」应当抛异常，实际 ${JSON.stringify({ http: r.http, threw: r.threw })}`);
      } else {
        assert.equal(r.http, sc.http, `${who} ${tag}第 ${i} 条「${sc.label}」状态码与预期不符`);
      }
    }
  }

  // 快照里必须真的有数据，比两个空库等于没比。
  // 只查 admins/sessions 两张：每个 fixture 都建了它们，且没有任何场景动过它们。
  // players/passkeys/announcements 不查 —— 每个分组的**最后一条**场景会故意
  // DROP 掉其中一张表来触发 500 分支（SQLite 没有 BEFORE SELECT 触发器）。
  for (const t of ['admins', 'sessions']) {
    assert.ok(a.snap[t] && a.snap[t].length > 0, `${who}: 快照里 ${t} 是空的，fixture 没建起来`);
  }
  const totalRows = Object.entries(a.snap)
    .filter(([k]) => !k.startsWith('__'))
    .reduce((n, [, v]) => n + v.length, 0);
  assert.ok(totalRows >= 6, `${who}: 全库总共只有 ${totalRows} 行，fixture 没建起来`);
  assert.ok(a.snap.__schema_versions__.length >= 1, `${who}: schema 版本表是空的`);
}

function PASSKEY_AND_FRIENDS(who) {
  return who === 'admin-passkey-debug' ? PK_SCENARIOS : PL_SCENARIOS;
}

// --- 专项：把两个文件的绝对值钉死（证明测试不是假绿）---



// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

// 2026-10-01 起，这个文件不再是「纯等价重写」——player_id 的校验从 parseInt
// 换成了 integer()，这是**有意修的 bug**，差分理应在这些场景上报出差异。
// 所以这里改成：先滤掉「有意分歧」的场景，剩下的必须逐条一致；
// 滤完之后如果一条都不剩，说明清单写得比实际改动还多，那本身也是个问题。
//
// 有意分歧的只有 player_id 相关这几条 —— 它们在场景表里已按修复后的期望
// 标了 '已修' 前缀，这里靠这个前缀识别，新增修复时必须同步登记。
const isIntentional = (label) => label.includes('已修');

test('admin-passkey-debug：' + PK_SCENARIOS.length + ' 个场景在真库上逐场景行为一致（有意修复的除外）', async () => {
  const { oldM, newM, cleanup } = await loadBoth(TARGETS.passkey);
  try {
    const a = await runList(oldM, PK_SCENARIOS);
    const b = await runList(newM, PK_SCENARIOS);
    compareRuns(a, b, 'admin-passkey-debug', isIntentional);
  } finally {
    cleanup();
  }
});

test('admin-player：' + PL_SCENARIOS.length + ' 个场景在真库上逐场景行为一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(TARGETS.player);
  try {
    const a = await runList(oldM, PL_SCENARIOS);
    const b = await runList(newM, PL_SCENARIOS);
    compareRuns(a, b, 'admin-player');
  } finally {
    cleanup();
  }
});

test('admin-passkey-debug：fix-jwks 的 10 条 passkey 真的被一条条数过（valid=3）', async () => {
  const { newM, cleanup } = await loadBoth(TARGETS.passkey);
  const f = await seeded();
  try {
    const r = await runOne(newM, f, { url: PK({ action: 'admin-passkey-fix-jwks' }), headers: C('super') });
    assert.equal(r.http, 200);
    assert.equal(r.payload.total, 10, '应当扫到全部 10 条');
    assert.equal(r.payload.valid, 3, 'crv=P-256 且 x/y 都在的只有 3 条');
    assert.equal(r.payload.message, '已扫描所有 passkey JWK, 报告合法数');

    const list = await runOne(newM, f, { url: PK({ action: 'admin-passkey-debug' }), headers: C('super') });
    assert.equal(list.http, 200);
    assert.equal(list.payload.passkeys.length, 10);
    // ORDER BY id DESC —— 列表第一个必须是 id 最大的 10
    assert.deepEqual(list.payload.passkeys.map((p) => p.id), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    // 字段顺序与取舍也钉住：只有这 8 列，且不返回 counter/transports
    assert.deepEqual(Object.keys(list.payload.passkeys[0]), [
      'id', 'player_id', 'admin_id', 'name', 'credential_id', 'public_key_jwk', 'created_at', 'last_used_at',
    ]);
  } finally {
    f.close();
    cleanup();
  }
});

test('admin-passkey-debug：reregister 的删除范围与计数，且非法 player_id 一条都不删', async () => {
  const { newM, cleanup } = await loadBoth(TARGETS.passkey);
  const f = await seeded();
  try {
    const rereg = async (player_id) => {
      await resetPasskeys(f.DB);
      return runOne(newM, f, { url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id } });
    };
    // fixture：玩家 1 有 4 条(1,2,7,8,10 里的 1,2,7,8,10) → 实际 1,2,7,8,10 共 5 条；
    // 玩家 2 有 3,4,9 共 3 条；玩家 3 有 1 条；管理员 1 有 1 条(player_id 为 NULL)
    const one = await rereg(1);
    assert.equal(one.http, 200);
    assert.equal(one.payload.player_id, 1);
    assert.equal(one.payload.deleted, 5, '玩家 1 应当被删掉 5 条');
    assert.equal(one.payload.message, '已删该玩家全部 passkey, 让用户重新注册');
    const left = (await f.DB.prepare('SELECT player_id, COUNT(*) n FROM passkeys GROUP BY player_id ORDER BY player_id').all()).results;
    // 注意 SQLite 的 ORDER BY 把 NULL 排在最前，管理员自己那条（player_id 为 NULL）在最前面
    assert.deepEqual(left, [{ player_id: null, n: 1 }, { player_id: 2, n: 3 }, { player_id: 3, n: 1 }]);

    const two = await rereg(2);
    assert.equal(two.payload.deleted, 3);
    const three = await rereg(3);
    assert.equal(three.payload.deleted, 1);

    // 2026-10-01 已修的误删面：player_id 走 integer() 严格校验。
    // 原来 parseInt 会把 '1abc'、1.9、' 2 ' 吃成合法整数，然后真的 DELETE。
    // 这四个是真正危险的：Number() 得到 NaN / 小数 / 0 / 负数，
    // 原来 parseInt 会把 '1abc'、1.9 吃成 1 然后真的删掉玩家 1 的全部密钥。
    // 至于 ' 2 ' 与 '0x10'，Number() 分别得到 2 和 16 —— 都是确定存在的 id，
    // 不构成「打错字删错人」，所以不在此列（场景表里已分别钉住）。
    for (const bad of ['1abc', 1.9, -5, 0, null, {}]) {
      const r = await rereg(bad);
      assert.equal(r.http, 400, `${JSON.stringify(bad)} 应当 400，实际 ${r.http}`);
      const n = (await f.DB.prepare('SELECT COUNT(*) n FROM passkeys').first()).n;
      assert.equal(n, 10, `${JSON.stringify(bad)} 之后库里应当还是 10 条 passkey —— 它把玩家 1 的删了`);
    }

    // WHERE 只按 player_id，管理员自己那条（player_id 为 NULL）必须留着
    await resetPasskeys(f.DB);
    const none = await runOne(newM, f, { url: PK({ action: 'admin-passkey-reregister' }), headers: C('super'), body: { player_id: 999 } });
    assert.equal(none.payload.deleted, 0);
    assert.equal((await f.DB.prepare('SELECT COUNT(*) n FROM passkeys').first()).n, 10);
  } finally {
    f.close();
    cleanup();
  }
});

test('admin-player：改写成 GET 这件事是行为，不是实现细节（去掉它状态码就变）', async () => {
  const { newM, cleanup } = await loadBoth(TARGETS.player);
  const f = await seeded();
  try {
    // 改写还在：列表动作落到 players() 的 GET 分支
    const listed = await runOne(newM, f, { url: PL({ action: 'admin-player-list' }), headers: C('admin2') });
    assert.equal(listed.http, 200, '普通管理员读列表应当放行');
    assert.equal(listed.payload.players.length, 4);
    assert.equal(listed.payload.id, undefined, '不能是创建分支的返回形状');

    // 合成探针：把进来的 request 换成 PATCH。改写还在的话，列表动作会被拉回 GET → 200。
    // （真实路由不会拿 PATCH 去调 onRequestPost，这里只为了把「改写」变成可观测的状态码差异。）
    const patched = await runOne(newM, f, { url: PL({ action: 'admin-player-list', id: 1 }), method: 'PATCH', headers: C('super') });
    assert.equal(patched.http, 200, '改写应当把 PATCH 拉回列表分支');
    assert.equal(patched.payload.players.length, 4);
    assert.equal(patched.payload.players[0].id, 4, '列表分支应当按 id DESC 排');

    // 反向证据：**非**列表动作是原样透传，于是 method=PATCH 真的进了 players() 的
    // PATCH 业务分支并改名落库。若改写被误加到所有动作上，这里会变成 200 + 列表。
    const renamed = await runOne(newM, f, {
      url: PL({ action: 'rename', id: 1 }),
      method: 'PATCH',
      headers: C('super'),
      body: { new_username: 'renamed-citizen' },
    });
    assert.equal(renamed.http, 200, '非列表动作应当原样透传进 PATCH 业务分支');
    assert.equal(renamed.payload.id, 1, 'rename 只回 {id}');
    const row = (await f.DB.prepare('SELECT username, game_id FROM players WHERE id = 1').first());
    assert.equal(row.username, 'renamed-citizen', 'rename 应当真的落库（证明透传到了业务分支）');
    // game_id 只在「原本就等于旧用户名」时才跟着改。fixture 里它是 GI1（≠citizen），
    // 所以必须**不**动 —— 这条 CASE 分支靠它才测得到。
    assert.equal(row.game_id, 'GI1', 'game_id 原本不等于旧用户名，不该被改');

    // 同一路径普通管理员 → 403（非列表动作没被改写，super 校验仍在）
    const denied = await runOne(newM, f, {
      url: PL({ action: 'rename', id: 2 }),
      method: 'PATCH',
      headers: C('admin2'),
      body: { new_username: 'hijacked' },
    });
    assert.equal(denied.http, 403, '非列表动作没有改写，super 校验仍在');
    assert.equal(denied.payload.error, '仅 SUPER 可操作');
    assert.equal(
      (await f.DB.prepare('SELECT username FROM players WHERE id = 2').first()).username,
      'builder',
      '403 之后不该有落库',
    );
  } finally {
    f.close();
    cleanup();
  }
});

test('admin-player：ORDER BY id DESC 与 LIMIT 500 仍生效（塞 501 个市民去撞上限）', async () => {
  const { oldM, newM, cleanup } = await loadBoth(TARGETS.player);
  try {
    const outs = [];
    for (const mod of [oldM, newM]) {
      const f = await seeded();
      try {
        // fixture 的 4 个之外再补 497 个 → 共 501
        for (let i = 5; i <= 501; i++) {
          await f.DB.prepare(
            "INSERT INTO players(id,username,email,game_id,password_hash,salt,status,created_at) VALUES(?,?,?,NULL,'x','x','active','2026-01-01 00:00:00')"
          ).bind(i, 'bulk' + i, 'bulk' + i + '@example.invalid').run();
        }
        const r = await runOne(mod, f, { url: PL({ action: 'admin-player-list' }), headers: C('super') });
        outs.push({ http: r.http, ids: r.payload.players.map((p) => p.id), sql: r.sql, n: r.payload.players.length });
      } finally {
        f.close();
      }
    }
    const [a, b] = outs;
    assert.equal(a.n, 500, 'LIMIT 500：501 个市民应当只回 500 个');
    assert.equal(a.ids[0], 501, 'ORDER BY id DESC：第一个是 501');
    assert.equal(a.ids.at(-1), 2, '被切掉的应当是最老的 id=1');
    assert.equal(b.n, a.n, '两版返回条数不一致');
    assert.deepEqual(b.ids, a.ids, '两版返回的 id 序列不一致');
    const listSql = a.sql.filter((s) => /FROM players/.test(s.sql));
    assert.ok(listSql.length === 1, `应当只发出一条 players 列表查询，实际 ${listSql.length} 条`);
    assert.ok(/ORDER BY id DESC LIMIT 500/.test(listSql[0].sql), `SQL 里应当还能看到 ORDER BY id DESC LIMIT 500：${listSql[0].sql}`);
    assert.deepEqual(b.sql.filter((s) => /FROM players/.test(s.sql)), listSql, '两版发的列表 SQL 不一致');
  } finally {
    cleanup();
  }
});

test('admin-player：创建分支真的建出了市民，且密码哈希确实对应提交的明文', async () => {
  const { newM, cleanup } = await loadBoth(TARGETS.player);
  const f = await seeded();
  try {
    const before = (await f.DB.prepare('SELECT COUNT(*) n FROM players').first()).n;
    const r = await runOne(newM, f, { url: PL({ action: 'admin-player-create' }), headers: C('super'), body: NEW_PLAYER });
    assert.equal(r.http, 201, '创建应当是 201 而不是 200');
    const row = (await f.DB.prepare('SELECT * FROM players WHERE id = ?').bind(r.payload.id).first());
    assert.ok(row, '应当真的插进库了');
    assert.equal(row.username, 'newcomer');
    assert.equal(row.game_id, 'newcomer', 'game_id 先跟用户名一致');
    assert.equal(row.status, 'active');
    assert.equal((await f.DB.prepare('SELECT COUNT(*) n FROM players').first()).n, before + 1);
    // 随机盐没法逐字比，但「哈希对应明文」是可以验的 —— 比比对随机字节强得多
    assert.equal(await verifyPassword(NEW_PLAYER.password, row.password_hash, row.salt), true, '哈希对不上提交的密码');
    assert.equal(await verifyPassword('别的密码', row.password_hash, row.salt), false);
    assert.equal(row.salt.length, 32, 'salt 应是 16 字节 hex');
    assert.equal(row.password_hash.length, 64, 'hash 应是 32 字节 hex');
  } finally {
    f.close();
    cleanup();
  }
});

test('两个文件的 export 名单与基线逐字一致（别的文件在 import，改了就断链）', async () => {
  const names = (src) =>
    [...src.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)]
      .map((m) => m[1])
      .concat(
        [...src.matchAll(/export\s*\{([^}]*)\}/g)]
          .flatMap((m) => m[1].split(',').map((p) => p.trim().split(/\s+as\s+/).pop().trim()))
          .filter(Boolean),
      )
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
  const read = (p) => execSync(`cat "${p}"`, { encoding: 'utf8', maxBuffer: 1 << 28 });
  for (const path of Object.values(TARGETS)) {
    assert.deepEqual(names(read(path)), names(show(path)), `${path} 的 export 名单变了`);
  }
});

/**
 * 孤儿端点已删除，这里钉住「别把它塞回来」。
 *
 * functions/api/actions/announcements.js 曾是第二套公告写入实现：全仓库无人
 * import，正规路由走 init.js:99-107 → _core/resources.js。它只能靠直接 POST
 * 非文档 URL 命中，且校验比正规实现松（parseInt 太宽松、放行
 * data:image/svg+xml、原始 SQL 错误外泄）。留着等于让一套更弱的校验继续
 * 在生产可路由。
 *
 * 顺带守住「这个目录不该有第三个文件」——再加任何新路由都必须先说明它和
 * init.js 里正规路径的关系，否则大概率又是一个没人 import 的孤儿。
 */
test('announcements 孤儿端点已删除；actions/ 目录的接线情况与孤儿清单保持明确', () => {
  assert.equal(
    existsSync('functions/api/actions/announcements.js'),
    false,
    'actions/announcements.js 已被判定为无人 import 的孤儿端点并删除，别再加回来'
  );
  // init.js 真正 import 的是这五个；admin-passkey-debug.js 不在其中（见文件头注释：
  // 它是从 init.js LEGACY 段拆出来但**忘了接回新分发表**的漏项，不是设计上的死代码，
  // 所以这次留着、单独决策）。
  const wired = ['signin.js', 'account.js', 'passkey.js', 'admin-player.js', 'admin-dm.js']
    .map((f) => `functions/api/actions/${f}`);
  const initSrc = execSync(`cat "functions/api/init.js"`, { encoding: 'utf8', maxBuffer: 1 << 28 });
  for (const p of wired) {
    assert.ok(initSrc.includes(p.slice(p.lastIndexOf('actions/') + 8)), `init.js 应当 import ${p}`);
  }
  // 目录里除了这五个 + 待决策的 admin-passkey-debug，不该再多出无人 import 的文件
  const actions = readdirSync('functions/api/actions').filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(actions, [
    'account.js', 'admin-dm.js', 'admin-passkey-debug.js', 'admin-player.js', 'passkey.js', 'signin.js',
  ]);
});
