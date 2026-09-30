// scripts/backup-d1.mjs 的端到端自测：起一个假 D1 API，跑真脚本，验真产物。
//
// 重点覆盖导出循环最容易出错的地方：
//   分页（1200 行跨 3 页）、空表、BLOB、单引号/注入串、换行、中文、索引顺序
//
// 不联网，不碰真实 D1。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// 必须异步：mock server 与被测子进程在同一进程里，
// 用 execFileSync 会阻塞事件循环，server 永远收不到请求 → 死锁。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'backup-d1.mjs');
const NODE = process.execPath;

// ---------- 假数据 ----------

const ALPHA = [
  { id: 1, name: "O'Brien", note: "x'; DROP TABLE users; --", blob: null, score: 1.5 },
  { id: 2, name: '灯光市', note: '第一行\n第二行', blob: null, score: 0 },
  { id: 3, name: 'back\\slash 🚗', note: null, blob: null, score: -7 },
];
const DELTA = [{ id: 1, name: '二进制', blob: 'aGk=' }]; // base64 of "hi"
const BETA = Array.from({ length: 1200 }, (_, i) => ({
  id: i + 1,
  name: `赛道${i + 1}`,
  note: i % 100 === 0 ? null : `n${i}`,
  blob: null,
  score: i,
}));

const TABLES = {
  alpha: {
    sql: 'CREATE TABLE alpha (id INTEGER PRIMARY KEY, name TEXT, note TEXT, blob BLOB, score REAL)',
    cols: [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'note', type: 'TEXT' },
      { name: 'blob', type: 'BLOB' },
      { name: 'score', type: 'REAL' },
    ],
    rows: ALPHA,
  },
  beta: {
    sql: 'CREATE TABLE beta (id INTEGER PRIMARY KEY, name TEXT, note TEXT, blob BLOB, score REAL)',
    cols: [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'note', type: 'TEXT' },
      { name: 'blob', type: 'BLOB' },
      { name: 'score', type: 'REAL' },
    ],
    rows: BETA,
  },
  delta: {
    sql: 'CREATE TABLE delta (id INTEGER PRIMARY KEY, name TEXT, blob BLOB)',
    cols: [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'blob', type: 'BLOB' },
    ],
    rows: DELTA,
  },
  gamma: {
    sql: 'CREATE TABLE gamma (id INTEGER PRIMARY KEY, label TEXT)',
    cols: [{ name: 'id', type: 'INTEGER' }, { name: 'label', type: 'TEXT' }],
    rows: [],
  },
};

const INDEXES = [{ name: 'idx_alpha_name', sql: 'CREATE INDEX idx_alpha_name ON alpha(name)' }];

// ---------- 假 API ----------

function handleQuery(sql) {
  const s = sql.trim();

  if (/FROM sqlite_master/.test(s)) {
    if (/type = 'index'/.test(s)) {
      return INDEXES.map((i) => ({ name: i.name, sql: i.sql }));
    }
    return Object.entries(TABLES).map(([name, t]) => ({ name, sql: t.sql }));
  }

  const m = s.match(/PRAGMA table_info\("?([A-Za-z_][A-Za-z0-9_]*)"?\)/);
  if (m) return TABLES[m[1]]?.cols ?? [];

  const cnt = s.match(/SELECT COUNT\(\*\) AS n FROM "?([A-Za-z_][A-Za-z0-9_]*)"?/);
  if (cnt) return [{ n: TABLES[cnt[1]]?.rows.length ?? 0 }];

  const sel = s.match(/SELECT \* FROM "?([A-Za-z_][A-Za-z0-9_]*)"? LIMIT (\d+) OFFSET (\d+)/);
  if (sel) {
    const [, name, lim, off] = sel;
    return (TABLES[name]?.rows ?? []).slice(Number(off), Number(off) + Number(lim));
  }

  throw new Error(`mock 不认识的 SQL: ${s}`);
}

function startMock() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!/POST/.test(req.method) || !/\/query$/.test(req.url)) {
        res.writeHead(404).end('{}');
        return;
      }
      try {
        const { sql } = JSON.parse(body);
        const results = handleQuery(sql);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result: [{ results }] }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, errors: [{ message: e.message }] }));
      }
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// ---------- 测试 ----------

