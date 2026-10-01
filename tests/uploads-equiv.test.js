// uploads 链路的行为差分（functions/_core/uploads.js + functions/api/uploads.js）。
//
// 背景：v88.7 那一轮报告（audit/v88.7/regression.md:107）写着
//   「env.R2 为 null，故 api/uploads.js 分片上传/流式读与 _core/uploads.js 的
//     R2 落盘没真跑过（补偿：token 级源码比对 966/966 完全一致）」
// 并把这块列为「没验到的部分」。
//
// **那个理由是错的。** 本仓库从头到尾没有任何 R2 代码：
//   git grep -n 'env\.R2\|BUCKET' HEAD    → 0 命中（唯一命中是那份报告自己的文字）
//   git grep -n 'env\.R2\|BUCKET' 06e9595 → 0 命中
//   wrangler.toml 只有 [[d1_databases]]，没有 r2_buckets
// 分块上传 / 流式读 / 落盘全部走 **D1**：分块进 media_chunks.data（base64 文本），
// 流式读是 `SELECT part,data FROM media_chunks ... LIMIT 16`。所以「R2 盲区」
// 实际是「上传链路根本没被行为验证过」的盲区，只是归因错了。
//
// 本文件补的正是这个真盲区：拿真 SQLite 把上传全流程跑两遍，逐场景比对
// **返回值 + 抛出的异常 + 全库所有表的完整快照**。
//
// 关于「R2 路径」：本文件仍然往 env 上挂了一个会记录每次调用的 R2 stub，
// 并断言整条上传链路对它的调用次数为 0。价值在于：将来谁真的给上传加了 R2，
// 这套测试会立刻炸，而不是像现在这样静悄悄地「两版都不调，也就差分不出来」。
//
// ---------------------------------------------------------------------------
// 差分口径（唯一的两处妥协，都在下面写明）
//
// 1. 时间戳。SQLite 的 CURRENT_TIMESTAMP 是真实时钟，同一场景的两次执行可能
//    跨秒，精确比对 created_at 会随机假红。所以只对「DEFAULT CURRENT_TIMESTAMP」
//    的那一小组列做 <TS> 归一（下面 VOLATILE_TS_COLS）。expires_at 这种显式
//    写死的时间仍然逐字比对。GC / created_at 相对年龄的语义另外用 probe 精确断言。
// 2. 长文本。media_chunks.data 单行 35 万字符，整表 dump 会把日志撑爆。
//    超过 120 字符的字符串换成 <长度:sha256前16位>；长度和摘要都是内容敏感的，
//    base64 里改一个字节长度不变但摘要必变，所以不丢差异。
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { database, dispatch } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';
import { CHUNK_SIZE, IMAGE_LIMIT, VIDEO_LIMIT, MAX_TICKET_BYTES, MAX_ATTACHMENTS } from '../shared/uploads.js';

const BASELINE = '06e9595';
const CORE_PATH = 'functions/_core/uploads.js';
const API_PATH = 'functions/api/uploads.js';

const show = (path) => execSync(`git show ${BASELINE}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 28 });
const read = (p) => readFileSync(p, 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');

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
//
// POST 建草稿用 crypto.randomUUID() 当附件 id。不固定的话两版拿到不同 id，
// 全库快照就永远对不上，差分形同虚设。计数器在每个版本跑之前归零。
// ===========================================================================

let uuidSeq = 0;
const pad = (n) => String(n).padStart(12, '0');
/** 测试种子造的附件 id */
const UUID = (n) => `00000000-0000-4000-8000-${pad(n)}`;
/** 被测代码自己 randomUUID() 出来的附件 id。必须与种子不同区段，否则建草稿会撞主键 */
const G = (n) => `10000000-0000-4000-8000-${pad(n)}`;
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  configurable: true,
  writable: true,
  value: () => G(++uuidSeq),
});

const B64 = (bytes) => Buffer.from(bytes).toString('base64');

// ===========================================================================
// 临时副本
// ===========================================================================

const ownedTmpFiles = new Set();
let tmpSeq = 0;

function cleanupTmpFiles() {
  for (const f of ownedTmpFiles) { try { unlinkSync(f); } catch {} }
  ownedTmpFiles.clear();
}
process.on('exit', cleanupTmpFiles);
process.on('uncaughtException', (e) => { cleanupTmpFiles(); throw e; });

/**
 * 把两个文件的两版同时装好。
 *
 * 坑：基线的 api/uploads.js 里写着 `from '../_core/uploads.js'` —— 直接落盘的话，
 * 基线路由会去 import **现版** 的 _core，差分就变成「现版 _core + 基线路由」，
 * 测不到想测的东西。所以落盘后必须把这条 import 改指基线副本，
 * 改完要断言真的改到了（下面的 throw），否则差分会静悄悄退化成半个测试。
 */
async function loadPair() {
  const coreName = `.equiv-${process.pid}-${++tmpSeq}-uploads.mjs`;
  const coreRel = `functions/_core/${coreName}`;
  writeFileSync(coreRel, show(CORE_PATH));
  ownedTmpFiles.add(coreRel);

  const apiName = `.equiv-${process.pid}-${++tmpSeq}-uploads.mjs`;
  const apiRel = `functions/api/${apiName}`;
  const baseApi = show(API_PATH);
  const patched = baseApi.replace(/(['"])\.\.\/_core\/uploads\.js\1/, `$1../_core/${coreName}$1`);
  if (patched === baseApi) throw new Error(`基线 ${API_PATH} 里找不到 '../_core/uploads.js' 的 import，无法把基线路由接到基线 _core 上`);
  writeFileSync(apiRel, patched);
  ownedTmpFiles.add(apiRel);

  const [oldCore, newCore, oldApi, newApi] = await Promise.all([
    import('../' + coreRel),
    import('../' + CORE_PATH),
    import('../' + apiRel),
    import('../' + API_PATH),
  ]);
  return {
    old: { core: oldCore, api: oldApi },
    new: { core: newCore, api: newApi },
    cleanup: () => {
      for (const f of [coreRel, apiRel]) { try { unlinkSync(f); } catch {} ownedTmpFiles.delete(f); }
    },
  };
}

// ===========================================================================
// R2 stub
//
// 依据 uploads.js 读出来的结论：两个文件一次都没碰过 R2。所以这个 stub 的
// 接口形状（put/get/delete/head/list/multipart）**没有**任何调用点约束它，
// 形状取自 Cloudflare 官方文档。后果见文末「没验到的部分」。
// ===========================================================================

function makeR2Spy() {
  const calls = [];
  const store = new Map();
  const byteLen = (v) => (v == null ? 0 : typeof v === 'string' ? v.length : v.byteLength ?? v.size ?? 0);
  const bump = (op, key) => calls.push(key === undefined ? op : `${op} ${key}`);
  return {
    calls,
    store,
    binding: {
      put: async (key, value) => { bump('put', key); store.set(key, value); return { key, size: byteLen(value) }; },
      get: async (key) => {
        bump('get', key);
        if (!store.has(key)) throw Object.assign(new Error('Not Found'), { code: 10007 });
        return store.get(key);
      },
      head: async (key) => { bump('head', key); return store.has(key) ? { key, size: byteLen(store.get(key)), customMetadata: {} } : null; },
      delete: async (key) => { bump('delete', key); return store.delete(key) ? undefined : null; },
      list: async ({ prefix = '', limit = 1000, cursor } = {}) => {
        bump('list', prefix);
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
        const after = cursor ? keys.filter((k) => k > cursor) : keys;
        const page = after.slice(0, limit);
        const truncated = after.length > limit;
        return { objects: page.map((k) => ({ key: k, size: byteLen(store.get(k)) })), truncated, cursor: truncated ? page[page.length - 1] : null };
      },
      createMultipartUpload: async (key) => { bump('createMultipartUpload', key); return { key, uploadId: 'u1' }; },
      resumeMultipartUpload: (key) => ({
        key,
        uploadId: 'u1',
        uploadPart: async (n) => { bump('uploadPart', `${key}#${n}`); return { partNumber: n, etag: 'e' }; },
        complete: async () => ({ key }),
        abort: async () => ({}),
      }),
    },
  };
}

let r2Ref = makeR2Spy();

// ===========================================================================
// 真库 + 种子
// ===========================================================================

const SESSIONS = {
  anon: '',
  p1: 'tok-p1',
  p2: 'tok-p2',
  super: 'tok-super',
  wzc: 'tok-wzc',
  howner: 'tok-howner', // 玩家 2，同时绑着 hotel_owners.id=1
  both: 'tok-both',     // 玩家 1 + 管理员 2（合并会话）
};

async function seeded() {
  const DB = database();
  await ensureDatabase(DB);
  const r = (sql, ...p) => DB.prepare(sql).bind(...p).run();

  await r("INSERT INTO players(id,username,email,password_hash,salt,status,emeralds) VALUES(1,'citizen','c1@x.invalid','x','x','active',1000)");
  await r("INSERT INTO players(id,username,email,password_hash,salt,status,emeralds) VALUES(2,'landlord','c2@x.invalid','x','x','active',10)");
  await r("INSERT INTO admins(id,username,role,password_hash,salt) VALUES(1,'root','super','x','x')");
  await r("INSERT INTO admins(id,username,role,password_hash,salt) VALUES(2,'wzc','admin','x','x')");
  await r("INSERT INTO hotel_owners(id,username,password_hash,salt,linked_player_id,status) VALUES(1,'boss','x','x',2,'active')");

  await r("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('tok-p1',1,NULL,'2099-01-01 00:00:00')");
  await r("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('tok-p2',2,NULL,'2099-01-01 00:00:00')");
  await r("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('tok-super',NULL,1,'2099-01-01 00:00:00')");
  await r("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('tok-wzc',NULL,2,'2099-01-01 00:00:00')");
  await r("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('tok-howner',2,NULL,'2099-01-01 00:00:00')");
  await r("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('tok-both',1,2,'2099-01-01 00:00:00')");

  // 工单矩阵：1 普通 / 2 被投诉人=管理员2 / 3 被投诉人=玩家2 / 4 别人的 / 5 别人且被投诉
  await r("INSERT INTO tickets(id,player_id,category,title,status) VALUES(1,1,'other','普通工单','open')");
  await r("INSERT INTO tickets(id,player_id,category,title,status,target_admin_id) VALUES(2,1,'other','投诉管理员','open',2)");
  await r("INSERT INTO tickets(id,player_id,category,title,status,target_player_id) VALUES(3,1,'other','投诉玩家','open',2)");
  await r("INSERT INTO tickets(id,player_id,category,title,status) VALUES(4,2,'other','别人的工单','open')");
  await r("INSERT INTO tickets(id,player_id,category,title,status,target_player_id) VALUES(5,2,'other','别人的投诉单','open',2)");
  // 6: 被投诉人就是超管本人 —— 只有这种单子能观测到「GET 不受回避限制」这条豁免
  await r("INSERT INTO tickets(id,player_id,category,title,status,target_admin_id) VALUES(6,2,'other','投诉超管的单','open',1)");
  await r("INSERT INTO messages(id,player_id,name,contact,type,content) VALUES(1,1,'甲','1','other','旧留言')");
  await r("INSERT INTO messages(id,player_id,name,contact,type,content,target_admin_id) VALUES(2,1,'乙','1','other','被投诉的旧留言',2)");

  let closed = false;
  return { DB, close: () => { if (closed) return; closed = true; try { DB.close(); } catch {} } };
}

// ===========================================================================
// 快照
// ===========================================================================

const VOLATILE_TS_COLS = new Set([
  'created_at', 'updated_at', 'applied_at', 'requested_at', 'last_login_at',
  'replied_at', 'resolved_at', 'submitted_at', 'reviewed_at',
]);
const TS_RE = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/g;

const squashRow = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => {
    if (typeof v !== 'string') return [k, v];
    if (v.length > 120) return [k, `<${v.length}字:${sha(v).slice(0, 16)}>`];
    if (VOLATILE_TS_COLS.has(k)) return [k, v.replace(TS_RE, '<TS>')];
    return [k, v];
  }));

async function snapshot(DB) {
  const names = (await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()).results.map((x) => x.name);
  const out = {};
  for (const t of names) {
    const rows = (await DB.prepare(`SELECT * FROM "${t}"`).all()).results.map(squashRow);
    rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    out[t] = rows;
  }
  return out;
}

// ===========================================================================
// 场景执行器
// ===========================================================================

