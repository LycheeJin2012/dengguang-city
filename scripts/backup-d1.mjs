// 全库备份：把生产 D1 整库导出成可还原的 .sql + 清单 .json
//
// 用法：
//   node scripts/backup-d1.mjs --self-test                    只验转义逻辑，不联网
//   CF_API_TOKEN=xxx CF_ACCOUNT_ID=yyy node scripts/backup-d1.mjs [输出目录]
//
// 凭据从环境变量读，不写进仓库：
//   - CF_API_TOKEN  Cloudflare API Token，用模板 "Cloudflare D1: Read"（只给 read）
//   - CF_ACCOUNT_ID dengguang-city 所在账号的 Account ID
//
// 数据库 ID 从 wrangler.toml 读，表清单从 sqlite_master 动态发现——都不硬编码。
// 不需要 wrangler，不需要 npm install，不碰 .dev.vars。

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SELF_TEST = process.argv.includes('--self-test');

// ---------- 从 wrangler.toml 取 database_id ----------

function readDbId() {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const m = toml.match(/database_id\s*=\s*"([0-9a-fA-F-]{36})"/);
  if (!m) throw new Error('wrangler.toml 里没找到 database_id');
  return m[1];
}

// ---------- SQL 字面量序列化 ----------

// 表名/字段名来自 sqlite_master，仍要过白名单才拼进 SQL
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(name, what) {
  if (!SAFE_IDENT.test(name)) throw new Error(`非法${what}: ${JSON.stringify(name)}`);
  return `"${name}"`;
}

function sqlLiteral(v, declType) {
  if (v === null || v === undefined) return 'NULL';

  const isBlob = /\bBLOB\b/i.test(declType || '');

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`非有限数字: ${v}`);
    return String(v);
  }
  if (typeof v === 'boolean') return v ? '1' : '0';

  if (typeof v === 'string') {
    // BLOB 列在 D1 REST 响应里是 base64 字符串
    if (isBlob && v.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(v)) {
      return `X'${Buffer.from(v, 'base64').toString('hex')}'`;
    }
    return `'${v.replace(/'/g, "''")}'`;
  }

  throw new Error(`无法序列化的值 (${typeof v}): ${JSON.stringify(v)?.slice(0, 80)}`);
}

// ---------- --self-test ----------
// 不联网，只验最容易错的几处。放在所有 helper 之后、发请求之前。

if (SELF_TEST) {
  let fail = 0;
  const eq = (label, got, want) => {
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
    if (!ok) console.log(`        得到 ${JSON.stringify(got)}\n        期望 ${JSON.stringify(want)}`);
  };
  const threw = (fn) => { try { fn(); return 'no-throw'; } catch { return 'throw'; } };
  const safe = (s) => { try { ident(s, '表名'); return true; } catch { return false; } };

  eq('合法表名放行', safe('race_times'), true);
  eq('引号注入被挡', safe('a"; DROP TABLE users; --'), false);
  eq('空格被挡', safe('a b'), false);
  eq('中文被挡', safe('用户表'), false);
  eq('空串被挡', safe(''), false);
  eq('前导数字被挡', safe('1abc'), false);

  eq('NULL', sqlLiteral(null), 'NULL');
  eq('undefined→NULL', sqlLiteral(undefined), 'NULL');
  eq('数字', sqlLiteral(42), '42');
  eq('零', sqlLiteral(0), '0');
  eq('负数', sqlLiteral(-7), '-7');
  eq('小数', sqlLiteral(3.5), '3.5');
  eq('true', sqlLiteral(true), '1');
  eq('false', sqlLiteral(false), '0');
  eq('单引号翻倍', sqlLiteral("O'Brien"), "'O''Brien'");
  eq('注入被中和', sqlLiteral("x'; DROP TABLE users; --"), "'x''; DROP TABLE users; --'");
  eq('换行', sqlLiteral('a\nb'), "'a\nb'");
  eq('反斜杠', sqlLiteral('a\\b'), "'a\\b'");
  eq('中文', sqlLiteral('灯光市'), "'灯光市'");
  eq('emoji', sqlLiteral('🚗'), "'🚗'");
  eq('BLOB base64→hex', sqlLiteral('aGk=', 'BLOB'), "X'6869'");
  eq('BLOB 空值', sqlLiteral('', 'BLOB'), "X''");
  eq('TEXT 列不误判 BLOB', sqlLiteral('hello', 'TEXT'), "'hello'");
  eq('NaN 被挡', threw(() => sqlLiteral(NaN)), 'throw');
  eq('对象被挡', threw(() => sqlLiteral({ a: 1 })), 'throw');

  eq('database_id 解析', readDbId(), '8014f3c2-e578-4e7d-8c54-c37c3b28f401');

  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
}

// ---------- 联网部分 ----------

const TOKEN = process.env.CF_API_TOKEN;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;

if (!TOKEN || !ACCOUNT_ID) {
  console.error('缺少凭据。请这样跑：\n');
  console.error('  CF_API_TOKEN=<Cloudflare API Token，模板 D1:Read> \\');
  console.error('  CF_ACCOUNT_ID=<账号 ID> \\');
  console.error('  node scripts/backup-d1.mjs [输出目录]\n');
  console.error('Token 拿法：dash.cloudflare.com → My Profile → API Tokens');
  console.error('  → Create Token → 模板 "Cloudflare D1: Read" → 复制 token');
  console.error('Account ID 拿法：Workers & Pages → dengguang-city → 右侧栏');
  process.exit(1);
}

const DB_ID = readDbId();
// CF_API_BASE 只在本地自测时覆盖，生产走默认的 api.cloudflare.com
const API_BASE = process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4';
const API = `${API_BASE}/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`;
console.error(`数据库: ${DB_ID}`);
console.error(`账号:   ${ACCOUNT_ID}`);