test('backup-d1 全库导出（假 D1 端到端）', async (t) => {
  const server = await startMock();
  const port = server.address().port;
  const outDir = mkdtempSync(join(ROOT, '.backup-test-'));

  t.after(() => {
    server.closeAllConnections?.();
    server.close();
    try { rmSync(outDir, { recursive: true, force: true }); } catch {}
  });

  await execFileP(NODE, [SCRIPT, outDir], {
    env: {
      ...process.env,
      CF_API_TOKEN: 'test-token',
      CF_ACCOUNT_ID: 'test-account',
      CF_API_BASE: `http://127.0.0.1:${port}`,
    },
  });

  const { readdirSync } = await import('node:fs');
  const files = readdirSync(outDir);
  const sqlFile = files.find((f) => f.endsWith('.sql'));
  const jsonFile = files.find((f) => f.endsWith('.json'));
  assert.ok(sqlFile, '应生成 .sql');
  assert.ok(jsonFile, '应生成 .json');
  assert.ok(files.includes('RESTORE.md'), '应生成 RESTORE.md');

  const sql = readFileSync(join(outDir, sqlFile), 'utf8');
  const manifest = JSON.parse(readFileSync(join(outDir, jsonFile), 'utf8'));

  // --- 转义 ---
  assert.match(sql, /'O''Brien'/, "O'Brien 的单引号要翻倍");
  assert.match(sql, /'x''; DROP TABLE users; --'/, '注入串要被中和');
  assert.ok(!/VALUES \([^)]*'x'; DROP/.test(sql), '不能出现未转义的 DROP');
  assert.match(sql, /'灯光市'/, '中文原样');
  assert.match(sql, /'back\\slash 🚗'/, '反斜杠+emoji 原样');
  assert.match(sql, /NULL,/, 'null 存成 NULL');

  // --- BLOB ---
  assert.match(sql, /X'6869'/, 'base64 BLOB 转十六进制字面量');

  // --- 分页完整性：beta 1200 行要一条不少 ---
  const betaInserts = sql.match(/INSERT INTO "beta"/g) ?? [];
  assert.equal(betaInserts.length, 1200, `beta 应导出 1200 行，实际 ${betaInserts.length}`);
  assert.match(sql, /'赛道1200'/, 'beta 最后一行不能丢');
  assert.match(sql, /'赛道1'/, 'beta 第一行要在');

  // --- 空表 ---
  assert.match(sql, /CREATE TABLE gamma/, '空表也要建表');
  assert.equal((sql.match(/INSERT INTO "gamma"/g) ?? []).length, 0, '空表不能有 INSERT');

  // --- 索引在数据之后 ---
  assert.ok(
    sql.indexOf('CREATE INDEX idx_alpha_name') > sql.lastIndexOf('INSERT INTO'),
    '索引必须建在所有 INSERT 之后'
  );

  // --- 事务包裹 ---
  assert.match(sql, /PRAGMA foreign_keys = OFF;/);
  assert.match(sql, /BEGIN TRANSACTION;/);
  assert.match(sql, /COMMIT;/);
  assert.ok(sql.indexOf('BEGIN TRANSACTION;') < sql.indexOf('INSERT INTO'), 'BEGIN 在 INSERT 之前');
  assert.ok(sql.indexOf('COMMIT;') > sql.lastIndexOf('INSERT INTO'), 'COMMIT 在最后');

  // --- 清单 ---
  assert.equal(manifest.table_count, 4);
  assert.equal(manifest.total_rows, 3 + 1200 + 1 + 0);
  assert.deepEqual(
    manifest.tables.map((t) => t.name).sort(),
    ['alpha', 'beta', 'delta', 'gamma']
  );
  const gamma = manifest.tables.find((t) => t.name === 'gamma');
  assert.equal(gamma.rows, 0, '空表行数应为 0');
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/, '清单要带 SHA256');

  // --- 每张表行数都写进 RESTORE.md ---
  const restore = readFileSync(join(outDir, 'RESTORE.md'), 'utf8');
  for (const tb of manifest.tables) {
    assert.match(restore, new RegExp(`- ${tb.name}: ${tb.rows}\\b`), `RESTORE.md 应列出 ${tb.name}`);
  }
});

test('backup-d1 --self-test 全通过', () => {
  const out = execFileSync(NODE, [SCRIPT, '--self-test'], { encoding: 'utf8' });
  assert.match(out, /全部通过/);
  assert.ok(!out.includes('FAIL'), '自测不该有失败项');
});

test('backup-d1 无凭据时给出可操作提示而非崩溃', () => {
  let err = null;
  try {
    execFileSync(NODE, [SCRIPT], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err, '无凭据应非零退出');
  const msg = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  assert.match(msg, /CF_API_TOKEN/, '提示要说清缺什么');
  assert.match(msg, /CF_ACCOUNT_ID/);
  assert.match(msg, /API Tokens/, '要给出拿 token 的入口');
});