async function readResponse(r, wantBinary) {
  const out = {
    status: r.status,
    headers: Object.fromEntries([...r.headers.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) out.json = await r.json();
  else if (wantBinary) {
    try {
      const buf = Buffer.from(await r.arrayBuffer());
      out.bin = { len: buf.length, sha: sha(buf), head: buf.subarray(0, 16).toString('hex') };
    } catch (e) {
      out.binError = String(e && e.message);
    }
  } else out.text = await r.text();
  return out;
}

function makeContext(env, { as = 'anon', method = 'GET', url = '/api/uploads', headers = {}, body } = {}) {
  const token = SESSIONS[as];
  const h = { ...(token ? { Cookie: `lc_session=${token}` } : {}), ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  return {
    env,
    waitUntil: (p) => p.catch(() => {}),
    request: new Request('https://local.test' + url, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
  };
}

const HANDLER = { GET: 'onRequestGet', POST: 'onRequestPost', PUT: 'onRequestPut', DELETE: 'onRequestDelete', PATCH: 'onRequestPatch' };

/** 取路由的导出 handler。缺了就直接炸 —— 静默变成 TypeError 会让「两版一起错」伪装成差分通过 */
function handlerOf(mod, method) {
  const name = HANDLER[method];
  if (!name) throw new Error(`未知方法 ${method}`);
  if (typeof mod[name] !== 'function') throw new Error(`${name} 不是函数 —— 副本装错了，或 export 名字变了`);
  return mod[name];
}

async function runSteps(env, mod, steps) {
  const out = [];
  for (const s of steps) {
    const c = makeContext(env, s);
    const fn = handlerOf(mod, s.method);
    let rec;
    try {
      rec = await readResponse(await fn(c), !!s.binary);
    } catch (e) {
      rec = { threw: e.status ?? null, message: e.message };
    }
    if (s.label) rec.label = s.label;
    out.push(rec);
  }
  return out;
}

/**
 * 记录 DB.batch 里 SQL 的先后顺序的代理。
 *
 * 为什么只盯 batch：分块先删还是主记录先删，在**数据上观测不到** —— media_chunks
 * 没有外键，两个顺序跑完的结果一模一样。想验「先删分块」只能看发出去的语句顺序。
 * 而整条 SQL 文本不能比：基线是压缩写法（`COALESCE(SUM(size),0)AS bytes`），
 * 现版是可读写法（`... 0) AS bytes`），去空白后仍有 `)AS` vs `) AS` 的差别。
 * 所以这里把所有空白都删掉再比 —— 那条 GC batch 和 DELETE batch 两版就完全一致了。
 */
function batchTraceDb(DB, log) {
  return {
    prepare: (sql) => DB.prepare(sql),
    batch: (items) => {
      for (const it of items) log.push(String(it.sql).replace(/\s+/g, ''));
      return DB.batch(items);
    },
  };
}

/** 同一个场景在两版上各跑一遍（各自一份全新真库），比对逐响应 + 全库快照 + batch 顺序 */
async function differential(pair, { seed, steps, fault, probe, intentional }) {
  const results = [];
  for (const mod of [pair.old.api, pair.new.api]) {
    const f = await seeded();
    try {
      uuidSeq = 0;
      if (seed) await seed(f.DB);
      const batchLog = [];
      const base = fault ? fault(f.DB) : f.DB;
      const env = { DB: batchTraceDb(base, batchLog), R2: r2Ref.binding };
      const stepsOut = await runSteps(env, mod, steps);
      results.push({
        steps: stepsOut,
        db: await snapshot(f.DB),
        r2: r2Ref.calls.slice(),
        batch: batchLog.slice(),
        probe: probe ? await probe(f.DB) : null,
      });
    } finally {
      f.close();
    }
  }
  const [a, b] = results;
  if (process.env.EQUIV_DEBUG) {
    console.error('--- steps ---\n' + JSON.stringify(a.steps, null, 1));
    console.error('--- media_uploads ---\n' + JSON.stringify(a.db.media_uploads, null, 1));
    console.error('--- probe ---\n' + JSON.stringify(a.probe, null, 1));
  }

  // ── 有意的行为变更登记 ────────────────────────────────────────────────
  // 差分的职责是拦「未预期」的变化。有意的修复必须显式登记，
  // 而且登记本身也要被检查：登记了却没命中（说明改动被回退了）要报，
  // 没登记却变了（说明出现了计划外的变化）也要报。
  if (intentional) {
    const fired = new Set();
    for (const rule of intentional) {
      const i = steps.findIndex((s) => s.label === rule.label);
      assert.notEqual(i, -1, `登记的 label 在 steps 里找不到：${rule.label}`);
      if (JSON.stringify(b.steps[i]) === JSON.stringify(a.steps[i])) continue;
      fired.add(rule.label);
      assert.deepEqual(
        b.steps[i],
        rule.to,
        `${rule.label} 的实际变化与登记的不一致。\n  登记为：${JSON.stringify(rule.to)}\n  实际为：${JSON.stringify(b.steps[i])}`
      );
    }
    // 未登记的差异
    const unlisted = steps
      .map((s, i) => [s.label, a.steps[i], b.steps[i]])
      .filter(([label, x, y]) => JSON.stringify(x) !== JSON.stringify(y) && ![...fired].includes(label));
    assert.deepEqual(unlisted, [], '出现未登记的行为变化：\n' + unlisted.map(([l, x, y]) => `  ${l}\n    旧 ${JSON.stringify(x)}\n    新 ${JSON.stringify(y)}`).join('\n'));
    // 登记了却没命中的（stale）
    const stale = [...fired].length === 0
      ? intentional.map((r) => r.label)
      : intentional.filter((r) => !fired.has(r.label)).map((r) => r.label);
    assert.deepEqual(stale, [], '这些登记项没有命中 —— 要么改动被回退了，要么登记该删：\n' + stale.join('\n'));
  }

  // 登记过的差异在中性化之后再比：**未**登记的任何变化仍然会让这条挂掉。
  if (intentional) {
    const neutral = b.steps.map((s, i) =>
      intentional.some((r) => r.label === steps[i].label) ? a.steps[i] : s
    );
    assert.deepEqual(neutral, a.steps, '逐场景响应不一致（登记过的差异已中性化）');
  } else {
    assert.deepEqual(b.steps, a.steps, '逐场景响应不一致（状态码 / 响应头 / 响应体 / 抛出的异常）');
  }
  assert.deepEqual(b.db, a.db, '全库快照不一致');
  assert.deepEqual(b.r2, a.r2, 'R2 调用序列不一致');
  assert.deepEqual(b.batch, a.batch, 'DB.batch 里 SQL 的先后顺序不一致');
  assert.deepEqual(b.probe, a.probe, 'probe 结果不一致');
  // 返回值是**基线**（旧版）那侧，字段与原来完全一致。
  // 另把现版那侧挂在 `new` 上：登记过的有意差异必须用 `byLabel(a.new.steps)` 读，
  // 拿基线那侧去断言修复后的期望，会得到「基线怎么也不该对」的假红。
  return Object.assign(a, { new: b });
}

// ===========================================================================
// 测试用造物
// ===========================================================================

/** 按 mime 造出首部合法、总长至少 size 字节的内容；尾部是固定图案，便于独立算期望值 */
function makeBytes(mime, size) {
  const head = {
    'image/png': [137, 80, 78, 71, 13, 10, 26, 10],
    'image/jpeg': [255, 216, 255, 224],
    'image/gif': [...Buffer.from('GIF89a')],
    'image/webp': [...Buffer.from('RIFF\0\0\0\0WEBPVP8 ')],
    'video/mp4': [0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 0, 0, 0],
  }[mime] || [1, 2, 3, 4, 5, 6, 7, 8];
  const out = new Uint8Array(Math.max(size, head.length));
  out.set(head, 0);
  for (let i = head.length; i < out.length; i++) out[i] = i % 251;
  return out;
}

/** 直接塞一个附件（默认 ready）及其全部分块，跳过 PUT，专供 GET 下载 / 流式读的用例 */
async function seedReadyUpload(DB, { id, owner = 1, kind = 'player', size, chunkSize = CHUNK_SIZE, mime = 'image/jpeg', purpose = 'ticket', name = 'photo.jpg', publicAccess = 0, skipPart = null, status = 'ready', createdAt = '2026-01-01 00:00:00', noChunks = false }) {
  const col = { player: 'owner_player_id', admin: 'owner_admin_id', hotel: 'owner_hotel_id' }[kind];
  const chunkCount = Math.ceil(size / chunkSize);
  await DB.prepare(
    `INSERT INTO media_uploads(id,${col},name,mime,size,chunk_count,purpose,status,public_access,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, owner, name, mime, size, chunkCount, purpose, status, publicAccess, createdAt).run();
  if (noChunks) return { id, size, chunkCount };
  const all = makeBytes(mime, size);
  for (let p = 0; p < chunkCount; p++) {
    if (p === skipPart) continue;
    const seg = all.slice(p * chunkSize, Math.min(size, (p + 1) * chunkSize));
    await DB.prepare('INSERT INTO media_chunks(upload_id,part,data,byte_size) VALUES(?,?,?,?)').bind(id, p, B64(seg), seg.length).run();
  }
  return { id, size, chunkCount };
}

const byLabel = (steps) => (name) => {
  const hit = steps.find((s) => s.label === name);
  if (!hit) throw new Error(`没有名为「${name}」的步骤；实际有：${JSON.stringify(steps.map((s) => s.label))}`);
  return hit;
};

// ===========================================================================
// 1. export 名单
// ===========================================================================

test(`uploads：两个文件都没改 export 名单（对照 ${BASELINE}）`, () => {
  const problems = [];
  for (const path of [CORE_PATH, API_PATH]) {
    assert.notEqual(show(path), read(path), `${path} 竟然和基线一模一样，差分就白做了`);
    const before = exportNames(show(path));
    const after = exportNames(read(path));
    const lost = before.filter((n) => !after.includes(n));
    const added = after.filter((n) => !before.includes(n));
    if (lost.length || added.length) problems.push(`${path}: 少了 [${lost.join(' ')}]，多了 [${added.join(' ')}]`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
  // 防假绿：正则全落空时上面会「全绿」
  assert.equal(exportNames(read(CORE_PATH)).length, 11, 'core 应认出 11 个 export');
  assert.equal(exportNames(read(API_PATH)).length, 4, 'api 应认出 4 个 export');
});

// ===========================================================================
// 2. R2：stub 自身语义 + 上传链路零调用
// ===========================================================================

test('R2：stub 自身行为符合 Cloudflare 语义，且上传全链路对 R2 调用次数为 0', async () => {
  const r2 = makeR2Spy();
  const b = r2.binding;

  // —— stub 自检：先证明 stub 自己的语义对，差分才有意义 ——
  await b.put('a/1.txt', 'hello');
  assert.equal(await b.get('a/1.txt'), 'hello', 'put 之后 get 必须拿得到');
  assert.deepEqual(await b.head('a/1.txt'), { key: 'a/1.txt', size: 5, customMetadata: {} });
  await b.put('a/2.txt', 'world');
  await b.put('b/3.txt', 'other');
  assert.deepEqual((await b.list({ prefix: 'a/' })).objects.map((o) => o.key), ['a/1.txt', 'a/2.txt'], 'list 要按 prefix 过滤且有序');
  const paged = await b.list({ limit: 2 });
  assert.equal(paged.truncated, true, 'limit 用尽时 truncated 必须为 true');
  assert.equal(paged.cursor, 'a/2.txt', '分页游标是本页最后一个 key');
  assert.deepEqual((await b.list({ cursor: 'a/2.txt' })).objects.map((o) => o.key), ['b/3.txt'], '游标之后不能重复本页');
  assert.equal(await b.delete('a/1.txt'), undefined, '删已存在的 key 返回 undefined');
  assert.equal(await b.delete('a/1.txt'), null, '删不存在的 key 返回 null');
  assert.equal(await b.head('a/1.txt'), null, '删掉之后 head 返回 null');
  const missing = await b.get('nope').then(() => 'RESOLVED', (e) => e.code);
  assert.equal(missing, 10007, '取不存在的 key 必须以 code=10007 抛错，而不是返回 null');
  // 关键语义：get 失败是**抛异常**。若代码写成 `if (!await get(k))` 就会漏判。
  // 把这一条钉死，才能说明「stub 不会让两边一起错成假阴性」。
  assert.deepEqual(r2.calls.slice(0, 3), ['put a/1.txt', 'get a/1.txt', 'head a/1.txt'], '调用记录顺序必须忠实');
  await b.createMultipartUpload('m/1');
  await b.resumeMultipartUpload('m/1').uploadPart(1, new Uint8Array(4));

  // —— 真正的结论：跑一遍完整上传，R2 一次都不该被碰 ——
  const pair = await loadPair();
  try {
    const id = UUID(1);
    const before = r2Ref.calls.length;
    await differential(pair, {
      seed: (DB) => seedReadyUpload(DB, { id, size: CHUNK_SIZE * 2 }),
      steps: [
        { method: 'GET', as: 'p1', url: `/api/uploads?id=${id}&download=1`, binary: true, label: '下载' },
        { method: 'GET', as: 'p1', url: `/api/uploads?id=${id}`, label: '元信息' },
        { method: 'PUT', as: 'p1', url: `/api/uploads?id=${id}&part=0`, body: { data: B64(makeBytes('image/jpeg', CHUNK_SIZE)) } },
        { method: 'POST', as: 'p1', body: { action: 'finish', id } },
        { method: 'DELETE', as: 'p1', url: `/api/uploads?id=${id}` },
      ],
    });
    assert.equal(r2Ref.calls.length, before, `上传链路碰了 R2：${JSON.stringify(r2Ref.calls.slice(before))}`);
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 3. 纯函数
// ===========================================================================

test('uploads：validId / uploadUrl / ownerColumn / ownedBy / fileMetadata 两版逐个一致', async () => {
  const pair = await loadPair();
  try {
    for (const [label, mod] of [['基线', pair.old.core], ['现版', pair.new.core]]) {
      const call = (fn, ...a) => { try { return { v: mod[fn](...a) }; } catch (e) { return { t: e.status, m: e.message }; } };
      const IDS = [
        'a'.repeat(19), 'a'.repeat(20), 'a'.repeat(64), 'a'.repeat(65),
        '../../../etc/passwd', '../secret', 'a/b', 'a\\b', 'a b', 'a.b', '灯灯'.repeat(12),
        'a'.repeat(20) + '/x', '', 'x', null, undefined, 12345, {}, [], 'AAAA-____BBBB',
        // ⚠ 穿越样本必须够长：'../secret' 只有 9 字符，会先被 {20,64} 的长度下限挡掉，
        // 于是「把 / 和 . 放进字符类」这种变异根本测不出来。下面这批都 ≥20 字符。
        '../' + 'a'.repeat(20), 'a'.repeat(20) + '/../../etc/passwd', '..'.repeat(12),
        '/'.repeat(24), '.'.repeat(24), './' + 'x'.repeat(22), 'a'.repeat(20) + '%2e%2e%2f',
        '灯灯'.repeat(12) + '/../x',
      ];
      const got = IDS.map((v) => call('validId', v));
      // 防假绿：锁住 20–64 边界与穿越拒绝
      assert.deepEqual(got[1], { v: 'a'.repeat(20) }, `${label}：20 字符必须放行`);
      assert.deepEqual(got[2], { v: 'a'.repeat(64) }, `${label}：64 字符必须放行`);
      assert.deepEqual(got[0], { t: 400, m: '附件 ID 无效' }, `${label}：19 字符必须拒`);
      assert.deepEqual(got[3], { t: 400, m: '附件 ID 无效' }, `${label}：65 字符必须拒`);
      assert.deepEqual(got[4], { t: 400, m: '附件 ID 无效' }, `${label}：路径穿越必须拒`);
      // 长穿越串也必须拒（这一组专门防「把 / . 放进字符类」的重构手滑）
      for (const v of ['../' + 'a'.repeat(20), 'a'.repeat(20) + '/../../etc/passwd', '..'.repeat(12), '/'.repeat(24), '.'.repeat(24)]) {
        assert.deepEqual(call('validId', v), { t: 400, m: '附件 ID 无效' }, `${label}：${v.slice(0, 12)}… 必须拒`);
      }
      assert.deepEqual(call('uploadUrl', 'a b&c'), { v: '/api/uploads?id=a%20b%26c&download=1' }, `${label}：uploadUrl 必须 encodeURIComponent`);

      for (const [kind, col] of [['player', 'owner_player_id'], ['admin', 'owner_admin_id'], ['hotel_owner', 'owner_hotel_id']]) {
        assert.equal(mod.ownerColumn({ kind }), col, `${label}：${kind} 的 owner 列错了`);
      }
      assert.equal(mod.ownedBy({ owner_player_id: 7 }, { kind: 'player', user: { id: 7 } }), true);
      assert.equal(mod.ownedBy({ owner_player_id: 7, owner_admin_id: 9 }, { kind: 'admin', user: { id: 7 } }), false, 'admin 只看 owner_admin_id');
      assert.equal(mod.ownedBy({ owner_hotel_id: 3 }, { kind: 'player', user: { id: 3 } }), false, 'player 只看 owner_player_id');
      assert.deepEqual(
        mod.fileMetadata({ id: 'i', name: '灯灯.jpg', mime: 'image/jpeg', size: 12 }),
        { id: 'i', name: '灯灯.jpg', mime: 'image/jpeg', size: 12, url: '/api/uploads?id=i&download=1' }
      );
    }
    const IDS = ['a'.repeat(19), 'a'.repeat(20), 'a'.repeat(64), 'a'.repeat(65), '../../../etc/passwd', 'a/b', 'a.b', 'x', '', null, 12345, {}, [], '灯灯'.repeat(12), '../' + 'a'.repeat(20), '..'.repeat(12), '/'.repeat(24), '.'.repeat(24)];
    const f = (m, v) => { try { return JSON.stringify(m.validId(v)); } catch (e) { return JSON.stringify(['T', e.status, e.message]); } };
    assert.deepEqual(IDS.filter((v) => f(pair.old.core, v) !== f(pair.new.core, v)), [], 'validId 不一致');
  } finally {
    pair.cleanup();
  }
});

test('uploads：imageUploadId 各种形态两版一致', async () => {
  const pair = await loadPair();
  try {
    const VALUES = [
      null, undefined, 42, '', 'x', '/uploads?id=' + 'a'.repeat(20), '/api/uploads', '/api/upload?id=x',
      '/api/uploads?', '/api/uploads?id=', '/api/uploads?id=' + 'a'.repeat(20),
      '/api/uploads?id=' + 'a'.repeat(20) + '&download=1',
      '/api/uploads?id=' + 'a'.repeat(19), '/api/uploads?id=../../../etc/passwd',
      '/api/uploads?other=1&id=' + 'a'.repeat(20), '/api/uploads?ID=' + 'a'.repeat(20),
    ];
    const f = (m, v) => { try { return JSON.stringify(m.imageUploadId(v)); } catch (e) { return JSON.stringify(['T', e.status, e.message]); } };
    assert.deepEqual(VALUES.filter((v) => f(pair.old.core, v) !== f(pair.new.core, v)), [], 'imageUploadId 不一致');
    const mod = pair.new.core;
    assert.equal(mod.imageUploadId('不是链接'), null, '非 /api/uploads? 前缀返回 null');
    assert.equal(mod.imageUploadId(42), null, '非字符串返回 null');
    assert.equal(mod.imageUploadId('/api/uploads?other=1&id=' + 'a'.repeat(20)), 'a'.repeat(20), 'id 藏在别的参数后也要取得到');
    assert.throws(() => mod.imageUploadId('/api/uploads?id=' + 'a'.repeat(19)), /附件 ID 无效/, 'id 非法要抛 400');
    for (const bad of ['../' + 'a'.repeat(20), '..'.repeat(12), '/'.repeat(24), '.'.repeat(24)]) {
      assert.throws(() => mod.imageUploadId('/api/uploads?id=' + bad), /附件 ID 无效/, `imageUploadId 也必须拒 ${bad.slice(0, 12)}…`);
    }
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 4. uploadActor
// ===========================================================================

test('uploads：uploadActor 身份选择（玩家优先 / 退到管理员 / 合并会话 / 匿名）两版一致', async () => {
  const pair = await loadPair();
  try {
    const run = async (mod, DB, as) => {
      try { const a = await mod.uploadActor(makeContext({ DB }, { as })); return { kind: a.kind, id: a.user.id }; }
      catch (e) { return { t: e.status, m: e.message }; }
    };
    const CASES = ['p1', 'p2', 'super', 'wzc', 'both', 'anon'];
    const out = [];
    for (const mod of [pair.old.core, pair.new.core]) {
      const f = await seeded();
      try { out.push(await Promise.all(CASES.map((as) => run(mod, f.DB, as)))); } finally { f.close(); }
    }
    assert.deepEqual(out[1], out[0], 'uploadActor 两版不一致');
    assert.deepEqual(out[0], [
      { kind: 'player', id: 1 },   // 玩家会话
      { kind: 'player', id: 2 },
      { kind: 'admin', id: 1 },    // 只有管理员身份 → 退到 admin
      { kind: 'admin', id: 2 },
      { kind: 'player', id: 1 },   // 合并会话 → 玩家优先
      { t: 401, m: '请先登录' },    // 匿名
    ]);
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 5. ticketOwner
// ===========================================================================

test('uploads：ticketOwner 回避矩阵（tickets / m: 旧 messages / 超管 / 匿名）两版一致', async () => {
  const pair = await loadPair();
  try {
    const run = async (mod, DB, as, method, ref) => {
      try { const t = await mod.ticketOwner(makeContext({ DB }, { as, method }), ref); return { ok: true, id: t.id }; }
      catch (e) { return { t: e.status, m: e.message }; }
    };
    const CASES = [
      ['p1', 'GET', '1'], ['p1', 'POST', '1'], ['p1', 'GET', '2'], ['p1', 'POST', '2'],
      ['p1', 'GET', '3'], ['p1', 'POST', '3'], ['p1', 'GET', '4'], ['p1', 'POST', '4'],
      ['p1', 'GET', '5'], ['p1', 'POST', '5'], ['p2', 'POST', '5'], ['wzc', 'POST', '5'], ['wzc', 'GET', '5'],
      ['super', 'GET', '2'], ['super', 'POST', '2'], ['super', 'POST', '3'],
      ['wzc', 'GET', '2'], ['wzc', 'POST', '2'], ['wzc', 'GET', '1'], ['wzc', 'POST', '1'],
      ['p1', 'GET', 'm:1'], ['p1', 'POST', 'm:1'], ['super', 'POST', 'm:2'],
      ['super', 'GET', '6'], ['super', 'POST', '6'], ['wzc', 'GET', '6'], ['p2', 'GET', '6'],
      ['p1', 'GET', '999'], ['p1', 'GET', 'm:999'], ['p1', 'GET', 'abc'], ['p1', 'GET', 'm:'],
      ['anon', 'GET', '1'], ['p2', 'GET', '1'], ['p1', 'POST', '0'], ['p1', 'GET', 'm:2'],
    ];
    const out = [];
    for (const mod of [pair.old.core, pair.new.core]) {
      const f = await seeded();
      try { out.push(await Promise.all(CASES.map(([as, method, ref]) => run(mod, f.DB, as, method, ref)))); }
      finally { f.close(); }
    }
    // ── v88.8 有意的行为变更登记 ──────────────────────────────────────
    // ticketOwner 修了两处，两处都改变了对外的 (状态码, 文案)：
    //   A. 两句 fail(403) 原来和 identity() 写在同一个 try 里，catch 只按
    //      e.status 过滤（401/403 都接），于是回避校验的 403 被当成
    //      「你不是管理员」接走，再退回玩家身份报 401。现在 403 如实到前端。
    //   B. 第二句少了 `ticket.target_player_id &&` 守卫，两边都是 null 时
    //      `null === null` 为 true，于是任何没绑定玩家账号的普通管理员，
    //      处理任何没指名对象的普通工单，都会被误判成「涉及回避」。
    // 登记项必须真的命中（改动被回退要报），出现未登记的变化同样要报。
    const INTENTIONAL = {
      'wzc|GET|2': { t: 403, m: '此投诉仅限超管处理' },
      'wzc|POST|2': { t: 403, m: '被投诉人不能处理该工单' },
      'wzc|GET|1': { ok: true, id: 1 },
      'wzc|POST|1': { ok: true, id: 1 },
      'super|POST|6': { t: 403, m: '被投诉人不能处理该工单' },
      'wzc|GET|6': { t: 403, m: '此投诉仅限超管处理' },
    };
    {
      const fired = new Set();
      const unlisted = [];
      CASES.forEach((c, i) => {
        const key = c.join('|');
        const same = JSON.stringify(out[0][i]) === JSON.stringify(out[1][i]);
        if (same) return;
        if (!(key in INTENTIONAL)) {
          unlisted.push(`${key}\n    旧 ${JSON.stringify(out[0][i])}\n    新 ${JSON.stringify(out[1][i])}`);
          return;
        }
        fired.add(key);
        assert.deepEqual(out[1][i], INTENTIONAL[key], `${key} 的实际变化与登记的不一致`);
      });
      assert.deepEqual(unlisted, [], '出现未登记的行为变化：\n' + unlisted.join('\n'));
      const stale = Object.keys(INTENTIONAL).filter((k) => !fired.has(k));
      assert.deepEqual(stale, [], '这些登记项没命中 —— 改动被回退了，或登记该删：\n' + stale.join('\n'));
    }
    const at = (as, method, ref) => out[0][CASES.findIndex((c) => c[0] === as && c[1] === method && c[2] === ref)];
    // at() 读的是**基线**（旧版）。下面这几条是 v88.8 有意改过的，用 atNew 读现版。
    const atNew = (as, method, ref) => out[1][CASES.findIndex((c) => c[0] === as && c[1] === method && c[2] === ref)];
    // 防假绿：锁住回避矩阵
    assert.deepEqual(at('p1', 'GET', '1'), { ok: true, id: 1 });
    assert.deepEqual(at('p1', 'POST', '1'), { ok: true, id: 1 });
    assert.deepEqual(at('p1', 'GET', '2'), { ok: true, id: 2 }, '只读 GET 不受回避限制');
    assert.deepEqual(at('p1', 'POST', '2'), { ok: true, id: 2 }, '玩家处理自己的投诉单不受限');
    assert.deepEqual(at('p1', 'POST', '3'), { ok: true, id: 3 }, '投诉对象不是自己就没事');
    assert.deepEqual(at('p1', 'GET', '4'), { t: 404, m: '工单不存在' });
    assert.deepEqual(at('p1', 'POST', '4'), { t: 404, m: '工单不存在' }, '别人的工单对玩家报 404（不泄露存在性）');
    assert.deepEqual(at('p1', 'POST', '5'), { t: 404, m: '工单不存在' }, '别人的投诉单同样 404');
    assert.deepEqual(at('p2', 'POST', '5'), { ok: true, id: 5 }, '本人可处理自己的投诉单');
    assert.deepEqual(at('wzc', 'POST', '5'), { ok: true, id: 5 }, 'wzc 的 linked_player_id 为空，target_player_id 分支不触发');
    assert.deepEqual(at('wzc', 'GET', '5'), { ok: true, id: 5 }, 'GET 不受角色限制');
    assert.deepEqual(at('super', 'POST', '2'), { ok: true, id: 2 }, '超管可处理投诉单');
    assert.deepEqual(at('super', 'POST', '3'), { ok: true, id: 3 });
    assert.deepEqual(atNew('wzc', 'GET', '2'), { t: 403, m: '此投诉仅限超管处理' },
      'v88.8 已修：角色检查的 fail(403) 原来写在 try 里，被同一段的 catch 接住，'
      + '退到玩家身份后变成 401「需要市民账号」，403 文案到不了前端。现在如实回 403。');
    assert.deepEqual(atNew('wzc', 'POST', '2'), { t: 403, m: '被投诉人不能处理该工单' },
      'v88.8 已修：被投诉人检查的 fail(403) 同样被吞成 401，现在如实回 403。');
    assert.deepEqual(atNew('wzc', 'GET', '1'), { ok: true, id: 1 },
      'v88.8 已修：工单 1 没指名任何人、wzc 也没绑定玩家，第二句少了 `target_player_id &&` '
      + '守卫时 `null === null` 为 true，普通工单也会被误判成「涉及回避」而 401。');
    assert.deepEqual(atNew('super', 'POST', '6'), { t: 403, m: '被投诉人不能处理该工单' },
      'v88.8 已修：工单 6 指名的就是超管本人，回避规则终于能生效（原来被吞成 401）。');
    // 基线那一侧仍然要钉住旧行为，免得有人以为「两版一直一样」
    assert.deepEqual(at('wzc', 'GET', '2'), { t: 401, m: '需要市民账号' },
      '基线（06e9595）就是 401 —— 这条差异是 v88.8 有意引入的，不是本来就有的');
    assert.deepEqual(at('p1', 'GET', 'm:1'), { ok: true, id: 1 }, 'm: 前缀走 messages 表');
    assert.deepEqual(at('p1', 'POST', 'm:1'), { ok: true, id: 1 });
    assert.deepEqual(at('super', 'POST', 'm:2'), { ok: true, id: 2 }, 'm: 前缀 + 投诉人字段也要走回避');
    assert.deepEqual(at('p1', 'GET', 'm:2'), { ok: true, id: 2 }, 'm: 前缀 + 非超管本人是玩家，能过');
    // 这三条专门盯住「c.request.method !== 'GET'」那个豁免：超管本人被投诉时，
    // 去掉豁免就会 fail(403)，而 403 又被同一段的 catch 吞掉 → 退成 401。
    assert.deepEqual(at('super', 'GET', '6'), { ok: true, id: 6 }, '超管本人被投诉，GET 不受回避限制');
    assert.deepEqual(at('super', 'POST', '6'), { t: 401, m: '需要市民账号' }, '同一张单 POST 就要被拒（403 被 catch 吞成 401）');
    assert.deepEqual(at('wzc', 'GET', '6'), { t: 401, m: '需要市民账号' },
      '普通管理员即使不是被投诉人，也会被「仅限超管处理」那条拦下（403 同样被 catch 吞成 401）');
    assert.deepEqual(at('p2', 'GET', '6'), { ok: true, id: 6 }, 'p2 正是这张单的提交人，看得到');
    assert.deepEqual(at('p1', 'GET', '999'), { t: 404, m: '工单不存在' });
    assert.deepEqual(at('p1', 'GET', 'abc'), { t: 400, m: 'id 必须是 1–9007199254740991 范围内的整数' });
    assert.deepEqual(at('p1', 'POST', '0'), { t: 400, m: 'id 必须是 1–9007199254740991 范围内的整数' });
    assert.deepEqual(at('anon', 'GET', '1'), { t: 401, m: '请先登录' });
    assert.deepEqual(at('p2', 'GET', '1'), { t: 404, m: '工单不存在' });
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 6. validateFiles
// ===========================================================================

test('uploads：validateFiles 三道关（数量去重 / 归属用途状态 / 已占用 / 体积）两版一致', async () => {
  const pair = await loadPair();
  try {
    const run = async (mod, DB, ids, actor, purpose) => {
      try {
        const files = await mod.validateFiles(makeContext({ DB }, { as: 'p1' }), ids, actor, purpose);
        return { ok: files.map((f) => f.id) };
      } catch (e) { return { t: e.status, m: e.message }; }
    };
    const HALF = MAX_TICKET_BYTES / 2;
    const CASES = [
      ['ids 未定义', undefined, { kind: 'player', user: { id: 1 } }],
      ['空数组', [], { kind: 'player', user: { id: 1 } }],
      ['不是数组', 'notarray', { kind: 'player', user: { id: 1 } }],
      ['对象', { a: 1 }, { kind: 'player', user: { id: 1 } }],
      ['数字', 5, { kind: 'player', user: { id: 1 } }],
      ['一个正常', [UUID(1)], { kind: 'player', user: { id: 1 } }],
      ['重复 id', [UUID(1), UUID(1)], { kind: 'player', user: { id: 1 } }],
      ['六个不同', [1, 2, 3, 4, 5, 6].map(UUID), { kind: 'player', user: { id: 1 } }],
      ['五个不同', [1, 2, 10, 11, 12].map(UUID), { kind: 'player', user: { id: 1 } }],
      ['id 太短', ['x'], { kind: 'player', user: { id: 1 } }],
      ['id 穿越', ['../../../etc/passwd'], { kind: 'player', user: { id: 1 } }],
      ['id 非字符串', [123], { kind: 'player', user: { id: 1 } }],
      ['不存在', [UUID(99)], { kind: 'player', user: { id: 1 } }],
      ['别人的', [UUID(1)], { kind: 'player', user: { id: 2 } }],
      ['管理员列拿玩家附件', [UUID(1)], { kind: 'admin', user: { id: 1 } }],
      ['玩家列拿管理员附件', [UUID(7)], { kind: 'player', user: { id: 2 } }],
      ['用途不符', [UUID(3)], { kind: 'player', user: { id: 1 } }],
      ['用途相符', [UUID(3)], { kind: 'player', user: { id: 1 } }, 'public-image'],
      ['已挂工单', [UUID(9)], { kind: 'player', user: { id: 1 } }],
      ['public-image 但已挂工单', [UUID(13)], { kind: 'player', user: { id: 1 } }, 'public-image'],
      ['体积超限', [UUID(4), UUID(5)], { kind: 'player', user: { id: 1 } }],
      ['体积正好卡线', [UUID(4), UUID(6)], { kind: 'player', user: { id: 1 } }],
      ['上传中', [UUID(8)], { kind: 'player', user: { id: 1 } }],
      ['第二个就非法', [UUID(1), 'x'], { kind: 'player', user: { id: 1 } }],
    ];
    const out = [];
    for (const mod of [pair.old.core, pair.new.core]) {
      const f = await seeded();
      try {
        for (const i of [1, 2, 3, 4, 5, 6, 10, 11, 12, 13]) await seedReadyUpload(f.DB, { id: UUID(i), size: 1024 });
        await seedReadyUpload(f.DB, { id: UUID(9), size: 1024 });
        await seedReadyUpload(f.DB, { id: UUID(7), size: 1024, owner: 2, kind: 'admin' });
        await f.DB.prepare("INSERT INTO media_uploads(id,owner_player_id,name,mime,size,chunk_count,purpose,status) VALUES(?,1,'x.jpg','image/jpeg',1024,1,'ticket','uploading')").bind(UUID(8)).run();
        // 体积：4=half 5=half+1（两个相加超线）6=half（卡线）
        await f.DB.prepare('UPDATE media_uploads SET size=? WHERE id=?').bind(HALF, UUID(4)).run();
        await f.DB.prepare('UPDATE media_uploads SET size=? WHERE id=?').bind(HALF + 1, UUID(5)).run();
        await f.DB.prepare('UPDATE media_uploads SET size=? WHERE id=?').bind(HALF, UUID(6)).run();
        // 用途 / 已挂工单
        await f.DB.prepare("UPDATE media_uploads SET purpose='public-image' WHERE id=?").bind(UUID(3)).run();
        // 已挂工单的那条必须 purpose='ticket' 且 status='ready'，否则 SQLite 的
        // valid_ticket_attachment TRIGGER 会直接 abort
        await f.DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(UUID(9), '1').run();
        // 先以 ticket 用途挂上（过得了 TRIGGER），再把 purpose 改成 public-image ——
        // 这样才有「public-image 但已被工单占用」这个真实可达的状态
        await f.DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(UUID(13), '2').run();
        await f.DB.prepare("UPDATE media_uploads SET purpose='public-image' WHERE id=?").bind(UUID(13)).run();
        out.push(await Promise.all(CASES.map(([, ids, actor, purpose]) => run(mod, f.DB, ids, actor, purpose))));
      } finally { f.close(); }
    }
    assert.deepEqual(out[1], out[0], 'validateFiles 两版不一致');
    const at = (n) => out[0][CASES.findIndex((c) => c[0] === n)];
    // 防假绿
    assert.deepEqual(at('ids 未定义'), { ok: [] }, 'ids 为 undefined 返回空数组');
    assert.deepEqual(at('空数组'), { ok: [] });
    assert.deepEqual(at('不是数组'), { t: 400, m: `每个工单最多 ${MAX_ATTACHMENTS} 个不同附件` });
    assert.deepEqual(at('数字'), { t: 400, m: `每个工单最多 ${MAX_ATTACHMENTS} 个不同附件` });
    assert.deepEqual(at('六个不同'), { t: 400, m: `每个工单最多 ${MAX_ATTACHMENTS} 个不同附件` }, '6 个必须拒');
    assert.deepEqual(at('重复 id'), { t: 400, m: `每个工单最多 ${MAX_ATTACHMENTS} 个不同附件` }, '去重检查必须在');
    assert.deepEqual(at('五个不同'), { ok: [1, 2, 10, 11, 12].map(UUID) }, '5 个必须放行');
    assert.deepEqual(at('一个正常'), { ok: [UUID(1)] });
    assert.deepEqual(at('id 太短'), { t: 400, m: '附件 ID 无效' });
    assert.deepEqual(at('id 穿越'), { t: 400, m: '附件 ID 无效' }, '路径穿越必须在查库前就拒');
    assert.deepEqual(at('id 非字符串'), { t: 400, m: '附件 ID 无效' });
    assert.deepEqual(at('不存在'), { t: 400, m: '附件尚未上传完成或不属于当前账号' });
    assert.deepEqual(at('别人的'), { t: 400, m: '附件尚未上传完成或不属于当前账号' });
    assert.deepEqual(at('管理员列拿玩家附件'), { t: 400, m: '附件尚未上传完成或不属于当前账号' }, 'owner 列必须对应');
    assert.deepEqual(at('玩家列拿管理员附件'), { t: 400, m: '附件尚未上传完成或不属于当前账号' });
    assert.deepEqual(at('用途不符'), { t: 400, m: '附件尚未上传完成或不属于当前账号' });
    assert.deepEqual(at('用途相符'), { ok: [UUID(3)] });
    assert.deepEqual(at('已挂工单'), { t: 409, m: '附件已关联其他工单，请重新选择文件' });
    assert.deepEqual(at('public-image 但已挂工单'), { ok: [UUID(13)] }, 'purpose≠ticket 时跳过「已被占用」检查');
    assert.deepEqual(at('体积超限'), { t: 413, m: '每个工单的附件合计不能超过 200 MB' });
    assert.deepEqual(at('体积正好卡线'), { ok: [UUID(4), UUID(6)] }, '正好 200MB 允许');
    assert.deepEqual(at('上传中'), { t: 400, m: '附件尚未上传完成或不属于当前账号' }, "status='uploading' 必须拒");
    assert.deepEqual(at('第二个就非法'), { t: 400, m: '附件 ID 无效' });
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 7. validatePublicImage / ticketFiles
// ===========================================================================

test('uploads：validatePublicImage（未发布图只有 owner 能用）两版一致', async () => {
  const pair = await loadPair();
  try {
    const run = async (mod, DB, value, admin) => {
      try { return { ok: await mod.validatePublicImage(makeContext({ DB }, { as: 'p1' }), value, admin) }; }
      catch (e) { return { t: e.status, m: e.message }; }
    };
    const url = (id) => `/api/uploads?id=${id}&download=1`;
    const CASES = [
      ['不是上传链接', 'hello', { kind: 'admin', id: 1 }],
      ['不存在', url(UUID(9)), { kind: 'admin', id: 1 }],
      ['未就绪', url(UUID(8)), { kind: 'admin', id: 1 }],
      ['用途不是公开图', url(UUID(1)), { kind: 'admin', id: 1 }],
      ['mime 不是图片', url(UUID(7)), { kind: 'admin', id: 1 }],
      ['已发布', url(UUID(2)), { kind: 'admin', id: 1 }],
      ['已发布但用途是 ticket', url(UUID(3)), { kind: 'admin', id: 1 }],
      ['未发布+超管本人', url(UUID(4)), { kind: 'admin', id: 1 }],
      ['未发布+酒店本人', url(UUID(5)), { kind: 'hotel_owner', id: 1 }],
      ['未发布+别的超管', url(UUID(4)), { kind: 'admin', id: 2 }],
      ['未发布+别的酒店', url(UUID(5)), { kind: 'hotel_owner', id: 9 }],
      ['非 hotel_owner 身份查未发布图', url(UUID(4)), { kind: 'player', id: 1 }],
      ['id 参数非法', '/api/uploads?id=short', { kind: 'admin', id: 1 }],
      ['id 穿越', '/api/uploads?id=../../etc/passwd', { kind: 'admin', id: 1 }],
    ];
    const out = [];
    for (const mod of [pair.old.core, pair.new.core]) {
      const f = await seeded();
      try {
        for (const [id, purpose, publicAccess, owner, kind, mime, status] of [
          [UUID(1), 'ticket', 0, 1, 'player', 'image/jpeg', 'ready'],
          [UUID(2), 'public-image', 1, 1, 'player', 'image/jpeg', 'ready'],
          [UUID(3), 'ticket', 1, 1, 'player', 'image/jpeg', 'ready'],
          [UUID(4), 'public-image', 0, 1, 'admin', 'image/jpeg', 'ready'],
          [UUID(5), 'public-image', 0, 1, 'hotel', 'image/jpeg', 'ready'],
          [UUID(7), 'public-image', 1, 1, 'player', 'video/mp4', 'ready'],
          [UUID(8), 'public-image', 1, 1, 'player', 'image/png', 'uploading'],
        ]) {
          const col = { player: 'owner_player_id', admin: 'owner_admin_id', hotel: 'owner_hotel_id' }[kind];
          await f.DB.prepare(
            `INSERT INTO media_uploads(id,${col},name,mime,size,chunk_count,purpose,status,public_access) VALUES(?,?,'x',?,1,1,?,?,?)`
          ).bind(id, owner, mime, purpose, status, publicAccess).run();
        }
        out.push(await Promise.all(CASES.map(([, v, a]) => run(mod, f.DB, v, a))));
      } finally { f.close(); }
    }
    assert.deepEqual(out[1], out[0], 'validatePublicImage 两版不一致');
    const at = (n) => out[0][CASES.findIndex((c) => c[0] === n)];
    assert.deepEqual(at('不是上传链接'), { ok: null });
    assert.deepEqual(at('不存在'), { t: 400, m: '图片尚未上传完成' });
    assert.deepEqual(at('未就绪'), { t: 400, m: '图片尚未上传完成' });
    assert.deepEqual(at('用途不是公开图'), { t: 400, m: '图片尚未上传完成' });
    assert.deepEqual(at('mime 不是图片'), { t: 400, m: '图片尚未上传完成' }, '公开图必须 image/*');
    assert.deepEqual(at('已发布'), { ok: UUID(2) });
    assert.deepEqual(at('已发布但用途是 ticket'), { t: 400, m: '图片尚未上传完成' }, 'public_access 不绕过用途检查');
    assert.deepEqual(at('未发布+超管本人'), { ok: UUID(4) });
    assert.deepEqual(at('未发布+酒店本人'), { ok: UUID(5) });
    assert.deepEqual(at('未发布+别的超管'), { t: 403, m: '不能使用其他人的未发布图片' });
    assert.deepEqual(at('未发布+别的酒店'), { t: 403, m: '不能使用其他人的未发布图片' });
    assert.deepEqual(at('非 hotel_owner 身份查未发布图'), { ok: UUID(4) }, '非 hotel_owner 一律比对 owner_admin_id，不看 player_id');
    assert.deepEqual(at('id 参数非法'), { t: 400, m: '附件 ID 无效' });
    assert.deepEqual(at('id 穿越'), { t: 400, m: '附件 ID 无效' });
  } finally {
    pair.cleanup();
  }
});

test('uploads：ticketFiles 只回 ready 的附件两版一致', async () => {
  const pair = await loadPair();
  try {
    const out = [];
    for (const mod of [pair.old.core, pair.new.core]) {
      const f = await seeded();
      try {
        // created_at 显式写死，避免两次执行跨秒导致 ORDER BY 抖动
        const at = (n) => `2026-01-0${n} 00:00:00`;
        for (const [i, ref] of [[1, '1'], [2, '1'], [3, '2'], [4, '1']]) {
          const id = UUID(i);
          await seedReadyUpload(f.DB, { id, size: 10, createdAt: at(i) });
          await f.DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(id, ref).run();
        }
        await f.DB.prepare("UPDATE media_uploads SET status='uploading' WHERE id=?").bind(UUID(2)).run();
        await f.DB.prepare("UPDATE media_uploads SET status='uploading' WHERE id=?").bind(UUID(4)).run();
        out.push((await mod.ticketFiles(f.DB, '1')).map((x) => ({ id: x.id, size: x.size, url: x.url })));
        out.push((await mod.ticketFiles(f.DB, '2')).map((x) => x.id));
        out.push((await mod.ticketFiles(f.DB, '999')).map((x) => x.id));
        out.push((await mod.ticketFiles(f.DB, 1)).map((x) => x.id));
      } finally { f.close(); }
    }
    assert.deepEqual(out.slice(4), out.slice(0, 4), 'ticketFiles 两版不一致');
    assert.deepEqual(out[0], [{ id: UUID(1), size: 10, url: `/api/uploads?id=${UUID(1)}&download=1` }], '只回 ready 的');
    assert.deepEqual(out[1], [UUID(3)], '另一张工单有自己的 ready 附件');
    assert.deepEqual(out[2], [], '不存在的工单返回空');
    assert.deepEqual(out[3], [UUID(1)], '数字 ref 要被 String() 归一');
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 8. POST 建草稿
// ===========================================================================

test('uploads：POST 建草稿（mime / 体积上下界 / 文件名清洗 / 用途 / 身份）两版一致', async () => {
  const pair = await loadPair();
  try {
    const jpg = (extra = {}) => ({ name: 'a.jpg', mime: 'image/jpeg', size: 1024, ...extra });
    const steps = [
      { label: '正常建草稿', method: 'POST', as: 'p1', body: jpg() },
      { label: '文件名清洗', method: 'POST', as: 'p1', body: jpg({ name: '../a\\b c.jpg' }) },
      { label: '文件名 180 边界', method: 'POST', as: 'p1', body: jpg({ name: 'a'.repeat(176) + '.jpg' }) },
      { label: '文件名 181', method: 'POST', as: 'p1', body: jpg({ name: 'a'.repeat(177) + '.jpg' }) },
      { label: '文件名 控制符', method: 'POST', as: 'p1', body: jpg({ name: ' .jpg' }) },
      { label: '文件名 全空白', method: 'POST', as: 'p1', body: jpg({ name: '   ' }) },
      { label: '文件名 全是路径符', method: 'POST', as: 'p1', body: jpg({ name: '////' }) },
      { label: 'mime 100（长度合法但类型不支持）', method: 'POST', as: 'p1', body: jpg({ mime: 'a'.repeat(100) }) },
      { label: 'mime 101', method: 'POST', as: 'p1', body: jpg({ mime: 'a'.repeat(101) }) },
      { label: 'mime 非字符串', method: 'POST', as: 'p1', body: jpg({ mime: 5 }) },
      { label: '体积 0', method: 'POST', as: 'p1', body: jpg({ size: 0 }) },
      { label: '体积 -1', method: 'POST', as: 'p1', body: jpg({ size: -1 }) },
      { label: '体积小数', method: 'POST', as: 'p1', body: jpg({ size: 1.5 }) },
      { label: '体积 数字字符串', method: 'POST', as: 'p1', body: jpg({ size: '1024' }) },
      { label: '体积 脏字符串', method: 'POST', as: 'p1', body: jpg({ size: '1024abc' }) },
      { label: '体积 null', method: 'POST', as: 'p1', body: jpg({ size: null }) },
      { label: `图片上限 ${IMAGE_LIMIT}`, method: 'POST', as: 'p1', body: jpg({ size: IMAGE_LIMIT }) },
      { label: '图片上限+1', method: 'POST', as: 'p1', body: jpg({ size: IMAGE_LIMIT + 1 }) },
      { label: `视频上限 ${VIDEO_LIMIT}`, method: 'POST', as: 'p1', body: jpg({ mime: 'video/mp4', size: VIDEO_LIMIT }) },
      { label: '视频上限+1', method: 'POST', as: 'p1', body: jpg({ mime: 'video/mp4', size: VIDEO_LIMIT + 1 }) },
      { label: '不支持的 mime', method: 'POST', as: 'p1', body: jpg({ mime: 'application/pdf' }) },
      { label: '大小写 mime', method: 'POST', as: 'p1', body: jpg({ mime: 'IMAGE/JPEG' }) },
      { label: '缺 name', method: 'POST', as: 'p1', body: { mime: 'image/jpeg', size: 1024 } },
      { label: '缺 mime', method: 'POST', as: 'p1', body: { name: 'a.jpg', size: 1024 } },
      { label: '缺 size', method: 'POST', as: 'p1', body: { name: 'a.jpg', mime: 'image/jpeg' } },
      { label: '空 body', method: 'POST', as: 'p1', body: {} },
      { label: '非法 JSON', method: 'POST', as: 'p1', body: '{oops' },
      { label: 'body 是数组', method: 'POST', as: 'p1', body: [1, 2] },
      { label: 'body 是 null', method: 'POST', as: 'p1', body: 'null' },
      { label: '用途无效', method: 'POST', as: 'p1', body: jpg({ purpose: 'avatar' }) },
      { label: '用途空串', method: 'POST', as: 'p1', body: jpg({ purpose: '' }) },
      { label: '用途显式 ticket', method: 'POST', as: 'p1', body: jpg({ purpose: 'ticket' }) },
      { label: '匿名建草稿', method: 'POST', as: 'anon', body: jpg() },
      { label: '管理员建草稿', method: 'POST', as: 'wzc', body: jpg() },
      { label: '超管建草稿', method: 'POST', as: 'super', body: jpg() },
      { label: '合并会话建草稿', method: 'POST', as: 'both', body: jpg() },
      { label: '公开图+超管', method: 'POST', as: 'super', body: jpg({ purpose: 'public-image' }) },
      { label: '公开图+普通管理员', method: 'POST', as: 'wzc', body: jpg({ purpose: 'public-image' }) },
      { label: '公开图+酒店经营', method: 'POST', as: 'howner', body: jpg({ purpose: 'public-image' }) },
      { label: '公开图+纯玩家', method: 'POST', as: 'p1', body: jpg({ purpose: 'public-image' }) },
      { label: '公开图+视频 mime', method: 'POST', as: 'super', body: jpg({ purpose: 'public-image', mime: 'video/mp4' }) },
      { label: '公开图+酒店+视频', method: 'POST', as: 'howner', body: jpg({ purpose: 'public-image', mime: 'video/mp4' }) },
    ];
    const a = await differential(pair, { steps });
    const at = byLabel(a.steps);
    // 防假绿
    assert.equal(at('正常建草稿').status, 201, '建草稿必须 201');
    assert.deepEqual(at('正常建草稿').json, { ok: true, id: G(1), chunk_size: CHUNK_SIZE, chunk_count: 1 });
    assert.equal(at('文件名 180 边界').status, 201, '180 字符必须放行');
    assert.equal(at('文件名 181').json.error, '文件名 需填写且不超过 180 字符');
    assert.equal(at('文件名 全空白').json.error, '文件名 需填写且不超过 180 字符', 'trim 后为空必须拒');
    assert.equal(at('mime 100（长度合法但类型不支持）').json.error, '请选择支持的图片或视频');
    assert.equal(at('mime 101').json.error, '文件类型 需填写且不超过 100 字符');
    assert.equal(at('mime 非字符串').json.error, '文件类型 必须是文字');
    assert.equal(at('体积 0').json.error, '文件大小 必须是 1–20971520 范围内的整数');
    assert.equal(at('体积 -1').json.error, '文件大小 必须是 1–20971520 范围内的整数');
    assert.equal(at('体积小数').json.error, '文件大小 必须是 1–20971520 范围内的整数');
    assert.equal(at('体积 数字字符串').status, 201, "Number('1024') 是合法整数");
    assert.equal(at('体积 脏字符串').json.error, '文件大小 必须是 1–20971520 范围内的整数', '不能像 parseInt 那样放行 1024abc');
    assert.equal(at('体积 null').json.error, '文件大小 必须是 1–20971520 范围内的整数');
    assert.equal(at(`图片上限 ${IMAGE_LIMIT}`).status, 201, '图片上限本身必须放行');
    assert.equal(at('图片上限+1').json.error, `文件大小 必须是 1–${IMAGE_LIMIT} 范围内的整数`);
    assert.equal(at(`视频上限 ${VIDEO_LIMIT}`).status, 201, '视频上限本身必须放行');
    assert.equal(at('视频上限+1').json.error, `文件大小 必须是 1–${VIDEO_LIMIT} 范围内的整数`);
    assert.equal(at('不支持的 mime').json.error, '请选择支持的图片或视频');
    assert.equal(at('大小写 mime').json.error, '请选择支持的图片或视频', 'MEDIA_TYPES 大小写敏感');
    assert.equal(at('缺 name').json.error, '文件名 必须是文字');
    assert.equal(at('缺 mime').json.error, '文件类型 必须是文字');
    assert.equal(at('缺 size').json.error, '文件大小 必须是 1–20971520 范围内的整数');
    assert.equal(at('空 body').json.error, '文件类型 必须是文字');
    assert.equal(at('非法 JSON').json.error, '请求不是有效 JSON');
    assert.equal(at('body 是数组').json.error, '请求必须是 JSON 对象');
    assert.equal(at('body 是 null').json.error, '请求必须是 JSON 对象');
    assert.equal(at('用途无效').json.error, '上传用途无效');
    assert.equal(at('用途空串').status, 201, "空串走 input.purpose || 'ticket'");
    assert.equal(at('匿名建草稿').json.error, '请先登录');
    assert.equal(at('公开图+普通管理员').json.error, '没有酒店经营权限', '超管失败后要退到酒店经营');
    assert.equal(at('公开图+纯玩家').json.error, '没有酒店经营权限');
    assert.equal(at('公开图+超管').status, 201);
    assert.equal(at('公开图+酒店经营').status, 201);
    assert.equal(at('公开图+视频 mime').json.error, '请选择支持的图片或视频', '公开图只收 image/*');
    assert.equal(at('公开图+酒店+视频').json.error, '请选择支持的图片或视频');

    // 落库：owner 列 / name 清洗 / chunk_count 逐项核对
    const rows = a.db.media_uploads;
    const ids = rows.map((r) => r.id).sort();
    assert.deepEqual(ids, Array.from({ length: 15 }, (_, i) => G(i + 1)),
      '15 条创建成功（数字字符串体积 / 上下限边界 / 空串用途 / 显式 ticket / 清洗后非空的文件名都算数）');

    assert.equal(rows.find((r) => r.name === '___.jpg')?.id, G(4), '\x00 / \x01 / \x7f 三个控制符全被换成 _，DEL 也要换');
    assert.equal(rows.find((r) => r.name === '____')?.id, G(5), '四个路径分隔符全被换成 _，清洗后非空所以能建草稿');
    assert.equal(rows.find((r) => r.name === '.._a_b__c.jpg')?.id, G(2), '../ 与 \\ 都被替换，控制符保留在 _ 的位置上');
    assert.equal(rows.find((r) => r.size === IMAGE_LIMIT)?.chunk_count, 80, `${IMAGE_LIMIT} 应是 80 块`);
    assert.equal(rows.find((r) => r.size === VIDEO_LIMIT)?.chunk_count, 400, `${VIDEO_LIMIT} 应是 400 块`);
    assert.equal(rows.filter((r) => r.owner_admin_id === 2).length, 1, '管理员草稿记在 owner_admin_id=2');
    assert.equal(rows.filter((r) => r.owner_admin_id === 1).length, 2, '超管建的 2 条记在 owner_admin_id=1');
    assert.equal(rows.filter((r) => r.owner_hotel_id === 1).length, 1, '酒店经营草稿记在 owner_hotel_id');
    assert.equal(rows.filter((r) => r.owner_player_id === 1).length, 11, '11 条玩家草稿记在 owner_player_id（含合并会话按玩家建的那条）');
    assert.ok(rows.every((r) => r.status === 'uploading' && r.public_access === 0));
    assert.equal(rows.filter((r) => r.purpose === 'public-image').length, 2, '只有超管与酒店经营那两条是公开图');
    assert.equal(a.db.media_chunks.length, 0, '建草稿阶段不写任何分块');
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 9. 过期草稿回收 + 存储配额
// ===========================================================================

test('uploads：POST 顺带回收过期草稿（未挂工单且非公开才清）两版一致', async () => {
  const pair = await loadPair();
  try {
    const a = await differential(pair, {
      seed: async (DB) => {
        // 挂工单的两条必须 status='ready'（valid_ticket_attachment TRIGGER 的要求）
        const ins = (id, created_at, public_access, ref) =>
          DB.prepare("INSERT INTO media_uploads(id,owner_player_id,name,mime,size,chunk_count,purpose,status,public_access,created_at) VALUES(?,1,'x.jpg','image/jpeg',10,1,'ticket',?,?,?)")
            .bind(id, ref ? 'ready' : 'uploading', public_access, created_at).run()
            .then(() => DB.prepare('INSERT INTO media_chunks(upload_id,part,data,byte_size) VALUES(?,0,?,2)').bind(id, B64([1, 2])).run())
            .then(() => (ref ? DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(id, ref).run() : null));
        await ins(UUID(1), '2000-01-01 00:00:00', 0, null);  // 该清
        await ins(UUID(2), '2000-01-01 00:00:00', 0, '1');   // 挂了工单 → 保留
        await ins(UUID(3), '2000-01-01 00:00:00', 1, null);  // 公开 → 保留
        await ins(UUID(4), '2099-01-01 00:00:00', 0, null);  // 未过期 → 保留
        await ins(UUID(5), '2000-01-01 00:00:00', 0, '1');   // 过期但挂了工单 → 保留
      },
      steps: [{ method: 'POST', as: 'p1', body: { name: 'n.jpg', mime: 'image/jpeg', size: 100 } }],
      // 快照里 created_at 被归一了，用 probe 把真实值再精确核一遍
      probe: async (DB) => (await DB.prepare('SELECT id,created_at FROM media_uploads ORDER BY id').all()).results
        .map((r) => [r.id, r.created_at === '2000-01-01 00:00:00' ? '老' : r.created_at === '2099-01-01 00:00:00' ? '未来' : '刚建']),
    });
    assert.equal(a.steps[0].status, 201, '建草稿本身必须成功');
    assert.deepEqual(a.db.media_uploads.map((r) => r.id), [UUID(2), UUID(3), UUID(4), UUID(5), G(1)],
      '只有「过期 + 非公开 + 未挂工单」的 UUID(1) 该被删，新草稿是 G(1)');
    assert.deepEqual(a.db.media_chunks.map((r) => r.upload_id), [UUID(2), UUID(3), UUID(4), UUID(5)],
      '分块必须跟着主记录一起清（UUID(1) 那行也得没），且新草稿此时还没有分块');
    assert.deepEqual(a.db.ticket_attachments.map((r) => r.upload_id), [UUID(2), UUID(5)], 'ticket_attachments 不被回收波及');
    // 精确核：种子时间戳逐字保留，新草稿是「刚建的」
    assert.deepEqual(a.probe, [
      [UUID(2), '老'], [UUID(3), '老'], [UUID(4), '未来'], [UUID(5), '老'], [G(1), '刚建'],
    ], '过期的老行保留原时间戳，新草稿用当前时间');
    // 跨秒会假红，所以再单独确认一次「刚建」那行的 created_at 真的是当前时间
    const fresh = (await differential(pair, {
      seed: async (DB) => {
        await DB.prepare("INSERT INTO media_uploads(id,owner_player_id,name,mime,size,chunk_count,purpose,status,public_access,created_at) VALUES(?,1,'x.jpg','image/jpeg',10,1,'ticket','uploading',0,'2000-01-01 00:00:00')").bind(UUID(1)).run();
      },
      steps: [{ method: 'POST', as: 'p1', body: { name: 'n.jpg', mime: 'image/jpeg', size: 100 } }],
      probe: async (DB) => (await DB.prepare("SELECT COUNT(*) AS n FROM media_uploads WHERE created_at > datetime('now','-1 hour')").first()),
    })).probe;
    assert.equal(fresh.n, 1, '新草稿的 created_at 必须是当前时间（SQLite 侧 datetime(now)）');
  } finally {
    pair.cleanup();
  }
});

test('uploads：未提交存储配额（250MB）按 owner 隔离，两版一致', async () => {
  const pair = await loadPair();
  try {
    const a = await differential(pair, {
      seed: async (DB) => {
        const ins = (id, owner, size, status = 'uploading') =>
          DB.prepare("INSERT INTO media_uploads(id,owner_player_id,name,mime,size,chunk_count,purpose,status,public_access,created_at) VALUES(?,?,'x.jpg','image/jpeg',?,1,'ticket',?,0,'2099-01-01 00:00:00')")
            .bind(id, owner, size, status).run();
        await ins(UUID(1), 1, 240 * 1024 * 1024); // 玩家 1 占了 240MB
        await ins(UUID(2), 2, 240 * 1024 * 1024); // 玩家 2 也占了 240MB
        await ins(UUID(3), 1, 10 * 1024 * 1024, 'ready'); // 另有 10MB，已挂工单 → 不计配额
        await DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(UUID(3), '1').run();
      },
      steps: [
        { label: '240+20 超限', method: 'POST', as: 'p1', body: { name: 'n.jpg', mime: 'image/jpeg', size: 20 * 1024 * 1024 } },
        { label: '240+10 正好', method: 'POST', as: 'p1', body: { name: 'n.jpg', mime: 'image/jpeg', size: 10 * 1024 * 1024 } },
        { label: '再来 1MB 就超了', method: 'POST', as: 'p1', body: { name: 'n.jpg', mime: 'image/jpeg', size: 1024 * 1024 } },
        { label: '另一个玩家不受牵连', method: 'POST', as: 'p2', body: { name: 'n.jpg', mime: 'image/jpeg', size: 10 * 1024 * 1024 } },
        { label: '管理员不计玩家配额', method: 'POST', as: 'wzc', body: { name: 'n.jpg', mime: 'image/jpeg', size: 20 * 1024 * 1024 } },
      ],
    });
    const at = byLabel(a.steps);
    assert.equal(at('240+20 超限').status, 413);
    assert.equal(at('240+20 超限').json.error, '未提交的附件过多，请先提交工单或移除附件');
    assert.equal(at('240+10 正好').status, 201, '正好 250MB 放行');
    assert.equal(at('再来 1MB 就超了').status, 413, '刚建的那 10MB 现在也算进配额了');
    assert.equal(at('另一个玩家不受牵连').status, 201, '配额按 owner 隔离');
    assert.equal(at('管理员不计玩家配额').status, 201, '管理员走 owner_admin_id');
    assert.equal(a.db.media_uploads.length, 6, '3 条种子 + 3 条成功');

    // 已挂工单的附件不占「未提交」配额：245MB 未挂 + 10MB 已挂，再要 5MB
    // 若那 10MB 被算进来就是 260>250 → 413；没算进来就是 250 → 201
    const b = await differential(pair, {
      seed: async (DB) => {
        const ins = (id, size, status) =>
          DB.prepare("INSERT INTO media_uploads(id,owner_player_id,name,mime,size,chunk_count,purpose,status,public_access,created_at) VALUES(?,1,'x.jpg','image/jpeg',?,1,'ticket',?,0,'2099-01-01 00:00:00')")
            .bind(id, size, status).run();
        await ins(UUID(1), 245 * 1024 * 1024, 'uploading');
        await ins(UUID(2), 10 * 1024 * 1024, 'ready');
        await DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(UUID(2), '1').run();
      },
      steps: [{ method: 'POST', as: 'p1', body: { name: 'n.jpg', mime: 'image/jpeg', size: 5 * 1024 * 1024 } }],
    });
    assert.equal(b.steps[0].status, 201, '已挂工单的附件必须被排除在未提交配额之外');
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 10. POST finish
// ===========================================================================

test('uploads：POST finish（缺块 409 / 齐块置 ready / 幂等 / 越权）两版一致', async () => {
  const pair = await loadPair();
  try {
    const a = await differential(pair, {
      seed: async (DB) => {
        // created_at 必须「未过期」，否则后面建草稿时的 GC 会把种子当过期草稿清走
        await seedReadyUpload(DB, { id: UUID(1), size: CHUNK_SIZE * 2, status: 'uploading', createdAt: '2099-01-01 00:00:00' });
        await DB.prepare('DELETE FROM media_chunks WHERE upload_id=? AND part=1').bind(UUID(1)).run();
        await seedReadyUpload(DB, { id: UUID(3), size: 1000, status: 'uploading', createdAt: '2099-01-01 00:00:00' });
        await DB.prepare('UPDATE media_chunks SET byte_size=byte_size-1 WHERE upload_id=?').bind(UUID(3)).run(); // 块数够、字节少
        const NEW = '2099-01-01 00:00:00'; // 未过期，否则建草稿时的 GC 会把种子清走
        await seedReadyUpload(DB, { id: UUID(4), size: 1000, status: 'uploading', createdAt: NEW });   // 齐了
        await seedReadyUpload(DB, { id: UUID(5), size: 1000, status: 'ready', createdAt: NEW });      // 幂等
        await seedReadyUpload(DB, { id: UUID(6), size: 1000, owner: 2, status: 'uploading', createdAt: NEW });
        await seedReadyUpload(DB, { id: UUID(7), size: 1000, owner: 2, kind: 'admin', status: 'uploading', createdAt: NEW });
        await seedReadyUpload(DB, { id: UUID(8), size: 1000, owner: 1, kind: 'hotel', status: 'uploading', createdAt: NEW });
      },
      steps: [
        { label: '缺一块 → 409', method: 'POST', as: 'p1', body: { action: 'finish', id: UUID(1) } },
        { label: '字节数对不上 → 409', method: 'POST', as: 'p1', body: { action: 'finish', id: UUID(3) } },
        { label: '齐了 → ready', method: 'POST', as: 'p1', body: { action: 'finish', id: UUID(4) } },
        { label: '再 finish 一次', method: 'POST', as: 'p1', body: { action: 'finish', id: UUID(4) } },
        { label: '本来就 ready', method: 'POST', as: 'p1', body: { action: 'finish', id: UUID(5) } },
        { label: '别人的附件', method: 'POST', as: 'p1', body: { action: 'finish', id: UUID(6) } },
        { label: '管理员的附件·玩家来', method: 'POST', as: 'p1', body: { action: 'finish', id: UUID(7) } },
        { label: '管理员的附件·本人来', method: 'POST', as: 'wzc', body: { action: 'finish', id: UUID(7) } },
        { label: '酒店经营的附件', method: 'POST', as: 'howner', body: { action: 'finish', id: UUID(8) } },
        { label: '不存在的 id', method: 'POST', as: 'p1', body: { action: 'finish', id: UUID(9) } },
        { label: 'id 非法', method: 'POST', as: 'p1', body: { action: 'finish', id: 'x' } },
        { label: 'id 穿越', method: 'POST', as: 'p1', body: { action: 'finish', id: '../../secret' } },
      { label: 'id 长穿越串', method: 'POST', as: 'p1', body: { action: 'finish', id: '../' + 'a'.repeat(20) } },
      { label: 'id 全是斜杠', method: 'POST', as: 'p1', body: { action: 'finish', id: '/'.repeat(24) } },
        { label: 'id 是数字', method: 'POST', as: 'p1', body: { action: 'finish', id: 12345 } },
        { label: '缺 id', method: 'POST', as: 'p1', body: { action: 'finish' } },
        { label: 'id 为 null', method: 'POST', as: 'p1', body: { action: 'finish', id: null } },
        { label: '匿名', method: 'POST', as: 'anon', body: { action: 'finish', id: UUID(4) } },
        { label: 'action 其它值当建草稿', method: 'POST', as: 'p1', body: { action: 'start', name: 'a.jpg', mime: 'image/jpeg', size: 100 } },
        { label: 'action 大写 Finish', method: 'POST', as: 'p1', body: { action: 'Finish', id: UUID(4), name: 'a.jpg', mime: 'image/jpeg', size: 100 } },
        { label: 'action 带空格', method: 'POST', as: 'p1', body: { action: ' finish', id: UUID(4), name: 'a.jpg', mime: 'image/jpeg', size: 100 } },
        { label: 'action 数字', method: 'POST', as: 'p1', body: { action: 0, name: 'a.jpg', mime: 'image/jpeg', size: 100 } },
        { label: 'action 其它但字段不全', method: 'POST', as: 'p1', body: { action: 'start' } },
      ],
    });
    const at = byLabel(a.steps);
    // 防假绿
    assert.equal(at('缺一块 → 409').status, 409);
    assert.equal(at('缺一块 → 409').json.error, '上传尚未完成，请重试缺失分块');
    assert.equal(at('字节数对不上 → 409').status, 409, 'SUM(byte_size) 也要参与比对');
    assert.deepEqual(at('齐了 → ready').json, { ok: true, id: UUID(4), name: 'photo.jpg', mime: 'image/jpeg', size: 1000, url: `/api/uploads?id=${UUID(4)}&download=1` });
    assert.deepEqual(at('再 finish 一次').json, at('齐了 → ready').json, '重复 finish 幂等');
    assert.equal(at('本来就 ready').json.id, UUID(5));
    assert.equal(at('别人的附件').json.error, '附件不存在');
    assert.equal(at('管理员的附件·玩家来').json.error, '需要管理员权限', '拿错身份类型查 → 401/403，不误放行');
    assert.notEqual(at('管理员的附件·玩家来').status, 200, '绝不能因为「知道 id」就放行');
    assert.equal(at('管理员的附件·本人来').status, 200);
    assert.equal(at('酒店经营的附件').status, 200);
    assert.equal(at('不存在的 id').status, 404);
    assert.equal(at('id 非法').json.error, '附件 ID 无效');
    assert.equal(at('id 穿越').json.error, '附件 ID 无效', '路径穿越必须在查库前拒');
    assert.equal(at('id 长穿越串').json.error, '附件 ID 无效');
    assert.equal(at('id 全是斜杠').json.error, '附件 ID 无效');
    assert.equal(at('id 是数字').json.error, '附件 ID 无效');
    assert.equal(at('缺 id').json.error, '附件 ID 无效');
    assert.equal(at('id 为 null').json.error, '附件 ID 无效');
    assert.equal(at('匿名').json.error, '请先登录');
    assert.equal(at('action 其它值当建草稿').status, 201, "action≠'finish' 就走建草稿");
    assert.equal(at('action 大写 Finish').status, 201, 'action 匹配大小写敏感');
    assert.equal(at('action 带空格').status, 201, '不做 trim');
    assert.equal(at('action 数字').status, 201);
    assert.equal(at('action 其它但字段不全').status, 400, '非 finish 分支仍要过完整字段校验');
    assert.equal(a.db.media_uploads.find((r) => r.id === UUID(4)).status, 'ready', 'finish 必须落库置 ready');
    assert.equal(a.db.media_uploads.find((r) => r.id === UUID(1)).status, 'uploading', '409 的不能动状态');
    assert.equal(a.db.media_uploads.find((r) => r.id === UUID(7)).status, 'ready', '本人 finish 成功');
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 11. PUT 分块
// ===========================================================================

test('uploads：PUT 分块（base64 / 解码 / 长度 / 魔数 / part 边界 / upsert）两版一致', async () => {
  const pair = await loadPair();
  try {
    const small = (n) => makeBytes('image/gif', n);
    const big = (n) => makeBytes('image/jpeg', n);
    const D = G(1); // 这一串场景里 POST 刚建出来的草稿（randomUUID 计数器从 1 开始）
    const steps = [
      { label: '建 6 字节 gif 草稿', method: 'POST', as: 'p1', body: { name: 'a.gif', mime: 'image/gif', size: 6 } },
      { label: 'part0 正常', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: B64(small(6)) } },
      { label: 'part0 重传（upsert）', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: B64(small(6)) } },
      { label: 'part0 重传不同内容', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: B64(makeBytes('image/gif', 6).map((b, i) => (i < 6 ? b : 0))) } },
      { label: 'part0 缺 data', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: {} },
      { label: 'part0 data 非字符串', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: 123 } },
      { label: 'part0 data null', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: null } },
      { label: 'part0 data 含非法字符', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: '!!!!' } },
      { label: 'part0 data 带换行', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: 'R0lG\nODlh' } },
      { label: 'part0 data base64url', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: 'R0lGODlh-w' } },
      { label: 'part0 无填充 base64', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: 'R0lGODlh' } },
      { label: 'part0 多余填充', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: 'R0lGODlh====' } },
      { label: 'part0 少 1 字节', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: B64(small(6).slice(0, 5)) } },
      { label: 'part0 多 1 字节', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: B64(small(7)) } },
      { label: 'part0 魔数不符', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: B64(big(6)) } },
      { label: 'part0 超长 base64', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: 'A'.repeat(349529) } },
      { label: 'part0 恰好 349528', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: 'A'.repeat(349528) } },
      { label: 'part=1（越界）', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=1`, body: { data: B64(small(6)) } },
      { label: 'part=-1', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=-1`, body: { data: B64(small(6)) } },
      { label: 'part=abc', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=abc`, body: { data: B64(small(6)) } },
      { label: 'part=0.5', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0.5`, body: { data: B64(small(6)) } },
      { label: 'part 缺失（=0）', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}`, body: { data: B64(small(6)) } },
      { label: 'part 空串（=0）', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=`, body: { data: B64(small(6)) } },
      { label: 'id 缺失', method: 'PUT', as: 'p1', url: '/api/uploads?part=0', body: { data: B64(small(6)) } },
      { label: 'id 穿越', method: 'PUT', as: 'p1', url: '/api/uploads?id=../../etc&part=0', body: { data: B64(small(6)) } },
      { label: 'id 长穿越串', method: 'PUT', as: 'p1', url: `/api/uploads?id=${encodeURIComponent('../' + 'a'.repeat(20))}&part=0`, body: { data: B64(small(6)) } },
      { label: 'id 全是点', method: 'PUT', as: 'p1', url: `/api/uploads?id=${'.'.repeat(24)}&part=0`, body: { data: B64(small(6)) } },
      { label: 'id 不存在', method: 'PUT', as: 'p1', url: `/api/uploads?id=${UUID(9)}&part=0`, body: { data: B64(small(6)) } },
      { label: '别人的附件', method: 'PUT', as: 'p2', url: `/api/uploads?id=${D}&part=0`, body: { data: B64(small(6)) } },
      { label: '匿名', method: 'PUT', as: 'anon', url: `/api/uploads?id=${D}&part=0`, body: { data: B64(small(6)) } },
      { label: '草稿已不存在', method: 'PUT', as: 'p1', url: `/api/uploads?id=${UUID(2)}&part=0`, body: { data: B64(small(6)) } },
      { label: '空 body', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: {} },
      { label: '非法 JSON', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: '{' },
    ];
    const a = await differential(pair, {
      seed: async (DB) => {
        await seedReadyUpload(DB, { id: UUID(2), size: 6, status: 'uploading' });
        await DB.prepare('DELETE FROM media_uploads WHERE id=?').bind(UUID(2)).run();
        await seedReadyUpload(DB, { id: UUID(3), size: 6, status: 'ready' }); // 已完成的草稿
      },
      steps,
    });
    const at = byLabel(a.steps);
    // 防假绿
    assert.equal(at('建 6 字节 gif 草稿').json.chunk_count, 1, '6 字节只占 1 块');
    assert.deepEqual(at('part0 正常').json, { ok: true, part: 0, received: 6 });
    assert.equal(at('part0 重传（upsert）').status, 200, '断点续传重传同一块必须允许');
    assert.equal(at('part0 缺 data').json.error, '分块数据无效');
    assert.equal(at('part0 data 非字符串').json.error, '分块数据无效');
    assert.equal(at('part0 data null').json.error, '分块数据无效');
    assert.equal(at('part0 data 含非法字符').json.error, '分块数据无效');
    assert.equal(at('part0 data 带换行').json.error, '分块数据无效', '正则不接受换行');
    assert.equal(at('part0 data base64url').json.error, '分块数据无效', '只收标准 base64');
    assert.equal(at('part0 无填充 base64').status, 200, '无填充的合法 base64 放行');
    assert.equal(at('part0 多余填充').json.error, '分块数据无效', '最多两个 =');
    assert.equal(at('part0 少 1 字节').json.error, '分块大小不正确');
    assert.equal(at('part0 多 1 字节').json.error, '分块大小不正确');
    assert.equal(at('part0 魔数不符').json.error, '文件内容与图片/视频类型不匹配');
    assert.equal(at('part0 超长 base64').json.error, '分块数据无效', 'maxEncodedLength 必须在');
    assert.equal(at('part0 恰好 349528').json.error, '分块大小不正确', '长度上限本身放行，过了正则后死在长度校验');
    assert.equal(at('part=1（越界）').json.error, '分块编号 必须是 0–0 范围内的整数', '上界是 chunk_count-1');
    assert.equal(at('part=-1').json.error, '分块编号 必须是 0–0 范围内的整数');
    assert.equal(at('part=abc').json.error, '分块编号 必须是 0–0 范围内的整数');
    assert.equal(at('part=0.5').json.error, '分块编号 必须是 0–0 范围内的整数');
    assert.equal(at('part 缺失（=0）').json.received, 6, "⚠ 真实行为：part 缺失 → get 返回 null → Number(null) 是 0，等于 part 0，不报错");
    assert.equal(at('part 空串（=0）').json.received, 6, "⚠ 真实行为：part= 空串经 Number('') 变成 0，是合法的 part 0，不是报错");
    assert.equal(at('id 缺失').json.error, '附件 ID 无效');
    assert.equal(at('id 穿越').json.error, '附件 ID 无效');
    assert.equal(at('id 长穿越串').json.error, '附件 ID 无效', '长度够长的穿越串也必须在查库前拒掉');
    assert.equal(at('id 全是点').json.error, '附件 ID 无效');
    assert.equal(at('id 不存在').status, 404);
    assert.equal(at('别人的附件').status, 404);
    assert.equal(at('匿名').json.error, '请先登录');
    assert.equal(at('草稿已不存在').status, 404);
    assert.equal(at('空 body').json.error, '分块数据无效');
    assert.equal(at('非法 JSON').json.error, '请求不是有效 JSON');

    // 落库：upsert 不该产生第二行；ready 的草稿不该新增分块
    const mine = a.db.media_chunks.filter((r) => r.upload_id === D);
    assert.equal(mine.length, 1, '重传是 upsert，part 0 只有一行');
    assert.equal(mine[0].byte_size, 6, 'byte_size 存解码后的长度');
    assert.equal(a.db.media_chunks.filter((r) => r.upload_id === UUID(3)).length, 0, 'ready 的草稿不该新增分块');
  } finally {
    pair.cleanup();
  }
});

test('uploads：PUT 多块上传 —— 末块余数与 part 上界两版一致', async () => {
  const pair = await loadPair();
  try {
    const SIZE = CHUNK_SIZE * 2 + 1234; // 3 块，末块 1234 字节
    const D = G(1); // POST 刚建出来的草稿
    const all = makeBytes('video/mp4', SIZE); // mime 是 video/mp4，内容也得是 mp4 头
    const seg = (p) => all.slice(p * CHUNK_SIZE, Math.min(SIZE, (p + 1) * CHUNK_SIZE));
    const steps = [
      { method: 'POST', as: 'p1', body: { name: 'v.mp4', mime: 'video/mp4', size: SIZE } },
      { label: 'part2（末块）', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=2`, body: { data: B64(seg(2)) } },
      { label: 'part3（越界）', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=3`, body: { data: B64(seg(2)) } },
      { label: 'part0', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: B64(seg(0)) } },
      { label: '末块按整块传', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=2`, body: { data: B64(seg(0)) } },
      { label: 'finish 缺 part1', method: 'POST', as: 'p1', body: { action: 'finish', id: D } },
      { label: 'part1', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=1`, body: { data: B64(seg(1)) } },
      { label: 'finish 齐了', method: 'POST', as: 'p1', body: { action: 'finish', id: D } },
      { label: '重传已完成草稿的块', method: 'PUT', as: 'p1', url: `/api/uploads?id=${D}&part=0`, body: { data: B64(seg(0)) } },
    ];
    const a = await differential(pair, { steps });
    const at = byLabel(a.steps);
    assert.equal(a.steps[0].json.chunk_count, 3, 'ceil(size/CHUNK_SIZE) = 3 块');
    assert.equal(at('part2（末块）').json.received, 1234, '末块只收余数 1234 字节');
    assert.equal(at('part3（越界）').json.error, '分块编号 必须是 0–2 范围内的整数');
    assert.equal(at('末块按整块传').json.error, '分块大小不正确');
    assert.equal(at('finish 缺 part1').status, 409, '缺块时 finish 必须 409');
    assert.equal(at('finish 缺 part1').json.error, '上传尚未完成，请重试缺失分块');
    assert.equal(at('finish 齐了').status, 200);
    assert.equal(at('重传已完成草稿的块').status, 409, "status='ready' 的草稿不能再传块");
    assert.equal(at('重传已完成草稿的块').json.error, '附件已经上传完成');
    assert.equal(a.db.media_chunks.length, 3);
    assert.deepEqual(a.db.media_chunks.map((r) => r.part).sort(), [0, 1, 2]);
    assert.equal(a.db.media_uploads.find((r) => r.id === D).status, 'ready');
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 12. GET 元信息
// ===========================================================================

test('uploads：GET 元信息（归属 / 匿名 / 已挂工单 / 公开 / 未就绪下载）两版一致', async () => {
  const pair = await loadPair();
  try {
    const a = await differential(pair, {
      seed: async (DB) => {
        await seedReadyUpload(DB, { id: UUID(1), size: CHUNK_SIZE * 3, status: 'uploading' }); // 缺 part1
        await DB.prepare('DELETE FROM media_chunks WHERE upload_id=? AND part=1').bind(UUID(1)).run();
        await seedReadyUpload(DB, { id: UUID(2), size: CHUNK_SIZE * 2, name: '我的 灯灯.jpg' });
        await seedReadyUpload(DB, { id: UUID(3), size: 100, owner: 2 });       // 别人的
        await seedReadyUpload(DB, { id: UUID(4), size: 100, publicAccess: 1 }); // 公开
        // 5: 挂我自己的工单 1（无投诉对象）
        await seedReadyUpload(DB, { id: UUID(5), size: 100, owner: 2 });
        await DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(UUID(5), '1').run();
        // 6: 挂别人的工单 4
        await seedReadyUpload(DB, { id: UUID(6), size: 100, owner: 2 });
        await DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(UUID(6), '4').run();
        // 7: 挂有投诉对象的工单 2，被投诉人 wzc 来看
        await seedReadyUpload(DB, { id: UUID(7), size: 100, owner: 2 });
        await DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(UUID(7), '2').run();
        await seedReadyUpload(DB, { id: UUID(8), size: 100, owner: 2, kind: 'admin' });
        await seedReadyUpload(DB, { id: UUID(9), size: 100, owner: 1, kind: 'hotel' });
      },
      steps: [
        { label: '自己的·分块中', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(1)}` },
        { label: '自己的·ready', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(2)}` },
        { label: '别人的', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(3)}` },
        { label: '公开的·匿名', method: 'GET', as: 'anon', url: `/api/uploads?id=${UUID(4)}` },
        { label: '公开的·别人', method: 'GET', as: 'p2', url: `/api/uploads?id=${UUID(4)}` },
        { label: '挂我工单·本人', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(5)}` },
        { label: '挂我工单·匿名', method: 'GET', as: 'anon', url: `/api/uploads?id=${UUID(5)}` },
        { label: '挂别人工单·我', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(6)}` },
        { label: '挂别人工单·本人', method: 'GET', as: 'p2', url: `/api/uploads?id=${UUID(6)}` },
        { label: '挂别人工单·匿名', method: 'GET', as: 'anon', url: `/api/uploads?id=${UUID(6)}` },
        { label: '挂别人工单·超管', method: 'GET', as: 'super', url: `/api/uploads?id=${UUID(6)}` },
        { label: '挂投诉单·被投诉人看', method: 'GET', as: 'wzc', url: `/api/uploads?id=${UUID(7)}` },
        { label: '挂投诉单·超管看', method: 'GET', as: 'super', url: `/api/uploads?id=${UUID(7)}` },
        { label: '挂投诉单·提交人看', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(7)}` },
        { label: '管理员的', method: 'GET', as: 'wzc', url: `/api/uploads?id=${UUID(8)}` },
        { label: '管理员的·玩家访问', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(8)}` },
        { label: '酒店经营的', method: 'GET', as: 'howner', url: `/api/uploads?id=${UUID(9)}` },
        { label: 'id 非法', method: 'GET', as: 'p1', url: '/api/uploads?id=xx' },
        { label: 'id 穿越', method: 'GET', as: 'p1', url: '/api/uploads?id=../../etc/passwd' },
        { label: 'id 不存在', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(10)}` },
        { label: '无 id', method: 'GET', as: 'p1', url: '/api/uploads' },
        { label: 'download=0', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(2)}&download=0` },
        { label: 'download=yes', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(2)}&download=yes` },
        { label: '未就绪就下载', method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(1)}&download=1` },
      ],
      // v88.8 有意的行为变更：ticketOwner 的回避校验 403 不再被自己的 catch 吞掉。
      // 旧行为里 wzc 走到 ticketOwner 后，fail(403) 被接走、退回玩家身份，
      // 于是一个附件请求得到的是 401「需要市民账号」—— 回避规则真正想说的话
      // 一句都没传达出去。现在它如实回 403「此投诉仅限超管处理」。
      intentional: [
        {
          label: '挂投诉单·被投诉人看',
          to: {
            label: '挂投诉单·被投诉人看',
            status: 403,
            headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
            json: { ok: false, error: '此投诉仅限超管处理' },
          },
          reason: 'ticketOwner 的 403 现在能到前端了（原来被吞成 401）',
        },
      ],
    });
    const at = byLabel(a.steps);
    // atNew 读的是**现版**。本用例里只有「挂投诉单·被投诉人看」这一条是有意改过的，
    // 其余全部用 at 锁住两版共有的行为。
    const atNew = byLabel(a.new.steps);
    // 防假绿
    assert.deepEqual(at('自己的·分块中').json, {
      ok: true, id: UUID(1), name: 'photo.jpg', mime: 'image/jpeg', size: CHUNK_SIZE * 3,
      url: `/api/uploads?id=${UUID(1)}&download=1`, status: 'uploading', parts: [0, 2], chunk_count: 3, chunk_size: CHUNK_SIZE,
    }, 'parts 只列实际存在的块');
    assert.deepEqual(at('自己的·ready').json.parts, [0, 1]);
    assert.equal(at('自己的·ready').json.status, 'ready');
    assert.equal(at('别人的').json.error, '附件不存在');
    assert.equal(at('公开的·匿名').status, 200, 'public_access 谁都能看');
    assert.equal(at('公开的·别人').status, 200);
    assert.equal(at('挂我工单·本人').status, 200, '已挂工单的走工单可见性放行');
    assert.equal(at('挂我工单·匿名').status, 401, 'ticketOwner 需要登录，匿名拿不到');
    assert.equal(at('挂别人工单·我').json.error, '工单不存在', '别人的工单报 404');
    assert.equal(at('挂别人工单·本人').status, 200);
    assert.equal(at('挂别人工单·匿名').status, 401);
    assert.equal(at('挂别人工单·超管').status, 200, '超管能看任何工单');
    assert.equal(atNew('挂投诉单·被投诉人看').status, 403, '现版如实回 403');
    assert.equal(atNew('挂投诉单·被投诉人看').json.error, '此投诉仅限超管处理',
      'v88.8 已修：ticketOwner 里的 fail(403) 原来写在同一个 try 里，被该段的 catch '
      + '当成「你不是管理员」接走，退回玩家身份后变成 401「需要市民账号」。'
      + '回避规则真正想说的话一句都到不了前端。现在如实回 403。');
    assert.equal(at('挂投诉单·被投诉人看').status, 401, '基线那一侧仍是 401');
    assert.equal(at('挂投诉单·被投诉人看').json.error, '需要市民账号',
      '基线（06e9595）就是 401 —— 这条差异是 v88.8 有意引入的，不是本来就有的');
    assert.equal(at('挂投诉单·超管看').status, 200);
    assert.equal(at('挂投诉单·提交人看').status, 200);
    assert.equal(at('管理员的').status, 200);
    assert.equal(at('管理员的·玩家访问').json.error, '附件不存在');
    assert.equal(at('酒店经营的').status, 200);
    assert.equal(at('id 非法').json.error, '附件 ID 无效');
    assert.equal(at('id 穿越').json.error, '附件 ID 无效');
    assert.equal(at('id 不存在').status, 404);
    assert.equal(at('无 id').json.error, '附件 ID 无效');
    assert.equal(at('download=0').status, 200, "download≠'1' 就走元信息");
    assert.equal(at('download=yes').status, 200);
    assert.equal(at('未就绪就下载').json.error, '附件尚未上传完成');
    assert.equal(at('未就绪就下载').status, 409);
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 13. GET 下载 + Range
// ===========================================================================