let callCount = 0;

async function query(sql, params = []) {
  const r = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  callCount++;
  if (!r.ok) {
    console.error(`\nHTTP ${r.status} —— SQL 失败:\n${sql.slice(0, 200)}\n${(await r.text()).slice(0, 600)}`);
    process.exit(1);
  }
  const d = await r.json();
  if (!d.success) {
    console.error('\nAPI 报错:\n', JSON.stringify(d).slice(0, 600));
    process.exit(1);
  }
  return d.result?.[0]?.results ?? [];
}

// ---------- 1. 读 schema ----------

const tables = await query(
  `SELECT name, sql FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name`
);
const indexes = await query(
  `SELECT name, sql FROM sqlite_master
    WHERE type = 'index' AND sql IS NOT NULL
    ORDER BY name`
);

console.error(`\n发现 ${tables.length} 张表 + ${indexes.length} 个显式索引`);

// ---------- 2. 逐表导出 ----------

const PAGE = 500;
const out = [
  '-- dengguang-city 生产 D1 全库备份',
  '-- 由 scripts/backup-d1.mjs 生成',
  `-- database_id: ${DB_ID}`,
  `-- 导出时间:   ${new Date().toISOString()}`,
  '',
  'PRAGMA foreign_keys = OFF;',
  'BEGIN TRANSACTION;',
  '',
];

const manifest = {
  database_id: DB_ID,
  account_id: ACCOUNT_ID,
  exported_at: new Date().toISOString(),
  table_count: tables.length,
  index_count: indexes.length,
  total_rows: 0,
  tables: [],
};

for (const t of tables) {
  const name = t.name;
  const tName = ident(name, '表名');

  const cols = await query(`PRAGMA table_info(${tName})`);
  const colTypes = new Map(cols.map((c) => [c.name, c.type]));

  const cntRows = await query(`SELECT COUNT(*) AS n FROM ${tName}`);
  const total = Number(cntRows[0]?.n ?? 0);

  out.push(`-- ---------- ${name} (${total} 行) ----------`);
  if (t.sql) out.push(t.sql.trim().replace(/;+\s*$/, '') + ';');
  out.push('');

  let written = 0;
  for (let off = 0; off < total; off += PAGE) {
    const rows = await query(`SELECT * FROM ${tName} LIMIT ${PAGE} OFFSET ${off}`);
    if (rows.length === 0) break;

    for (const row of rows) {
      const keys = Object.keys(row);
      const vals = keys.map((k) => sqlLiteral(row[k], colTypes.get(k)));
      out.push(
        `INSERT INTO ${tName} (${keys.map((k) => ident(k, '字段名')).join(',')}) VALUES (${vals.join(',')});`
      );
      written++;
    }
    process.stderr.write(`\r  ${name}: ${written}/${total}   `);
  }
  process.stderr.write(`\r  ${name}: ${written}/${total}            \n`);

  if (written !== total) {
    console.error(`\n⚠ ${name} 预期 ${total} 行，实际写出 ${written} 行 —— 备份不完整，请重跑`);
    process.exit(1);
  }

  manifest.tables.push({ name, rows: written });
  manifest.total_rows += written;
}

out.push('');

// 索引最后建，避免 INSERT 期间触发唯一约束
out.push('-- ---------- 索引 ----------');
for (const ix of indexes) {
  out.push(`${ix.sql.trim().replace(/;+\s*$/, '')};`);
}
out.push('', 'COMMIT;', '');

// ---------- 3. 写文件 ----------

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
// 位置参数要从 argv[2] 起找——argv[0] 是 node 可执行文件、argv[1] 是脚本路径，
// 直接 find() 会把 node 的路径当成输出目录
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const outDir = resolve(outArg || join(ROOT, '..', '_backups'));
mkdirSync(outDir, { recursive: true });

const base = `dengguang-city-db-${stamp}`;
const sqlPath = join(outDir, `${base}.sql`);
const jsonPath = join(outDir, `${base}.json`);

const sqlText = out.join('\n');
const sha = createHash('sha256').update(sqlText).digest('hex');

manifest.sha256 = sha;
writeFileSync(sqlPath, sqlText, 'utf8');
writeFileSync(jsonPath, JSON.stringify(manifest, null, 2), 'utf8');

writeFileSync(
  join(outDir, 'RESTORE.md'),
  `# 还原 dengguang-city 生产 D1

备份时间：${manifest.exported_at}
总行数：${manifest.total_rows}（${manifest.table_count} 张表）
SQL SHA256：\`${sha}\`
API 调用次数：${callCount}

## 方式一：wrangler（推荐，会覆盖现有库）

\`\`\`bash
wrangler d1 execute dengguang-city-db --remote --file "${base}.sql"
\`\`\`

> --remote 会清空并重建目标库。执行前先再导一次当前状态做二次保险。

## 方式二：Dashboard 手动导入

1. Cloudflare Dashboard → Workers & Pages → dengguang-city → D1 → dengguang-city-db
2. Console 或 Import 面板，上传 \`${base}.sql\`
3. 执行

## 还原后自检

逐表对照 \`${base}.json\` 里的行数，确认与生产一致。

## 每张表行数

${manifest.tables.map((t) => `- ${t.name}: ${t.rows}`).join('\n')}
`,
  'utf8'
);

console.error('\n✓ 备份完成');
console.error(`  ${sqlPath}`);
console.error(`  ${jsonPath}`);
console.error(`  ${join(outDir, 'RESTORE.md')}`);
console.error(`\n  ${manifest.table_count} 张表 / ${manifest.total_rows} 行 / ${callCount} 次 API 调用`);
console.error(`  SHA256 ${sha.slice(0, 16)}…`);
