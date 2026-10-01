// login.js 与 _helpers.js 重写的行为差分守门。
//
// ⚠️ 路径说明：本文件原定名 tests/login-equiv.test.js，但那个路径在本次编写期间
// 被另一个并发进程占用（同名、内容不同的另一份 login 差分）。按「不破坏他人产物」
// 的约束，本文件改用 tests/login-auth-equiv.test.js。两份都保留，父进程决定取舍。
//
// 为什么必须补这层验证：这两个文件是认证入口与公共 helper，压缩写法最狠
// （login.js 29 行里塞了 227 字符的单行，一行同时管着限流指纹、账号定位、
// 状态判定和会话签发）。上一轮重写只验了 export 名单没变、268 个测试全绿，
// 却漏掉了 exam-sessions.js 的 action 白名单被兜底 return 吃掉 ——
// **只比 export 名单是抓不到行为回归的**。
// 所以这里用真 SQLite 把基线版和现版各跑一遍，逐场景比对返回值 + 全库快照。
//
// 为什么逐分支覆盖：
//   - 限流指纹是 SHA-256(ip|username)，改一个字符就等于关掉限流；
//   - 401 会写 auth_attempts，400 不会，403 会写但发生在清空计数之前；
//   - GET 里 player / owner 各带 status='active' 过滤，admin 不带；
//   - _helpers 的 parseSession 用的是**未加锚点**的 /lc_session=([^;]+)/，
//     所以 `xlc_session=t` 也会匹配上 —— 这是真实行为，重写时不能「顺手修正」；
//   - resolveSubjectFromSession 里 player_id 优先于 admin_id，且 admin 已绑
//     active 玩家时会「合并」成 player（带 _via_admin / _admin_username）。
//
// 基线从 git 动态提取（BASELINE），不留副本目录；副本落回原目录并改名为
// .equiv-<pid>-<n>-<name>.mjs —— 文件名必须与原模块不同，否则 ESM 按绝对路径
// 缓存会让基线版和现版拿到同一个模块对象，差分直接白做。
//
// 坑（沿用 shared-equiv.test.js 的结论）：database() 会 fork 一个 python3 SQLite
// 子进程，不退就挂住 runner。所以**每条用例都在 finally 里显式 close()**（幂等），
// 不用 process.exit（会吞掉 TAP 输出），也不靠 process.on('exit') 兜底
// （那钩子要等进程即将退出才跑，而正是活着的子进程阻止退出 —— 死锁）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { database, dispatch } from './local-d1.mjs';
import { hashPassword } from '../functions/_shared/auth.js';
import { ensureDatabase } from '../functions/_core/database.js';

const BASELINE = '06e9595';
const LOGIN = 'functions/api/login.js';
const HELPERS = 'functions/api/_helpers.js';