test('uploads：GET 下载 Range 全分支（200/206/416/头字段）两版一致且字节正确', async () => {
  const pair = await loadPair();
  try {
    const SIZE = CHUNK_SIZE + 1000; // 2 块：整块 + 1000 字节
    const all = makeBytes('image/jpeg', SIZE);
    const RANGES = [
      ['无 Range', null, 200],
      ['bytes=0-', 'bytes=0-', 206],
      ['bytes=0-99', 'bytes=0-99', 206],
      ['bytes=50-149', 'bytes=50-149', 206],
      ['bytes=-500 后缀', 'bytes=-500', 206],
      ['bytes=-999999 后缀超量', 'bytes=-999999', 206],
      ['bytes=1000- 跨块', 'bytes=1000-', 206],
      ['bytes=262143-262150 跨块边界', 'bytes=262143-262150', 206],
      ['bytes=262140- 整块后半', 'bytes=262140-', 206],
      ['bytes=0-999999 end 超界', 'bytes=0-999999', 206],
      ['bytes=0-0 单字节', 'bytes=0-0', 206],
      ['bytes=262143-262143 末字节', 'bytes=262143-262143', 206],
      ['bytes=99-50 start>end', 'bytes=99-50', 416],
      ['bytes=263144- 越界', 'bytes=263144-', 416],
      ['bytes=-0 后缀 0', 'bytes=-0', 416],
      ['bytes=- 空', 'bytes=-', 416],
      ['bytes=abc', 'bytes=abc', 416],
      ['bytes= 空', 'bytes=', 416],
      ['bytes 0-99 无等号', 'bytes 0-99', 416],
      ['bytes=0-99,200-299 多段', 'bytes=0-99, 200-299', 416],
      ['0-99 无单位', '0-99', 416],
      ['bytes=0-1,5-6 多段带空格', 'bytes=0-1, 5-6', 416],
      ['bytes=1e3- 科学计数', 'bytes=1e3-', 416],
      ['bytes=99999999999999999999-', 'bytes=99999999999999999999-', 416],
      ['bytes=--5', 'bytes=--5', 416],
    ];
    const steps = RANGES.map(([label, range]) => ({
      label, method: 'GET', as: 'p1', binary: true,
      url: `/api/uploads?id=${UUID(1)}&download=1`,
      headers: range ? { Range: range } : {},
    }));
    steps.push({ label: 'save=1 → attachment', method: 'GET', as: 'p1', binary: true, url: `/api/uploads?id=${UUID(1)}&download=1&save=1` });
    steps.push({ label: 'save=0 → inline', method: 'GET', as: 'p1', binary: true, url: `/api/uploads?id=${UUID(1)}&download=1&save=0` });
    steps.push({ label: '公开附件缓存头', method: 'GET', as: 'anon', binary: true, url: `/api/uploads?id=${UUID(2)}&download=1` });
    steps.push({ label: 'Range 头大小写', method: 'GET', as: 'p1', binary: true, url: `/api/uploads?id=${UUID(1)}&download=1`, headers: { range: 'bytes=0-9' } });
    const a = await differential(pair, {
      seed: async (DB) => {
        await seedReadyUpload(DB, { id: UUID(1), size: SIZE, name: '我的 灯灯.jpg' });
        await seedReadyUpload(DB, { id: UUID(2), size: SIZE, publicAccess: 1 });
      },
      steps,
    });
    const at = byLabel(a.steps);
    const expect = (start, end) => Buffer.from(all.slice(start, end + 1));
    const shaOf = (buf) => createHash('sha256').update(buf).digest('hex');
    const check = (label, start, end) => {
      const r = at(label);
      assert.equal(r.status, 206, `${label}：状态码`);
      assert.equal(r.bin.len, end - start + 1, `${label}：长度`);
      assert.equal(r.bin.sha, shaOf(expect(start, end)), `${label}：字节内容`);
    };
    // 防假绿：整文件字节必须与造物完全一致（不是只比两版相等）
    const full = at('无 Range');
    assert.equal(full.status, 200);
    assert.equal(full.bin.len, SIZE);
    assert.equal(full.bin.sha, shaOf(Buffer.from(all)), '整文件字节必须与造物完全一致');
    check('bytes=0-', 0, SIZE - 1);
    check('bytes=0-99', 0, 99);
    check('bytes=50-149', 50, 149);
    check('bytes=-500 后缀', SIZE - 500, SIZE - 1);
    check('bytes=-999999 后缀超量', 0, SIZE - 1);
    check('bytes=1000- 跨块', 1000, SIZE - 1);
    check('bytes=262143-262150 跨块边界', 262143, 262150);
    check('bytes=262140- 整块后半', 262140, SIZE - 1);
    check('bytes=0-999999 end 超界', 0, SIZE - 1);
    check('bytes=0-0 单字节', 0, 0);
    check('bytes=262143-262143 末字节', 262143, 262143);
    check('Range 头大小写', 0, 9);
    for (const [label] of RANGES.filter(([, , code]) => code === 416)) {
      assert.equal(at(label).status, 416, `${label}：必须 416`);
    }
    // 头字段
    assert.equal(full.headers['content-type'], 'image/jpeg');
    assert.equal(full.headers['content-length'], String(SIZE));
    assert.equal(full.headers['accept-ranges'], 'bytes');
    assert.equal(full.headers['x-content-type-options'], 'nosniff');
    assert.equal(full.headers['content-security-policy'], "default-src 'none'; sandbox");
    assert.equal(full.headers['cache-control'], 'private, no-store', '非公开附件必须 no-store');
    assert.equal(full.headers['content-disposition'], "inline; filename*=UTF-8''%E6%88%91%E7%9A%84%20%E7%81%AF%E7%81%AF.jpg", '中文名要 RFC5987 编码');
    assert.equal(full.headers['content-range'], undefined, '没有 Range 就不该有 Content-Range');
    const part = at('bytes=0-99');
    assert.equal(part.headers['content-range'], `bytes 0-99/${SIZE}`);
    assert.equal(part.headers['content-length'], '100');
    assert.equal(part.headers['content-disposition'].startsWith('inline;'), true);
    assert.equal(at('save=1 → attachment').headers['content-disposition'].startsWith('attachment;'), true, "save='1' 必须是 attachment");
    assert.equal(at('save=0 → inline').headers['content-disposition'].startsWith('inline;'), true);
    assert.equal(at('公开附件缓存头').headers['cache-control'], 'public, max-age=3600', '公开附件可以缓存');
  } finally {
    pair.cleanup();
  }
});

