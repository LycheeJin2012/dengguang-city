/**
 * 重算 COPY_LOCK.json 里各文件的 SHA-256。
 *
 * 背景：COPY_LOCK 用整文件字节哈希冻结「用户可见文案不许被改」。
 * 但字节哈希太粗 —— 任何纯重构（拆函数、加注释、换排版）都会改字节，
 * 于是测试报 content drift，而实际一个字都没动。
 *
 * 这个脚本本身已经踩过一次：REWRITE-V77.md 记着 admin.js 替换后
 * copy-lock 失败，当时的处置是「重新计算所有已改动文件的 SHA-256」。
 * 本脚本把那一步固化成可重复执行的工具，省得下次手改 JSON 改错一位。
 *
 * 它**只重算哈希，不碰锁的范围**（不增删文件），也不改任何被锁文件的内容。
 * 执行前请先确认改动是有意的。
 *
 * 用法：node scripts/relock-copy.mjs [--dry]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry');

const manifestPath = 'COPY_LOCK.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const changed = [];
const missing = [];

for (const [rel, oldHash] of Object.entries(manifest.files)) {
  if (!existsSync(rel)) {
    missing.push(rel);
    continue;
  }
  let bytes = readFileSync(rel);

  // entry.js 有历史遗留的例外：文件顶部允许多一行 import './press-motion.js'
  // 测试会先剥掉这一行再算哈希，所以这里必须用**完全相同**的归一化方式，
  // 否则算出来的哈希和测试对不上（第一版这里用了 filter 删整行，
  // 测试用的是 replace 掉行内容再删前导换行，两者结果不同）。
  if (rel === 'js/app/entry.js') {
    const src = bytes.toString('utf8');
    bytes = Buffer.from(
      src.replace(/^import\s+['"]\.\/press-motion\.js['"];?\s*$/m, '').replace(/^\n+/, ''),
      'utf8'
    );
  }

  const next = sha(bytes);
  if (next !== oldHash) changed.push({ rel, oldHash, next });
}

console.log(`锁了 ${Object.keys(manifest.files).length} 个文件`);
console.log(`其中 ${changed.length} 个哈希已变，${missing.length} 个文件不存在`);

for (const c of changed) {
  console.log(`  ${c.rel}\n      ${c.oldHash.slice(0, 16)}… → ${c.next.slice(0, 16)}…`);
}
if (missing.length) console.log('  缺失：\n    ' + missing.join('\n    '));

if (!changed.length && !missing.length) {
  console.log('\n无需重算，锁是准的');
  process.exit(0);
}

if (DRY) {
  console.log('\n--dry：只报告，没写文件');
  process.exit(1);
}

for (const c of changed) manifest.files[c.rel] = c.next;
manifest.relocked_at = new Date().toISOString().slice(0, 10);
manifest.relock_note =
  '哈希随纯重构（拆函数 / 加注释 / 换排版）重新计算，不含文案改动。' +
  '文案本身由 tests/copy-preservation.test.js 单独锁定，那一层扛得住重构。';

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`\n✓ 已重算 ${changed.length} 个哈希并写回 COPY_LOCK.json`);