const show = (path) =>
  execSync(`git show ${BASELINE}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 28 });
const read = (p) => readFileSync(p, 'utf8');

// ---------------------------------------------------------------------------
// 基线 / 现版双份装载
// ---------------------------------------------------------------------------

const ownedTmpFiles = new Set();
let tmpSeq = 0;

/**
 * 把基线版落回**原目录**再 import。
 *
 * 坑：挪到 tests/ 下路径就断了 —— 副本里的 `import ... from '../_core/request.js'`
 * 是相对路径，挪走后直接 Cannot find module。必须待在 functions/api/ 里。
 * 避开前端链接检查的办法是后缀用 .mjs（扫的是 .js）+ 文件名带进程号（并发互不覆盖）。
 */
async function loadBoth(path) {
  const name = `.equiv-${process.pid}-${++tmpSeq}-${path.replace(/[/\\]/g, '_').replace(/\.js$/, '')}.mjs`;
  const rel = path.replace(/\/[^/]+$/, '/') + name;
  // writeFileSync/unlinkSync 相对 cwd（仓库根），import() 相对本文件（tests/），别混。
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

/** 只清本进程登记过的副本；绝不扫全仓库（有并发进程在用） */
function cleanupTmpFiles() {
  for (const f of ownedTmpFiles) {
    try { unlinkSync(f); } catch {}
  }
  ownedTmpFiles.clear();
}
process.on('exit', cleanupTmpFiles);
process.on('uncaughtException', (e) => {
  cleanupTmpFiles();
  throw e;
});

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

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const PASSWORD = 'Equiv-Pass-42!';
// 固定盐：hashPassword(salt) 确定性，算一次即可（~18ms）
const SALT = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const HASH = (await hashPassword(PASSWORD, SALT)).hash;

/** 独立算一遍限流指纹，锁住「改一个字符就等于关掉限流」这个算法 */
const fingerprintOf = async (ip, username) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + username));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
};
// 独立算出的参考值（写死，防止两边一起错）
const RATE_LIMIT_FINGERPRINT =
  '740e515fd67af9bb7c83bd23f3f8953b141df11991a66d9a484d3bc249864b0d';
assert.equal(
  await fingerprintOf('203.0.113.5', 'ratelimited'),
  RATE_LIMIT_FINGERPRINT,
  '测试自己的指纹算法对不上写死的参考值'
);

const FUTURE = '2099-01-01 00:00:00';
const PAST = '2000-01-01 00:00:00';

/**
 * 新库 + 覆盖 login.js 每一条分支的账号/会话。
 *
 * 账号布局（挑的是能让每条分支各自独立触发，不互相串味）：
 *   players        1 citizen  active              正常玩家
 *                  2 banned   banned              POST 的 403
 *                  3 merger   active  ←→ admin 1  GET 的合并账号 / combined
 *                  4 dangling active  悬空 linked_admin_id=999
 *   admins         1 super    super   linked_player_id=3
 *                  2 wzc      admin                纯 admin 登录
 *   hotel_owners   1 boss     active  linked_player_id=1  GET 的反查来源
 *                  2 retired  closed                POST 的 403
 */
async function seeded() {
  const DB = database();
  await ensureDatabase(DB);

  // created_at 显式给死值：GET 的返回体会把 players.created_at 原样带出去，
  // 靠 datetime('now') 的话两版各跑各的库，跨一秒边界就会假报差异。
  const P = "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds,created_at) VALUES(?,?,?,?,?,?,?,'2026-01-01 00:00:00')";
  await DB.prepare(P).bind(1, 'citizen', 'c1@example.invalid', HASH, SALT, 'active', 1000).run();
  await DB.prepare(P).bind(2, 'banned', 'c2@example.invalid', HASH, SALT, 'banned', 0).run();
  await DB.prepare(P).bind(3, 'merger', 'c3@example.invalid', HASH, SALT, 'active', 5).run();
  await DB.prepare(P).bind(4, 'dangling', 'c4@example.invalid', HASH, SALT, 'active', 7).run();
  await DB.prepare('UPDATE players SET linked_admin_id=1 WHERE id=3').run();
  await DB.prepare('UPDATE players SET linked_admin_id=999 WHERE id=4').run();

  const A = 'INSERT INTO admins(id,username,role,password_hash,salt) VALUES(?,?,?,?,?)';
  await DB.prepare(A).bind(1, 'super', 'super', HASH, SALT).run();
  await DB.prepare(A).bind(2, 'wzc', 'admin', HASH, SALT).run();
  await DB.prepare('UPDATE admins SET linked_player_id=3 WHERE id=1').run();

  const O = "INSERT INTO hotel_owners(id,username,password_hash,salt,linked_player_id,status) VALUES(?,?,?,?,?,?)";
  await DB.prepare(O).bind(1, 'boss', HASH, SALT, 1, 'active').run();
  await DB.prepare(O).bind(2, 'retired', HASH, SALT, null, 'closed').run();

  const S = 'INSERT INTO sessions(token,player_id,admin_id,hotel_owner_id,expires_at) VALUES(?,?,?,?,?)';
  const sessions = [
    ['tok-player', 1, null, null, FUTURE],
    ['tok-admin', null, 1, null, FUTURE],
    ['tok-owner', null, null, 1, FUTURE],
    ['tok-both', 3, 1, null, FUTURE],
    ['tok-dangling', 4, null, null, FUTURE],
    ['tok-banned', 2, null, null, FUTURE],
    ['tok-ownerclosed', null, null, 2, FUTURE],
    ['tok-expired', 1, null, null, PAST],
    ['tok-empty', null, null, null, FUTURE],
  ];
  for (const row of sessions) await DB.prepare(S).bind(...row).run();

  let closed = false;
  return {
    DB,
    env: { DB },
    // 幂等：允许调用方在 finally 里无条件调
    close: () => {
      if (closed) return;
      closed = true;
      try { DB.close(); } catch {}
    },
  };
}

// ---------------------------------------------------------------------------
// 全库快照
// ---------------------------------------------------------------------------

let tableNames = null;
async function tables(DB) {
  if (!tableNames) {
    const r = await DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();
    tableNames = r.results.map((x) => x.name);
  }
  return tableNames;
}

/**
 * 抹掉**只有这两处**会变的值：随机 session token 与时间戳。
 *
 * 其余一律逐字比对 —— 落了几行、身份三列指向谁、auth_attempts 写了什么，
 * 变了就必须是差异。限流指纹是 64 位 hex，与 token 的 48 位长度不同，不会被误抹。
 */
const scrub = (s) =>
  String(s)
    .replace(/\b[0-9a-f]{48}\b/g, '<TOKEN>')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<TS>');

/** 全库每张表的完整快照（49 张表，整库逐字） */
async function snapshotAll(DB) {
  const out = {};
  for (const name of await tables(DB)) {
    out[name] = scrub(JSON.stringify((await DB.prepare(`SELECT * FROM "${name}"`).all()).results));
  }
  return out;
}

/** 某个限流指纹下留了几条失败计数 */
const attemptCount = (DB, fp) =>
  DB.prepare('SELECT COUNT(*) AS n FROM auth_attempts WHERE fingerprint=?').bind(fp).first().then((r) => r.n);

/** 直接调用路由导出，绕开 _middleware（对称地调用两版，差分才公平） */
async function call(mod, env, method, { body, cookie, ip, url = 'https://local.test/api/login' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie !== undefined) headers.Cookie = cookie;
  if (ip !== undefined) headers['CF-Connecting-IP'] = ip;
  const request = new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const key = 'onRequest' + method[0] + method.slice(1).toLowerCase();
  const r = await mod[key]({ request, env, waitUntil() {} });
  return {
    http: r.status,
    body: await r.json(),
    cookie: scrub(r.headers.get('Set-Cookie') || ''),
  };
}

/** 直接跑一个自定义 Request 场景（用于 X-Session-Token / Authorization 头） */
async function callRaw(mod, env, request) {
  const r = await mod.onRequestGet({ request, env, waitUntil() {} });
  return { http: r.status, body: await r.json(), cookie: scrub(r.headers.get('Set-Cookie') || '') };
}

/**
 * 逐个版本跑**完全相同的有序序列**，每步都记下返回值 + 全库快照。
 *
 * probe(DB) 在 close() **之前**执行：runSequence 的 finally 会关掉这个库，
 * 而 local-d1 的 close() 只是 child.stdin.end() —— 之后再拿这个 DB 发查询，
 * 写进去的东西没人回，整条测试的 Promise 永远不 settle，
 * 表现为 "Promise resolution is still pending but the event loop has already resolved"。
 * 需要收尾时的库内事实，就通过 probe 一起带出来。
 */
async function runSequence(mod, steps, probe) {
  const f = await seeded();
  try {
    const log = [];
    for (const step of steps) {
      let out;
      try {
        out = await step.run(mod, f);
      } catch (e) {
        out = { http: 'THROW', body: { error: e.message } };
      }
      log.push({ name: step.name, out, snap: await snapshotAll(f.DB) });
    }
    return { log, fact: probe ? await probe(f.DB) : null };
  } finally {
    f.close();
  }
}

function compare(name, a, b) {
  // 全部用 deepEqual：并发那一步的 http / cookie 是数组，equal 会报「结构相同但非同一引用」
  assert.deepEqual(b.out.http, a.out.http, `${name}：HTTP 不一致`);
  assert.deepEqual(b.out.body, a.out.body, `${name}：返回体不一致`);
  assert.deepEqual(b.out.cookie, a.out.cookie, `${name}：Set-Cookie 不一致`);
  assert.deepEqual(b.snap, a.snap, `${name}：落库快照不一致（整库逐表比对）`);
}

// ===========================================================================
// 1. export 名单
// ===========================================================================

test('login/_helpers 重写没改 export 名单（对照 ' + BASELINE + '）', () => {
  const problems = [];
  for (const path of [LOGIN, HELPERS]) {
    const before = exportNames(show(path));
    const after = exportNames(read(path));
    const lost = before.filter((n) => !after.includes(n));
    const added = after.filter((n) => !before.includes(n));
    if (lost.length || added.length) problems.push(`${path}: 少了 [${lost}]，多了 [${added}]`);
    // 防假绿：名单解析器本身失效（全空也算「一致」）
    assert.ok(before.length >= 3, `${path} 的 export 名单只认出 ${before.length} 个，解析器可能失效`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

// ===========================================================================
// 2. POST —— 认证入口，按分支排
// ===========================================================================

const RATE_IP = '203.0.113.5';
const RATE_USER = 'ratelimited';

const POST_STEPS = [
  { name: '玩家登录成功（发 cookie + 建会话）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen', password: PASSWORD } }) },
  { name: '用户名带首尾空格（string() 会 trim）', run: (m, f) => call(m, f.env, 'POST', { body: { username: '  citizen  ', password: PASSWORD } }) },
  { name: '管理员登录（target=admin）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'super', password: PASSWORD, target: 'admin' } }) },
  { name: '酒店老板登录（target=hotel_owner）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'boss', password: PASSWORD, target: 'hotel_owner' } }) },
  { name: 'target 非法值（回落 player）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen', password: PASSWORD, target: 'root' } }) },
  { name: 'target 为 null（仍走 player）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen', password: PASSWORD, target: null } }) },
  { name: '密码错误（写 auth_attempts）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen', password: 'wrong' }, ip: '198.51.100.1' }) },
  { name: '账号不存在（同样写 auth_attempts）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'nobody', password: PASSWORD }, ip: '198.51.100.1' }) },
  { name: '玩家已停用（403，不写 auth_attempts）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'banned', password: PASSWORD }, ip: '198.51.100.2' }) },
  { name: '酒店老板已停用（403）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'retired', password: PASSWORD, target: 'hotel_owner' }, ip: '198.51.100.2' }) },
  { name: 'admin 账号没有 status 检查（应放行）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'wzc', password: PASSWORD, target: 'admin' } }) },
  { name: 'target 与账号类型不符（玩家名走 admin 通道 → 401）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen', password: PASSWORD, target: 'admin' }, ip: '198.51.100.3' }) },
  { name: '管理员名走默认 player 通道 → 401', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'super', password: PASSWORD }, ip: '198.51.100.3' }) },
  { name: 'username 缺失（string 报「必须是文字」）', run: (m, f) => call(m, f.env, 'POST', { body: { password: PASSWORD } }) },
  { name: 'username 非字符串', run: (m, f) => call(m, f.env, 'POST', { body: { username: 123, password: PASSWORD } }) },
  { name: 'username 为空串', run: (m, f) => call(m, f.env, 'POST', { body: { username: '', password: PASSWORD } }) },
  { name: 'username 超 64 字符', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'u'.repeat(65), password: PASSWORD } }) },
  { name: 'username 恰好 64 字符（边界内 → 继续查库 → 401）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'u'.repeat(64), password: PASSWORD }, ip: '198.51.100.4' }) },
  { name: 'password 缺失', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen' } }) },
  { name: 'password 非字符串', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen', password: 42 } }) },
  { name: 'password 空串', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen', password: '' } }) },
  { name: 'password 超 128 字符', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen', password: 'p'.repeat(129) } }) },
  { name: 'password 恰好 128 字符（边界内 → 落到密码比对 → 401）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen', password: 'p'.repeat(128) }, ip: '198.51.100.5' }) },
  { name: 'body 是数组（不是对象）', run: (m, f) => call(m, f.env, 'POST', { body: [1, 2] }) },
  { name: 'body 是 null', run: (m, f) => call(m, f.env, 'POST', { body: null }) },
  { name: '无 IP 头（走 local 指纹）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'merger', password: PASSWORD } }) },
  ...Array.from({ length: 10 }, (_, i) => ({
    name: `限流累积第 ${i + 1}/10 次错密码`,
    run: (m, f) => call(m, f.env, 'POST', { body: { username: RATE_USER, password: 'wrong' }, ip: RATE_IP }),
  })),
  { name: '限流触发（429，不再写 auth_attempts）', run: (m, f) => call(m, f.env, 'POST', { body: { username: RATE_USER, password: PASSWORD }, ip: RATE_IP }) },
  // 下面两条用**真实账号**（否则账号不存在会先 401，看不出限流有没有解除）
  { name: '换 IP 后不再受限（指纹含 IP）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'citizen', password: PASSWORD }, ip: RATE_IP }) },
  { name: '同一 IP 换用户名不再受限（指纹含用户名）', run: (m, f) => call(m, f.env, 'POST', { body: { username: 'wzc', password: PASSWORD, target: 'admin' }, ip: RATE_IP }) },
  { name: '成功后清空该指纹的失败计数', run: async (m, f) => {
      const fp = await fingerprintOf('198.51.100.6', 'citizen');
      const bad = await call(m, f.env, 'POST', { body: { username: 'citizen', password: 'wrong' }, ip: '198.51.100.6' });
      const afterBad = await attemptCount(f.DB, fp);
      const ok = await call(m, f.env, 'POST', { body: { username: 'citizen', password: PASSWORD }, ip: '198.51.100.6' });
      const afterOk = await attemptCount(f.DB, fp);
      return { http: ok.http, body: ok.body, cookie: ok.cookie, bad: bad.http, afterBad, afterOk };
    } },
  { name: '并发重复登录（同账号两次并行，各自建会话）', run: async (m, f) => {
      const before = (await f.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n;
      const raw = async (opts) => {
        const request = new Request('https://local.test/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': opts.ip },
          body: JSON.stringify(opts.body),
        });
        const r = await m.onRequestPost({ request, env: f.env, waitUntil() {} });
        return { http: r.status, body: await r.json(), cookie: r.headers.get('Set-Cookie') || '' };
      };
      const opts = { body: { username: 'dangling', password: PASSWORD }, ip: '198.51.100.7' };
      const [x, y] = await Promise.all([raw(opts), raw(opts)]);
      const after = (await f.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n;
      // 抹掉 token 会让「两次是否发了同一个 token」看不出来，
      // 所以额外记一个**未抹除**的比对结果：两版各自跑，值必须相同且为 false
      const sameRawToken = x.cookie === y.cookie;
      return {
        http: [x.http, y.http],
        body: [x.body, y.body],
        cookie: [scrub(x.cookie), scrub(y.cookie)],
        before,
        after,
        tokenShape: [x.cookie, y.cookie].map((c) => /^lc_session=[0-9a-f]{48};/.test(c)),
        sameRawToken,
      };
    } },
];

const RATE_FP = await fingerprintOf(RATE_IP, RATE_USER);
const CITIZEN_BAD_FP = await fingerprintOf('198.51.100.1', 'citizen');
const BANNED_FP = await fingerprintOf('198.51.100.2', 'banned');

test('login POST：全部分支两版返回值 + 全库快照一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(LOGIN);
  try {
    const probe = async (DB) => ({
      rateAttempts: await attemptCount(DB, RATE_FP),
      bannedAttempts: await attemptCount(DB, BANNED_FP),
      firstAttemptFp: (await DB.prepare('SELECT fingerprint FROM auth_attempts WHERE id=1').first())?.fingerprint ?? null,
      ownerSessions: (await DB.prepare('SELECT player_id,admin_id,hotel_owner_id FROM sessions WHERE hotel_owner_id=1').all()).results,
    });
    const a = await runSequence(oldM, POST_STEPS, probe);
    const b = await runSequence(newM, POST_STEPS, probe);
    assert.equal(a.log.length, POST_STEPS.length);
    for (let i = 0; i < a.log.length; i++) compare(POST_STEPS[i].name, a.log[i], b.log[i]);

    // ---- 防假绿：锁住已知答案 ----
    const at = (i) => a.log[i].out;
    const FIRST_RATELIMIT = 26; // '无 IP 头' 之后
    const TRIPPED = FIRST_RATELIMIT + 10;

    assert.equal(at(0).http, 200, '玩家登录应成功');
    assert.deepEqual(at(0).body, { ok: true, user_id: 1, role: 'player' });
    assert.match(at(0).cookie, /^lc_session=<TOKEN>; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800$/,
      'Set-Cookie 的属性与 8 小时 Max-Age 不能变');

    assert.equal(at(1).http, 200, '用户名首尾空格应被 trim 后仍能登录');
    assert.equal(at(2).body.role, 'super', '管理员登录的 role 取 admins.role');
    assert.equal(at(2).body.user_id, 1);
    assert.equal(at(3).body.role, 'hotel_owner');
    assert.equal(at(4).http, 200, 'target 非法值应回落 player');
    assert.equal(at(5).http, 200, 'target=null 应回落 player');

    assert.equal(at(6).http, 401);
    assert.equal(at(6).body.error, '账号或密码错误');
    assert.equal(at(6).cookie, '', '失败不得下发 cookie');
    assert.equal(at(7).http, 401, '账号不存在同样 401');
    assert.equal(at(8).http, 403, '已停用玩家必须 403');
    assert.equal(at(8).body.error, '账号尚未激活或已停用');
    assert.equal(at(8).cookie, '', '403 也不得下发 cookie');
    assert.equal(at(9).http, 403, '已停用酒店老板必须 403');
    assert.equal(at(10).http, 200, 'admins 表没有 status，不该拦');
    assert.equal(at(11).http, 401, 'target=admin 查不到玩家名');
    assert.equal(at(12).http, 401, '默认通道查不到管理员名');

    assert.equal(at(13).body.error, '账号 必须是文字', '缺失 username 走 string() 的类型分支');
    assert.equal(at(14).body.error, '账号 必须是文字', '非字符串 username 同样');
    assert.equal(at(15).body.error, '账号 需填写且不超过 64 字符');
    assert.equal(at(16).body.error, '账号 需填写且不超过 64 字符', '65 字符必须被拒');
    assert.equal(at(17).http, 401, '64 字符是边界内，应继续到查库并 401');

    for (const [i, why] of [[18, '缺失'], [19, '非字符串'], [20, '空串'], [21, '129 字符']]) {
      assert.equal(at(i).body.error, '密码无效', 'password ' + why);
    }
    assert.equal(at(22).http, 401, '128 字符是边界内，落到密码比对');

    assert.equal(at(23).body.error, '请求必须是 JSON 对象', '数组 body 被挡');
    assert.equal(at(24).body.error, '请求必须是 JSON 对象', 'null body 被挡');
    assert.equal(at(25).http, 200, '无 IP 头也能正常登录');

    // 限流：10 次失败后第 11 次 429
    for (let i = 0; i < 10; i++) {
      assert.equal(at(FIRST_RATELIMIT + i).http, 401, `限流累积第 ${i + 1} 次应是 401`);
    }
    assert.equal(at(TRIPPED).http, 429, '第 11 次必须 429');
    assert.equal(at(TRIPPED).body.error, '尝试次数过多，请稍后重试');
    assert.equal(at(TRIPPED).cookie, '', '429 不得下发 cookie');
    assert.equal(at(TRIPPED + 1).http, 200, '被限流的 IP 上换个真实账号应能登录（指纹含用户名）');
    assert.equal(at(TRIPPED + 2).http, 200, '被限流的用户名换个 IP 应能登录（指纹含 IP）');

    assert.equal(at(TRIPPED + 3).http, 200, '错一次再成功');
    assert.equal(at(TRIPPED + 3).bad, 401);
    assert.equal(at(TRIPPED + 3).afterBad, 1, '错密码那次应写下 1 条计数');
    assert.equal(at(TRIPPED + 3).afterOk, 0, '成功后该指纹的计数必须被清空');

    const conc = at(TRIPPED + 4);
    assert.deepEqual(conc.http, [200, 200], '并发两次都应成功');
    assert.equal(conc.after - conc.before, 2, '并发两次应各自落一行会话');
    assert.deepEqual(conc.tokenShape, [true, true], '并发两次的 token 都应是 24 字节 = 48 hex');
    assert.equal(conc.sameRawToken, false, '并发两次必须发不同 token（未被抹除的原始 cookie 比对）');

    // ---- 落库事实：必须真干了活（每条都按指纹独立断言，不靠总数） ----
    // 走 probe 拿：runSequence 已经把库关了，不能再事后查
    assert.equal(a.fact.rateAttempts, 10,
      '限流窗口内该指纹应恰好留 10 条 auth_attempts（第 11 次 429 不再写）');
    assert.equal(a.fact.firstAttemptFp, CITIZEN_BAD_FP,
      '限流指纹必须是 SHA-256(ip|username) 的小写 hex');
    assert.equal(a.fact.bannedAttempts, 0,
      '403 那一步发生在清空计数之前，且不写 auth_attempts');
    // 老板登录在序列里出现两次（正常那次 + 限流解除后用真实账号那次），
    // 所以是 2 行而不是 1 行；关键断言是「每行都只带 hotel_owner_id」
    assert.ok(a.fact.ownerSessions.length >= 1, '酒店老板登录应落带 hotel_owner_id 的会话');
    assert.deepEqual(
      a.fact.ownerSessions,
      a.fact.ownerSessions.map(() => ({ player_id: null, admin_id: null, hotel_owner_id: 1 })),
      '老板会话不应凭空带 player_id / admin_id'
    );
    assert.deepEqual(b.fact, a.fact, '落库事实两版不一致');
  } finally {
    cleanup();
  }
});

test('login POST：body 不是合法 JSON / 超大体积两版一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(LOGIN);
  const run = async (m) => {
    const f = await seeded();
    try {
      const out = [];
      for (const raw of ['{', 'not json', '', JSON.stringify({ username: 'a'.repeat(3 * 1024 * 1024), password: 'x' })]) {
        const request = new Request('https://local.test/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: raw,
        });
        const r = await m.onRequestPost({ request, env: f.env, waitUntil() {} });
        out.push({ http: r.status, body: await r.json() });
      }
      return { out, attempts: (await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_attempts').first()).n };
    } finally {
      f.close();
    }
  };
  try {
    const a = await run(oldM);
    const b = await run(newM);
    assert.deepEqual(b.out, a.out, '非法 JSON / 超大 body 的响应不一致');
    assert.equal(a.out[0].http, 400);
    assert.equal(a.out[0].body.error, '请求不是有效 JSON');
    assert.equal(a.out[1].http, 400);
    assert.equal(a.out[2].http, 400, '空 body 当 {} 处理，应落到 username 校验');
    assert.equal(a.out[3].http, 413, '超过 2MB 应 413');
    assert.equal(a.out[3].body.error, '请求内容过大');
    assert.equal(b.attempts, a.attempts, '这四条都不该碰 auth_attempts');
    assert.equal(a.attempts, 0);
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 3. GET —— 会话解析
// ===========================================================================

const GET_STEPS = [
  { name: '玩家会话（并反查到绑定的酒店老板）', run: (m, f) => call(m, f.env, 'GET', { cookie: 'lc_session=tok-player' }) },
  { name: '酒店老板会话', run: (m, f) => call(m, f.env, 'GET', { cookie: 'lc_session=tok-owner' }) },
  { name: 'admin+player 双身份（combined=true）', run: (m, f) => call(m, f.env, 'GET', { cookie: 'lc_session=tok-both' }) },
  { name: 'linked_admin_id 悬空 → 被置空', run: (m, f) => call(m, f.env, 'GET', { cookie: 'lc_session=tok-dangling' }) },
  { name: '会话有效但玩家已停用（player 查不到）', run: (m, f) => call(m, f.env, 'GET', { cookie: 'lc_session=tok-banned' }) },
  { name: '酒店老板已停用（owner 查不到，且无其他身份）', run: (m, f) => call(m, f.env, 'GET', { cookie: 'lc_session=tok-ownerclosed' }) },
  { name: '会话三种身份全空 → 会话已失效', run: (m, f) => call(m, f.env, 'GET', { cookie: 'lc_session=tok-empty' }) },
  { name: '过期会话（并被 getSession 顺手删掉）', run: (m, f) => call(m, f.env, 'GET', { cookie: 'lc_session=tok-expired' }) },
  { name: 'token 不存在', run: (m, f) => call(m, f.env, 'GET', { cookie: 'lc_session=never-existed' }) },
  { name: '无 cookie', run: (m, f) => call(m, f.env, 'GET') },
  { name: 'Cookie 里有多个会话 cookie', run: (m, f) => call(m, f.env, 'GET', { cookie: 'a=1; lc_session=tok-player; b=2' }) },
  { name: 'X-Session-Token 头优先于 cookie', run: (m, f) => callRaw(m, f.env, new Request('https://local.test/api/login', { headers: { 'X-Session-Token': 'tok-admin', Cookie: 'lc_session=tok-player' } })) },
  { name: 'Authorization: Bearer 也能取到会话', run: (m, f) => callRaw(m, f.env, new Request('https://local.test/api/login', { headers: { Authorization: 'Bearer tok-admin' } })) },
];

test('login GET：会话解析全部分支两版返回值 + 全库快照一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(LOGIN);
  try {
    const a = await runSequence(oldM, GET_STEPS);
    const b = await runSequence(newM, GET_STEPS);
    for (let i = 0; i < a.log.length; i++) compare(GET_STEPS[i].name, a.log[i], b.log[i]);

    const at = (i) => a.log[i].out;
    assert.equal(at(0).http, 200);
    assert.equal(at(0).body.player.username, 'citizen');
    assert.equal(at(0).body.role, 'player');
    assert.equal(at(0).body.combined, false);
    assert.equal(at(0).body.hotel_owner.username, 'boss', '会话里没带 hotel_owner_id 时要从 player 反查');
    assert.equal(at(0).body.admin, null);
    assert.equal(at(0).body.user.id, 1);
    assert.equal(at(0).body.player.emeralds, 1000, '玩家字段要透传');

    assert.equal(at(1).body.role, 'hotel_owner', 'owner 的 role 优先于默认 player');
    assert.equal(at(1).body.hotel_owner.username, 'boss');
    assert.equal(at(1).body.user.id, 1);

    assert.equal(at(2).body.combined, true, '双身份会话 combined 必须为 true');
    assert.equal(at(2).body.admin.username, 'super');
    assert.equal(at(2).body.player.username, 'merger');
    assert.equal(at(2).body.player.linked_admin_id, 1, '有效绑定要原样返回');
    assert.equal(at(2).body.role, 'super', '双身份时 role 取 admin.role');

    assert.equal(at(3).body.player.username, 'dangling');
    assert.equal(at(3).body.player.linked_admin_id, null, '悬空的 linked_admin_id 必须被置空');

    assert.equal(at(4).http, 401);
    assert.equal(at(4).body.error, '会话已失效', '玩家被停用时走「会话已失效」而非「请先登录」');
    assert.equal(at(5).http, 401);
    assert.equal(at(5).body.error, '会话已失效', '老板停用且无其他身份');
    assert.equal(at(6).http, 401);
    assert.equal(at(6).body.error, '会话已失效');
    assert.equal(at(7).http, 401);
    assert.equal(at(7).body.error, '请先登录', '过期 token 先被 getSession 判死，走 401 请先登录');
    assert.equal(at(8).http, 401);
    assert.equal(at(9).http, 401);
    assert.equal(at(9).body.error, '请先登录', '完全没有 cookie');
    assert.equal(at(10).http, 200, '多 cookie 时仍取到会话');
    assert.equal(at(11).http, 200);
    assert.equal(at(11).body.role, 'super', 'X-Session-Token 头优先于 cookie');
    assert.equal(at(12).http, 200);
    assert.equal(at(12).body.role, 'super', 'Authorization: Bearer 也能取到');

    // 过期会话必须真的被 getSession 从库里删掉（整库快照里已比对过，这里再锁一次）
    const sessTable = JSON.parse(a.log[a.log.length - 1].snap.sessions);
    const tokens = sessTable.map((r) => r.token);
    assert.ok(!tokens.includes('tok-expired'), '过期会话应被顺手删除');
    assert.ok(tokens.includes('tok-player'), '未过期会话必须留着');
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 4. DELETE —— 登出
// ===========================================================================

const DELETE_STEPS = [
  { name: '正常登出', run: (m, f) => call(m, f.env, 'DELETE', { cookie: 'lc_session=tok-player' }) },
  { name: '重复登出同一 token（幂等）', run: (m, f) => call(m, f.env, 'DELETE', { cookie: 'lc_session=tok-player' }) },
  { name: '无 cookie（幂等）', run: (m, f) => call(m, f.env, 'DELETE') },
  { name: 'token 不存在（幂等）', run: (m, f) => call(m, f.env, 'DELETE', { cookie: 'lc_session=never-existed' }) },
  { name: '登出已过期的会话', run: (m, f) => call(m, f.env, 'DELETE', { cookie: 'lc_session=tok-expired' }) },
  { name: '登出管理员会话', run: (m, f) => call(m, f.env, 'DELETE', { cookie: 'lc_session=tok-admin' }) },
];

test('login DELETE：销毁会话 + 下发过期 cookie，两版一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(LOGIN);
  try {
    const a = await runSequence(oldM, DELETE_STEPS);
    const b = await runSequence(newM, DELETE_STEPS);
    for (let i = 0; i < a.log.length; i++) compare(a.log[i].name, a.log[i], b.log[i]);

    const at = (i) => a.log[i].out;
    assert.equal(at(0).http, 200);
    assert.deepEqual(at(0).body, { ok: true, logged_out: true });
    assert.equal(at(0).cookie, 'lc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      '登出的 cookie 必须是 Max-Age=0');
    for (let i = 1; i < DELETE_STEPS.length; i++) {
      assert.equal(at(i).http, 200, '登出必须幂等：' + DELETE_STEPS[i].name);
    }

    const tokens = JSON.parse(a.log[a.log.length - 1].snap.sessions).map((r) => r.token);
    assert.ok(!tokens.includes('tok-player'), '登出后该会话必须从库里消失');
    assert.ok(!tokens.includes('tok-admin'), '管理员会话登出后也必须消失');
    assert.ok(tokens.includes('tok-owner'), '别的会话不该被动到');
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 5. _helpers.js —— 公共 helper
// ===========================================================================

test('_helpers：parseSession 全部输入形态两版一致（正则未加锚点，别「顺手修正」）', async () => {
  const { oldM, newM, cleanup } = await loadBoth(HELPERS);
  try {
    const CASES = [
      ['无 Cookie 头', null],
      ['空串', ''],
      ['正常', 'lc_session=tok-admin'],
      ['前面有别的 cookie', 'a=1; lc_session=tok-admin; b=2'],
      ['黏在前一个 cookie 名上（正则未加锚点 → 会匹配）', 'xlc_session=tok-admin'],
      ['lc_session= 空值（[^;]+ 要求至少 1 个字符）', 'lc_session='],
      ['另一个 cookie 名里恰好含 lc_session=', 'foo=lc_session=tok-admin'],
      ['大小写不同（不匹配）', 'LC_SESSION=tok-admin'],
      ['token 是玩家会话（me 为 null）', 'lc_session=tok-player'],
      ['token 是空身份会话（me 为 null）', 'lc_session=tok-empty'],
      ['token 过期（getSession 判死）', 'lc_session=tok-expired'],
      ['token 不存在', 'lc_session=never-existed'],
    ];
    const run = async (m) => {
      const f = await seeded();
      try {
        const out = [];
        for (const [label, ck] of CASES) {
          const headers = ck === null ? {} : { Cookie: ck };
          const r = await m.parseSession({ DB: f.DB }, new Request('https://local.test/api/x', { headers }));
          out.push({
            label,
            sess: r.sess && { player_id: r.sess.player_id, admin_id: r.sess.admin_id, hotel_owner_id: r.sess.hotel_owner_id },
            me: r.me && { id: r.me.id, role: r.me.role, username: r.me.username },
            // 字段顺序也是返回结构的一部分
            meKeys: r.me ? Object.keys(r.me) : null,
            sessKeys: r.sess ? Object.keys(r.sess) : null,
          });
        }
        return { out, snap: await snapshotAll(f.DB) };
      } finally {
        f.close();
      }
    };
    const a = await run(oldM);
    const b = await run(newM);
    assert.deepEqual(b.out, a.out, 'parseSession 各输入形态不一致');
    assert.deepEqual(b.snap, a.snap, 'parseSession 的落库副作用不一致');

    const by = Object.fromEntries(a.out.map((e) => [e.label, e]));
    assert.equal(by['无 Cookie 头'].sess, null);
    assert.equal(by['正常'].me.username, 'super', '管理员会话应解析出 me');
    assert.deepEqual(by['正常'].meKeys, ['id', 'role', 'username'], 'me 只暴露这三列');
    assert.equal(by['前面有别的 cookie'].me.username, 'super');
    assert.equal(by['黏在前一个 cookie 名上（正则未加锚点 → 会匹配）'].me.username, 'super',
      '未加锚点的正则会匹配 xlc_session= —— 这是既有行为');
    assert.equal(by['lc_session= 空值（[^;]+ 要求至少 1 个字符）'].sess, null);
    assert.equal(by['大小写不同（不匹配）'].sess, null);
    assert.equal(by['token 是玩家会话（me 为 null）'].me, null, '玩家会话没有 admin 身份');
    assert.equal(by['token 过期（getSession 判死）'].sess, null);
  } finally {
    cleanup();
  }
});

test('_helpers：resolveSubjectFromSession / resolveSubjectByUsername 两版一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(HELPERS);
  try {
    const run = async (m) => {
      const f = await seeded();
      try {
        const sess = {};
        for (const t of ['tok-player', 'tok-admin', 'tok-both', 'tok-dangling', 'tok-banned', 'tok-empty', 'tok-expired', 'tok-owner', 'tok-ownerclosed', 'never-existed']) {
          const r = await m.parseSession({ DB: f.DB }, new Request('https://local.test/api/x', { headers: { Cookie: `lc_session=${t}` } }));
          sess[t] = r.sess;
        }
        const out = { fromSession: [], byName: [] };
        const inputs = [null, undefined, ...Object.values(sess), { player_id: 999 }, { admin_id: 999 }, { player_id: 2, admin_id: 2 }];
        for (const s of inputs) {
          out.fromSession.push({
            in: s ? { player_id: s.player_id ?? null, admin_id: s.admin_id ?? null, hotel_owner_id: s.hotel_owner_id ?? null } : s,
            out: await m.resolveSubjectFromSession({ DB: f.DB }, s),
          });
        }
        for (const name of ['citizen', 'banned', 'merger', 'dangling', 'super', 'wzc', 'nobody', '', null, undefined, 42, 'CITIZEN']) {
          out.byName.push({ name, out: await m.resolveSubjectByUsername({ DB: f.DB }, name) });
        }
        return { out, snap: await snapshotAll(f.DB) };
      } finally {
        f.close();
      }
    };
    const a = await run(oldM);
    const b = await run(newM);
    assert.deepEqual(b.out, a.out, 'resolveSubject* 不一致');
    assert.deepEqual(b.snap, a.snap, 'resolveSubject* 不应有落库副作用');

    const [nullIn, undefIn] = a.out.fromSession;
    assert.equal(nullIn.out, null, 'null 会话 → null');
    assert.equal(undefIn.out, null, 'undefined 会话 → null');
    const bySess = a.out.fromSession.slice(2);
    const kind = (i) => bySess[i].out && bySess[i].out.kind;
    assert.equal(kind(0), 'player', '玩家会话 → kind=player');
    assert.equal(bySess[0].out.username, 'citizen');
    // admin 1 在夹具里绑了 active 的 player 3，所以纯 admin 会话也会走「合并账号」分支
    assert.equal(kind(1), 'player', '已绑 active 玩家的 admin 会话 → 合并成 player');
    assert.equal(bySess[1].out.username, 'merger');
    assert.equal(bySess[1].out._via_admin, 1, '合并结果带 _via_admin');
    assert.equal(kind(2), 'player', 'player_id 优先于 admin_id（不看 admin 的绑定）');
    assert.equal(bySess[2].out.username, 'merger');
    assert.equal(bySess[2].out._via_admin, undefined, 'player_id 命中时不做合并');
    assert.equal(bySess[3].out.username, 'dangling');
    assert.equal(bySess[3].out.linked_admin_id, undefined, 'resolveSubjectFromSession 不带 linked_admin_id');
    assert.equal(bySess[4].out, null, '已停用玩家 → null');
    assert.equal(bySess[5].out, null, '三种身份全空 → null');
    assert.equal(bySess[6].out, null, '过期会话 → null');
    assert.equal(bySess[7].out, null, '会话里只有 hotel_owner_id → 这里不解析 → null');
    assert.equal(bySess[8].out, null, '已停用的酒店老板 → null');
    assert.equal(bySess[9].out, null, 'token 不存在 → null');
    assert.equal(bySess[10].out, null, 'player_id 指向不存在的行 → null');
    assert.equal(bySess[11].out, null, 'admin_id 指向不存在的行 → null');
    assert.equal(bySess[12].out, null, 'player_id 优先：被停用的 player 2 赢过 admin 2 → null');

    const byName = Object.fromEntries(a.out.byName.map((e) => [String(e.name), e.out]));
    assert.equal(byName['citizen'].kind, 'player');
    assert.equal(byName['citizen'].username, 'citizen');
    assert.equal(byName['banned'], null, '停用玩家查不到');
    assert.equal(byName['merger'].kind, 'player');
    assert.equal(byName['dangling'].kind, 'player');
    assert.equal(byName['super'].kind, 'admin');
    assert.equal(byName['super'].role, 'super');
    assert.equal(byName['wzc'].role, 'admin');
    assert.equal(byName['nobody'], null);
    assert.equal(byName[''], null);
    assert.equal(byName['null'], null, 'null 用户名');
    assert.equal(byName['undefined'], null);
    assert.equal(byName['42'], null, '非字符串用户名');
    assert.equal(byName['CITIZEN'], null, '用户名大小写敏感');
  } finally {
    cleanup();
  }
});

test('_helpers：合并账号的 _via_admin / _admin_username 与失效回退两版一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(HELPERS);
  try {
    const run = async (m) => {
      const f = await seeded();
      try {
        // admin 1 已绑 player 3(active) —— 合并成功
        const merged = await m.resolveSubjectFromSession({ DB: f.DB }, { admin_id: 1 });
        // 改绑到已停用的 player 2 —— 合并失败，回退成 admin 自己
        await f.DB.prepare('UPDATE admins SET linked_player_id=2 WHERE id=1').run();
        const staleLink = await m.resolveSubjectFromSession({ DB: f.DB }, { admin_id: 1 });
        return { merged, staleLink };
      } finally {
        f.close();
      }
    };
    const a = await run(oldM);
    const b = await run(newM);
    assert.deepEqual(b, a, '合并账号的返回结构/回退不一致');

    assert.equal(a.merged.kind, 'player', '合并后 kind 仍是 player');
    assert.equal(a.merged.username, 'merger');
    assert.equal(a.merged._via_admin, 1, '必须带 _via_admin');
    assert.equal(a.merged._admin_username, 'super', '必须带 _admin_username');
    assert.deepEqual(Object.keys(a.merged), ['id', 'username', 'kind', '_via_admin', '_admin_username'],
      '合并结果的字段集合与顺序');
    assert.equal(a.staleLink.kind, 'admin', '绑定的玩家被停用时应回退成 admin');
    assert.equal(a.staleLink.username, 'super');
    assert.equal(a.staleLink._via_admin, undefined);
  } finally {
    cleanup();
  }
});

test('_helpers：getRpId / getOrigin / ok / err 两版一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(HELPERS);
  try {
    const URLS = [
      'https://local.test/api/x',
      'https://www.local.test/api/x',
      'http://localhost:8787/api/x',
      'https://www.www.example.com/a',
      'https://WWW.Example.com/',
      'https://sub.example.com/deep/path?x=1',
      'http://192.168.1.10:8080/',
    ];
    const rp = URLS.map((u) => ({ u, a: oldM.getRpId(new Request(u)), b: newM.getRpId(new Request(u)) }));
    assert.deepEqual(rp.map((r) => r.b), rp.map((r) => r.a), 'getRpId 不一致');
    const byUrl = Object.fromEntries(rp.map((r) => [r.u, r.a]));
    assert.equal(byUrl['https://local.test/api/x'], 'local.test');
    assert.equal(byUrl['https://www.local.test/api/x'], 'local.test', 'www. 前缀要被剥掉');
    assert.equal(byUrl['https://www.www.example.com/a'], 'www.example.com', '只剥一层 www.');
    assert.equal(byUrl['https://WWW.Example.com/'], 'example.com', 'URL 会先把 host 归一成小写，再剥 www.');
    assert.equal(byUrl['https://sub.example.com/deep/path?x=1'], 'sub.example.com');
    assert.equal(byUrl['http://192.168.1.10:8080/'], '192.168.1.10', '端口不进 rpId');

    const og = URLS.map((u) => ({ u, a: oldM.getOrigin(new Request(u)), b: newM.getOrigin(new Request(u)) }));
    assert.deepEqual(og.map((r) => r.b), og.map((r) => r.a), 'getOrigin 不一致');
    assert.equal(og[0].a, 'https://local.test');
    assert.equal(og[1].a, 'https://www.local.test', 'getOrigin 不剥 www.');
    assert.equal(og[2].a, 'http://localhost:8787', 'origin 含端口');

    // ok / err：状态码、头、body 形状都是契约
    // label 只用来分组，比对前摘掉（否则 '原' vs '新' 必然不等）
    const shapes = [];
    for (const [label, m] of [['原', oldM], ['新', newM]]) {
      for (const data of [{ n: 1 }, { ok: false, n: 2 }, {}, { nested: { a: [1, 2] } }]) {
        const r = m.ok(data);
        shapes.push({ label, kind: 'ok', http: r.status, body: await r.json(), ct: r.headers.get('Content-Type') });
      }
      for (const [status, message] of [[400, '参数不对'], [401, '请先登录'], [403, '没有权限'], [500, '出错了']]) {
        const r = m.err(status, message);
        shapes.push({ label, kind: 'err', http: r.status, body: await r.json(), ct: r.headers.get('Content-Type') });
      }
    }
    const strip = (arr) => arr.map(({ label, ...rest }) => rest);
    const oldShapes = shapes.filter((s) => s.label === '原');
    const newShapes = shapes.filter((s) => s.label === '新');
    assert.deepEqual(strip(newShapes), strip(oldShapes), 'ok/err 的状态码 / body / 头不一致');
    assert.equal(oldShapes[0].http, 200);
    assert.deepEqual(oldShapes[0].body, { ok: true, n: 1 });
    assert.equal(oldShapes[1].body.ok, false, '调用方传 ok:false 应覆盖默认的 true');
    assert.equal(oldShapes[2].http, 200, 'ok() 空数据也返回 200');
    assert.equal(oldShapes[4].http, 400);
    assert.deepEqual(oldShapes[4].body, { ok: false, error: '参数不对' });
    assert.equal(oldShapes[4].ct, 'application/json; charset=utf-8');
    assert.equal(oldShapes[7].http, 500, 'err 的状态码必须原样透传');
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 6. 与真实路由（dispatch）的交叉验证
// ===========================================================================

/**
 * 前面所有用例都直接调导出函数。这里再用真实路由跑一遍现版，
 * 确认「直接调」和「经 _middleware 分发」看到的是同一个行为 ——
 * 否则差分可能只是在忠实地测一个没人真正使用的调用姿势。
 */
test('现版经 dispatch 真实路由：登录 → 取身份 → 登出闭环', async () => {
  const DB = database();
  try {
    await ensureDatabase(DB);
    await DB.prepare("INSERT INTO players(id,username,email,password_hash,salt,status,emeralds) VALUES(1,'citizen','c1@example.invalid',?,?,'active',1000)").bind(HASH, SALT).run();

    const env = { DB };
    const login = await dispatch(
      new Request('https://local.test/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
        body: JSON.stringify({ username: 'citizen', password: PASSWORD }),
      }),
      env
    );
    assert.equal(login.status, 200);
    const cookie = login.headers.get('Set-Cookie').split(';')[0];
    assert.match(cookie, /^lc_session=[0-9a-f]{48}$/, 'token 应是 24 字节 = 48 hex');
    assert.equal(login.headers.get('X-App-Schema-Version'), '67', '中间件补的头不能少');
    assert.deepEqual(await login.json(), { ok: true, user_id: 1, role: 'player' });

    // 中间件会顺手记一条登录历史
    const history = (await DB.prepare('SELECT player_id,method,device_label FROM login_history').all()).results;
    assert.equal(history.length, 1, '登录成功应留一条设备历史');
    assert.equal(history[0].player_id, 1);
    assert.equal(history[0].method, 'password');

    const me = await dispatch(new Request('https://local.test/api/login', { headers: { Cookie: cookie } }), env);
    assert.equal(me.status, 200);
    const d = await me.json();
    assert.equal(d.player.username, 'citizen');
    assert.equal(d.player.emeralds, 1000);
    assert.equal(d.hotel_owner, null);

    // 登录不能动 players 的密码与 last_login_at
    const row = (await DB.prepare('SELECT password_hash,salt,last_login_at FROM players WHERE id=1').first());
    assert.equal(row.password_hash, HASH);
    assert.equal(row.salt, SALT);
    assert.equal(row.last_login_at, null, 'login.js 不该顺手更新 last_login_at');

    const out = await dispatch(new Request('https://local.test/api/login', { method: 'DELETE', headers: { Cookie: cookie } }), env);
    assert.equal(out.status, 200);
    assert.deepEqual(await out.json(), { ok: true, logged_out: true });
    assert.equal(out.headers.get('Set-Cookie'), 'lc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n, 0, '登出后会话应被删掉');
  } finally {
    DB.close();
  }
});

test('现版经 dispatch 真实路由：失败路径不发 cookie、不建会话', async () => {
  const DB = database();
  try {
    await ensureDatabase(DB);
    await DB.prepare("INSERT INTO players(id,username,email,password_hash,salt,status) VALUES(1,'citizen','c1@example.invalid',?,?,'active')").bind(HASH, SALT).run();
    const env = { DB };
    for (const [label, body, expect] of [
      ['错密码', { username: 'citizen', password: 'wrong' }, 401],
      ['账号不存在', { username: 'nobody', password: PASSWORD }, 401],
      ['缺 username', { password: PASSWORD }, 400],
      ['缺 password', { username: 'citizen' }, 400],
    ]) {
      const r = await dispatch(
        new Request('https://local.test/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env
      );
      assert.equal(r.status, expect, label);
      assert.equal(r.headers.get('Set-Cookie'), null, label + '：失败不得下发 cookie');
    }
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n, 0, '失败路径不该建会话');
    // 只有两个 401 会写 auth_attempts；两条 400 在密码校验之前就返回了
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM auth_attempts').first()).n, 2, '只有 401 写 auth_attempts');
  } finally {
    DB.close();
  }
});