test('uploads：流式读跨 STREAM_BATCH(16) 分批 + 缺块报错两版一致', async () => {
  const pair = await loadPair();
  try {
    const COUNT = 18; // > 16，逼出 LIMIT 16 的分批与 buffered 窗口
    const SIZE = CHUNK_SIZE * COUNT;
    const steps = [
      { label: '整文件 18 块', method: 'GET', as: 'p1', binary: true, url: `/api/uploads?id=${UUID(1)}&download=1` },
      { label: '跨批次 Range', method: 'GET', as: 'p1', binary: true, url: `/api/uploads?id=${UUID(1)}&download=1`, headers: { Range: `bytes=${CHUNK_SIZE * 17}-` } },
      { label: '首批就缺块', method: 'GET', as: 'p1', binary: true, url: `/api/uploads?id=${UUID(3)}&download=1` },
      { label: '第二批才缺块', method: 'GET', as: 'p1', binary: true, url: `/api/uploads?id=${UUID(2)}&download=1` },
      { label: '缺末块', method: 'GET', as: 'p1', binary: true, url: `/api/uploads?id=${UUID(4)}&download=1` },
    ];
    const a = await differential(pair, {
      seed: async (DB) => {
        await seedReadyUpload(DB, { id: UUID(1), size: SIZE });
        await seedReadyUpload(DB, { id: UUID(2), size: SIZE, skipPart: 5 });   // 首批内
        await seedReadyUpload(DB, { id: UUID(3), size: SIZE, skipPart: 0 });   // 第一块就没了
        await seedReadyUpload(DB, { id: UUID(4), size: SIZE, skipPart: 17 });  // 末块没了
      },
      steps,
    });
    const at = byLabel(a.steps);
    const all = Buffer.from(makeBytes('image/jpeg', SIZE));
    const shaOf = (buf) => createHash('sha256').update(buf).digest('hex');
    // 防假绿：18 块拼接后必须与造物逐字节一致
    assert.equal(at('整文件 18 块').status, 200);
    assert.equal(at('整文件 18 块').bin.len, SIZE, '18 块必须一次读全');
    assert.equal(at('整文件 18 块').bin.sha, shaOf(all), '18 块拼接后的字节必须与造物一致');
    const tail = at('跨批次 Range');
    assert.equal(tail.bin.len, CHUNK_SIZE, '最后一块正好一整块');
    assert.equal(tail.bin.sha, shaOf(all.subarray(CHUNK_SIZE * 17)));
    assert.equal(tail.headers['content-range'], `bytes ${CHUNK_SIZE * 17}-${SIZE - 1}/${SIZE}`);
    // 缺块必须以错误中断，而不是静默截断
    for (const l of ['首批就缺块', '第二批才缺块', '缺末块']) {
      const r = at(l);
      assert.equal(r.status, 200, `${l}：状态码在流开始前就定了`);
      assert.equal(r.bin, undefined, `${l}：不能返回截断的内容`);
      assert.match(String(r.binError), /分块缺失/, `${l}：缺块必须以错误中断流`);
    }
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 14. DELETE
// ===========================================================================

test('uploads：DELETE 草稿（可删 / 已提交 / 公开 / 越权 / 顺序 / 孤儿分块）两版一致', async () => {
  const pair = await loadPair();
  try {
    const a = await differential(pair, {
      seed: async (DB) => {
        await seedReadyUpload(DB, { id: UUID(1), size: CHUNK_SIZE * 2, status: 'uploading' });
        await seedReadyUpload(DB, { id: UUID(2), size: CHUNK_SIZE * 2, status: 'uploading' }); // 要删
        await seedReadyUpload(DB, { id: UUID(3), size: 100, publicAccess: 1 });
        await seedReadyUpload(DB, { id: UUID(4), size: 100 });
        await DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(UUID(4), '1').run();
        await seedReadyUpload(DB, { id: UUID(5), size: 100, owner: 2 });
        await seedReadyUpload(DB, { id: UUID(6), size: 100, owner: 2, kind: 'admin' });
        await seedReadyUpload(DB, { id: UUID(7), size: 100, owner: 1, kind: 'hotel' });
      },
      steps: [
        { label: '公开附件不可删', method: 'DELETE', as: 'p1', url: `/api/uploads?id=${UUID(3)}` },
        { label: '已挂工单不可删', method: 'DELETE', as: 'p1', url: `/api/uploads?id=${UUID(4)}` },
        { label: '别人的不可删', method: 'DELETE', as: 'p1', url: `/api/uploads?id=${UUID(5)}` },
        { label: '别人的→404', method: 'DELETE', as: 'p2', url: `/api/uploads?id=${UUID(1)}` },
        { label: '匿名', method: 'DELETE', as: 'anon', url: `/api/uploads?id=${UUID(1)}` },
        { label: 'id 不存在', method: 'DELETE', as: 'p1', url: `/api/uploads?id=${UUID(9)}` },
        { label: 'id 非法', method: 'DELETE', as: 'p1', url: '/api/uploads?id=x' },
        { label: 'id 穿越', method: 'DELETE', as: 'p1', url: '/api/uploads?id=../../secret' },
        { label: 'id 长穿越串', method: 'DELETE', as: 'p1', url: `/api/uploads?id=${encodeURIComponent('../' + 'a'.repeat(20))}` },
        { label: '无 id', method: 'DELETE', as: 'p1', url: '/api/uploads' },
        { label: '管理员的', method: 'DELETE', as: 'wzc', url: `/api/uploads?id=${UUID(6)}` },
        { label: '酒店经营的', method: 'DELETE', as: 'howner', url: `/api/uploads?id=${UUID(7)}` },
        { label: '删自己的草稿', method: 'DELETE', as: 'p1', url: `/api/uploads?id=${UUID(2)}` },
        { label: '再删一次', method: 'DELETE', as: 'p1', url: `/api/uploads?id=${UUID(2)}` },
        { label: '再传块（草稿没了）', method: 'PUT', as: 'p1', url: `/api/uploads?id=${UUID(2)}&part=0`, body: { data: B64(makeBytes('image/jpeg', 4)) } },
        { label: '删自己的 ready 附件', method: 'DELETE', as: 'p1', url: `/api/uploads?id=${UUID(1)}` },
      ],
    });
    const at = byLabel(a.steps);
    // 防假绿
    assert.equal(at('公开附件不可删').json.error, '已提交的附件不能从上传草稿中移除');
    assert.equal(at('公开附件不可删').status, 409);
    assert.equal(at('已挂工单不可删').status, 409, '挂了工单的附件也不能从草稿里删');
    assert.equal(at('别人的不可删').status, 404);
    assert.equal(at('别人的→404').status, 404);
    assert.equal(at('匿名').json.error, '请先登录');
    assert.equal(at('id 不存在').status, 404);
    assert.equal(at('id 非法').json.error, '附件 ID 无效');
    assert.equal(at('id 穿越').json.error, '附件 ID 无效');
    assert.equal(at('id 长穿越串').json.error, '附件 ID 无效');
    assert.equal(at('无 id').json.error, '附件 ID 无效');
    assert.equal(at('管理员的').status, 200);
    assert.equal(at('酒店经营的').status, 200);
    assert.deepEqual(at('删自己的草稿').json, { ok: true, deleted: true });
    assert.equal(at('再删一次').status, 404);
    assert.equal(at('再传块（草稿没了）').status, 404);
    assert.equal(at('删自己的 ready 附件').status, 200, 'ready 但没挂工单也能删');
    // 落库：分块不能留孤儿
    const ids = a.db.media_uploads.map((r) => r.id);
    assert.deepEqual(ids.sort(), [UUID(3), UUID(4), UUID(5)].sort(), '只剩删不掉的那三条');
    assert.deepEqual(a.db.media_chunks.filter((r) => !ids.includes(r.upload_id)), [], 'media_chunks 不能留下孤儿行');
    assert.deepEqual(a.db.ticket_attachments, [{ upload_id: UUID(4), ticket_ref: '1' }]);
    // 分块必须先删：库里没有外键，两个顺序的**数据结果**完全一样，只有语句顺序能区分
    // 4 次成功删除（管理员的 / 酒店经营的 / 自己的草稿 / 自己的 ready 附件），
    // 每次都必须是「先分块后主记录」
    const delBatch = a.batch.filter((sql) => /^DELETEFROMmedia_(chunks|uploads)/.test(sql));
    assert.equal(delBatch.length, 8, `4 次删除各发 2 条语句，实际 ${delBatch.length} 条`);
    for (let i = 0; i < delBatch.length; i += 2) {
      assert.deepEqual(delBatch.slice(i, i + 2), [
        'DELETEFROMmedia_chunksWHEREupload_id=?',
        'DELETEFROMmedia_uploadsWHEREid=?',
      ], `第 ${i / 2 + 1} 次删除：必须先删分块再删主记录（分块表没有外键，只能靠语句顺序验）`);
    }
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 15. 故障注入：底层写/读失败时的降级
// ===========================================================================

/** 在指定 SQL 上抛错的 D1 代理。SQL 去空白后匹配，所以两版（压缩 / 可读）写法不同也能同时命中 */
function failOn(needle, message = 'disk I/O error') {
  const flat = (s) => String(s).replace(/\s+/g, '');
  const key = flat(needle);
  return (DB) => {
    const wrap = (st) => ({
      sql: st.sql,
      bind: (...p) => wrap(st.bind(...p)),
      all: () => (flat(st.sql).includes(key) ? Promise.reject(new Error(message)) : st.all()),
      run: () => (flat(st.sql).includes(key) ? Promise.reject(new Error(message)) : st.run()),
      first: (c) => (flat(st.sql).includes(key) ? Promise.reject(new Error(message)) : st.first(c)),
    });
    return { prepare: (sql) => wrap(DB.prepare(sql)), batch: (items) => DB.batch(items) };
  };
}

test('uploads：D1 写/读故障时两版降级响应一致（7 个故障点）', async () => {
  const pair = await loadPair();
  try {
    const POINTS = [
      ['写分块失败', 'INSERT INTO media_chunks(upload_id'],
      ['finish 置 ready 失败', "UPDATE media_uploads SET status='ready'"],
      ['GC 删分块失败', 'DELETE FROM media_chunks WHERE upload_id IN'],
      ['GC 删主记录失败', 'DELETE FROM media_uploads WHERE created_at<'],
      ['查配额失败', 'AS bytes FROM media_uploads'],
      ['查块统计失败', 'COALESCE(SUM(byte_size),0)'],
      ['建草稿失败', 'INSERT INTO media_uploads(id,'],
      ['查附件失败', 'SELECT * FROM media_uploads WHERE id=?'],
      ['查关联失败', 'SELECT upload_id FROM ticket_attachments'],
      ['流式读块失败', 'SELECT part,data FROM media_chunks'],
    ];
    for (const [label, needle] of POINTS) {
      const a = await differential(pair, {
        seed: async (DB) => {
          await seedReadyUpload(DB, { id: UUID(1), size: CHUNK_SIZE * 2, status: 'uploading' });
          await DB.prepare('DELETE FROM media_chunks WHERE upload_id=? AND part=1').bind(UUID(1)).run();
          await seedReadyUpload(DB, { id: UUID(2), size: CHUNK_SIZE * 2 });
        },
        fault: failOn(needle),
        steps: [
          { method: 'POST', as: 'p1', body: { action: 'finish', id: UUID(1) } },
          { method: 'PUT', as: 'p1', url: `/api/uploads?id=${UUID(1)}&part=1`, body: { data: B64(makeBytes('image/jpeg', CHUNK_SIZE)) } },
          { method: 'POST', as: 'p1', body: { name: 'n.jpg', mime: 'image/jpeg', size: 100 } },
          { method: 'GET', as: 'p1', url: `/api/uploads?id=${UUID(1)}` },
          { method: 'GET', as: 'p1', binary: true, url: `/api/uploads?id=${UUID(2)}&download=1` },
          { method: 'DELETE', as: 'p1', url: `/api/uploads?id=${UUID(2)}` },
        ],
      });
      assert.equal(a.steps.length, 6, label);
    }
  } finally {
    pair.cleanup();
  }
});

test('uploads：底层写失败必须降级成 500 且不落脏数据（两版一致）', async () => {
  const pair = await loadPair();
  try {
    for (const [label, needle, hit] of [
      ['写分块失败', 'INSERT INTO media_chunks(upload_id', 0],
      ['finish 查统计失败', 'COALESCE(SUM(byte_size),0)', 1],
      ['finish 置 ready 失败', "UPDATE media_uploads SET status='ready'", 1],
      ['建草稿失败', 'INSERT INTO media_uploads(id,', 2],
      ['查配额失败', 'AS bytes FROM media_uploads', 2],
    ]) {
      const a = await differential(pair, {
        // noChunks：种子自己不带分块，这样「写失败没留下分块」才是真的
        seed: async (DB) => seedReadyUpload(DB, { id: UUID(1), size: 100, status: 'uploading', createdAt: '2099-01-01 00:00:00', noChunks: true }),
        fault: failOn(needle),
        steps: [
          { method: 'PUT', as: 'p1', url: `/api/uploads?id=${UUID(1)}&part=0`, body: { data: B64(makeBytes('image/jpeg', 100)) } },
          { method: 'POST', as: 'p1', body: { action: 'finish', id: UUID(1) } },
          { method: 'POST', as: 'p1', body: { name: 'n.jpg', mime: 'image/jpeg', size: 100 } },
        ],
      });
      assert.equal(a.steps[hit].status, 500, `${label}：必须降级成 500`);
      assert.deepEqual(a.steps[hit].json, { ok: false, error: '服务处理失败，请稍后重试' }, `${label}：不能把 SQLite 细节抖给前端`);
      if (label === '写分块失败') assert.deepEqual(a.db.media_chunks, [], '写失败不能留下分块');
      if (label === '建草稿失败') assert.equal(a.db.media_uploads.length, 1, '建草稿失败不能插出半条记录');
    }
  } finally {
    pair.cleanup();
  }
});

// ===========================================================================
// 16. 端到端：走 dispatch + 真中间件
// ===========================================================================

test('uploads：端到端（建草稿 → 逐块 PUT → finish → 元信息 → 下载 → Range → 删除）两版一致', async () => {
  const pair = await loadPair();
  try {
    const SIZE = CHUNK_SIZE + 777;
    const all = makeBytes('image/jpeg', SIZE);
    const seg = (p) => all.slice(p * CHUNK_SIZE, Math.min(SIZE, (p + 1) * CHUNK_SIZE));

    const runAll = async (mod, useDispatch) => {
      const f = await seeded();
      try {
        uuidSeq = 0;
        const env = { DB: f.DB, R2: r2Ref.binding };
        // 现版走 dispatch（真中间件 + 真审计），基线直接调 handler（dispatch 按 URL 找文件，
        // 只能指向现版）。因此两版都会带上中间件注入的头，两边一起过滤掉。
        // 中间件会补 x-request-id / x-app-schema-version / x-content-type-options，并把
        // cache-control 统一覆写成 no-store（盖掉路由自己设的 private, no-store 与
        // public, max-age）。这几项差的是「走没走中间件」，不是被测代码的行为，从比对里摘掉。
        // 路由自己设的那几个头由 Range 那条用例直接调 handler 精确断言。
        const MIDDLEWARE_ONLY = ['x-request-id', 'x-app-schema-version', 'x-content-type-options', 'cache-control'];
        const drop = (h) => Object.fromEntries([...h.entries()].filter(([k]) => !MIDDLEWARE_ONLY.includes(k)));
        const call = async (method, url, body, as = 'p1', headers = {}) => {
          if (useDispatch) {
            const token = SESSIONS[as];
            const req = new Request('https://local.test' + url, {
              method,
              headers: { ...(token ? { Cookie: `lc_session=${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
              body: body === undefined ? undefined : JSON.stringify(body),
            });
            const r = await dispatch(req, env);
            const ct = r.headers.get('content-type') || '';
            const out = { status: r.status, headers: drop(r.headers) };
            if (ct.includes('json')) out.json = await r.json();
            else {
              const buf = Buffer.from(await r.arrayBuffer());
              out.bin = { len: buf.length, sha: sha(buf), head: buf.subarray(0, 16).toString('hex') };
            }
            return out;
          }
          const c = makeContext(env, { as, method, url, headers, body });
          const r = await handlerOf(mod, method)(c);
          const rec = await readResponse(r, true);
          rec.headers = drop(new Headers(rec.headers));
          return rec;
        };
        const steps = [];
        const created = await call('POST', '/api/uploads', { name: 'e2e.jpg', mime: 'image/jpeg', size: SIZE });
        steps.push(created);
        // id 从响应里拿，不硬编码：现版走 dispatch 时中间件也会调 randomUUID()
        // 生成 X-Request-Id，计数器走向与直接调 handler 的基线不同
        const id = created.json.id;
        steps.push(await call('PUT', `/api/uploads?id=${id}&part=0`, { data: B64(seg(0)) }));
        steps.push(await call('PUT', `/api/uploads?id=${id}&part=1`, { data: B64(seg(1)) }));
        steps.push(await call('POST', '/api/uploads', { action: 'finish', id }));
        steps.push(await call('GET', `/api/uploads?id=${id}`));
        steps.push(await call('GET', `/api/uploads?id=${id}&download=1`));
        steps.push(await call('GET', `/api/uploads?id=${id}&download=1`, undefined, 'p1', { Range: 'bytes=10-20' }));
        steps.push(await call('GET', `/api/uploads?id=${id}&download=1`, undefined, 'anon'));
        steps.push(await call('DELETE', `/api/uploads?id=${id}`));
        steps.push(await call('GET', `/api/uploads?id=${id}`));
        // 附件 id 是 randomUUID 出来的，不算行为：现版走 dispatch 时中间件还会额外调一次
        // randomUUID() 生成 X-Request-Id，计数器走向与直接调 handler 的基线必然不同。
        // 比对前把 id 统一抹成占位符。
        return { steps: JSON.parse(JSON.stringify(steps).split(id).join('<UPLOAD_ID>')), db: await snapshot(f.DB), createdId: id };
      } finally { f.close(); }
    };

    const a = await runAll(pair.old.api, false);
    const b = await runAll(pair.new.api, true);
    const brief = (xs) => xs.map((s) => `${s.status} ${s.json ? JSON.stringify(s.json) : 'bin=' + JSON.stringify(s.bin)}`);
    assert.deepEqual(b.steps, a.steps, `端到端逐响应不一致\n基线: ${brief(a.steps).join('\n       ')}\n现版: ${brief(b.steps).join('\n       ')}`);
    // 防假绿：真的走完了全程，字节也对
    // 匿名下载非公开附件：identity 的 401 被吞掉，落到「没有工单可放行」→ 404
    assert.deepEqual(a.steps.map((s) => s.status), [201, 200, 200, 200, 200, 200, 206, 404, 200, 404]);
    assert.match(a.createdId, /^10000000-0000-4000-8000-\d{12}$/, '附件 id 必须是 randomUUID 形态');
    assert.equal(typeof b.createdId, 'string');
    assert.equal(a.steps[1].json.received, CHUNK_SIZE);
    assert.equal(a.steps[2].json.received, 777, '末块 777 字节');
    assert.deepEqual(a.steps[3].json, { ok: true, id: '<UPLOAD_ID>', name: 'e2e.jpg', mime: 'image/jpeg', size: SIZE, url: '/api/uploads?id=<UPLOAD_ID>&download=1' });
    assert.deepEqual(a.steps[4].json.parts, [0, 1]);
    assert.equal(a.steps[4].json.status, 'ready');
    assert.equal(a.steps[5].bin.len, SIZE);
    assert.equal(a.steps[5].bin.sha, sha(Buffer.from(all)), '端到端下载的字节必须与造物一致');
    assert.equal(a.steps[6].bin.len, 11, 'bytes=10-20 是 11 字节');
    assert.equal(a.steps[6].bin.sha, sha(Buffer.from(all.slice(10, 21))));
    assert.equal(a.steps[7].status, 404, '非公开附件匿名下载被拒（且不泄露 id 是否存在）');
    assert.equal(a.steps[7].json.error, '附件不存在');
    assert.deepEqual(a.steps[8].json, { ok: true, deleted: true });
    assert.equal(a.steps[9].json.error, '附件不存在');
    assert.deepEqual(a.db.media_uploads, [], '全程结束后草稿应被删干净');
    assert.deepEqual(a.db.media_chunks, [], '不能留下孤儿分块');
  } finally {
    pair.cleanup();
  }
});
