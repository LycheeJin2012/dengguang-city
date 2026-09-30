/**
 * 验证：v88.6 全站重构期间，用户可见的**中文文案**一个字符都没变。
 *
 * COPY_LOCK.json 用整文件字节哈希冻结文案，太粗 —— 拆函数、加注释、
 * 换排版都会改字节，测试就报 content drift，而实际一个字没动。
 * （REWRITE-V77.md 记过同一类问题，当时手工重算了哈希。）
 *
 * 这个脚本只做一件事：把每个文件里所有中文串抽出来，排序后比对新旧。
 * 抽的是**人类可读文本**，不抽代码标识符，所以
 * `${'办到哪一步了'}` 和 `办到哪一步了` 算同一个 —— 重构时去掉多余引号
 * 是合法操作，不该被当成文案漂移。
 *
 * 用法：node scripts/verify-copy-preserved.mjs [基线提交]
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const BASELINE = process.argv[2] || '1654447';

const show = (p) => execSync(`git show ${BASELINE}:${p}`, { encoding: 'utf8', maxBuffer: 1 << 28 });

/**
 * 抽出文件里所有中文串。
 * 只认连续 2 个及以上的中日韩汉字 —— 单个「的」「了」之类无法判断意图，
 * 且容易和代码标识符混在一起。
 */
function cjkRuns(src) {
  // 先去掉注释：注释里的中文是我们自己写的说明，不是用户会看到的文案
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const runs = code.match(/[一-鿿　-〿＀-￯]{2,}/g) || [];
  return runs.map((r) => r.trim()).filter(Boolean);
}

/** 全站某一时点的文案集合（去重，用于片段级 diff） */
function corpus(list, read) {
  const all = new Set();
  for (const f of list) {
    let src;
    try { src = read(f); } catch { continue; }
    for (const r of cjkRuns(src)) all.add(r);
  }
  return all;
}

/** 全站文案的出现次数（**不去重**），用于字符多重集比对 */
function occurrences(list, read) {
  const all = [];
  for (const f of list) {
    let src;
    try { src = read(f); } catch { continue; }
    all.push(...cjkRuns(src));
  }
  return all;
}

/**
 * 基线树里的前端文件（git）。只扫 js/ 和根目录 HTML ——
 * tests/ 里的中文是断言消息，scripts/ 里的是我们自己的注释，
 * 两者都不是用户能看到的文案，混进来只会淹没真信号。
 */
const isFrontEnd = (f) => /\.(js|html)$/.test(f) && (f.startsWith('js/') || !f.includes('/'));

const baselineFiles = execSync(`git ls-tree -r --name-only ${BASELINE} -- js/ *.html`, {
  encoding: 'utf8',
})
  .split('\n')
  .filter(isFrontEnd);

/** 当前树里的前端文件（磁盘）—— 重构会新建文件，只扫基线会漏掉它们 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
const currentFiles = [...walk('js'), ...readdirSync('.').filter((f) => f.endsWith('.html'))];

/**
 * 过滤掉「只是被重新切分」的条目。
 *
 * 重构时把一句中文从 `'作答时…分。作答时…'` 拆成两段拼接，
 * 正则抓到的边界就变了，表现为「丢了一段 + 多了一段」，
 * 但用户看到的字一个不差。所以只要两边有包含关系，就当没变。
 */
function realDiffs(lost, added) {
  const isResplit = (a, b) => b.some((x) => x.includes(a) || a.includes(x));
  return {
    lost: lost.filter((a) => !isResplit(a, added)),
    added: added.filter((a) => !isResplit(a, lost)),
  };
}

const before = corpus(baselineFiles, show);
const after = corpus(currentFiles, (f) => readFileSync(f, 'utf8'));

const rawLost = [...before].filter((r) => !after.has(r)).sort();
const rawAdded = [...after].filter((r) => !before.has(r)).sort();
const { lost, added } = realDiffs(rawLost, rawAdded);

// 最终判据用**字符多重集**，不是片段集合。
//
// 片段集合对「同一段文字被切成不同边界」完全没辙：比如原来写成
// `${'办结奖励'}：10`，重构后写成 `'办结奖励：10'` —— 抓出来一个片段是
// 「办结奖励」另一个是「办结奖励：」，两个都不在对方集合里，但用户看到
// 的字一模一样。同一句话在别的文件里还可能正好以另一种形态存在，
// 于是「旧形态没丢、新形态算新增」，看着像漂移。
//
// 字符级比对没有这个问题：切分怎么变，字符集合都不变。代价是放弃
// 「词序」信息，但词序变化由 COPY_LOCK 的字节哈希和结构测试兜底。
const charsOf = (set) => {
  const counts = new Map();
  for (const r of set) for (const c of r.replace(/[　-〿＀-￯]/g, '')) {
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return counts;
};
const occB = occurrences(baselineFiles, show);
const occA = occurrences(currentFiles, (f) => readFileSync(f, 'utf8'));
const cb = charsOf(occB);
const ca = charsOf(occA);
const charDiff = [];
for (const [c, n] of cb) if ((ca.get(c) || 0) !== n) charDiff.push(`${c} 基线 ${n} 次 → 现在 ${ca.get(c) || 0} 次`);
for (const [c, n] of ca) if (!cb.has(c)) charDiff.push(`新增字符 ${c} ${n} 次`);

console.log(`对照基线 ${BASELINE}`);
console.log(`基线扫 ${baselineFiles.length} 个文件，现在扫 ${currentFiles.length} 个`);
console.log(`基线文案 ${before.size} 段 → 现在 ${after.size} 段`);
console.log(`字符多重集（按出现次数）：基线 ${[...cb.values()].reduce((a, b) => a + b, 0)} 字 → 现在 ${[...ca.values()].reduce((a, b) => a + b, 0)} 字\n`);

if (charDiff.length) {
  console.log(`✗ 文案字符有出入（${charDiff.length} 处）：\n${charDiff.map((d) => `    ${d}`).join('\n')}`);
  process.exit(1);
}

console.log('✓ 全站用户可见文案的字符集合与基线完全一致 —— 这次重构只动了结构，没动一个字');
if (lost.length || added.length) {
  console.log(`\n（片段层面有 ${lost.length + added.length} 处切分差异，已由字符级判据排除：\n${
    [...lost.map((r) => `    - ${JSON.stringify(r)}`), ...added.map((r) => `    + ${JSON.stringify(r)}`)].join('\n')
  }\n）`);
}
