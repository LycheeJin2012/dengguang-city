// 守门：全站代码不得被重新压回一行。
//
// 背景：v88.6 之前，这个仓库的 js/ 是手工压缩写法（一句里塞 6~14 个语句）。
// v88.6 起做了一轮全站去压缩重写，但**没有任何测试守着这件事** ——
// 以后任何人「顺手压一下」「省两行」，全站 300+ 个测试照样全绿。
// 这个文件就是那道缺失的守门。
//
// ── 判据：为什么不能只看行长 ──────────────────────────────────────────────
// 只看行长会有两类无法区分的误报：
//   1. 一条合法的长模板 / 长 SQL / 长 innerHTML（剥掉字符串后代码长度为 0）
//   2. 正常格式化但写得长的代码（`css/source/workspaces.css` 有 468 字符的行，
//      而那是完全正常的 CSS 格式）
// 所以判据落在「**一句话里塞了几个语句**」上：
//
//   1) 先把注释、字符串字面量、模板字面量、正则字面量**原地替换成等长空白**，
//      保留换行。剩下留在行里的标点，才真的属于代码。
//   2) 数**语句终止符 `;`**。JavaScript 里每个表达式语句都以 `;` 收尾，
//      「一行 N 个语句」就等于「一行 N-1 个多余的 `;`」。
//      阈值 `>= 2` 即为可疑 —— 单语句行再长也只贡献 1 个 `;`。
//   3) 两处反例必须先消掉，否则全是假警报：
//        · `for (let i = 0; i < n; i += k) {` —— for 头部那 2 个 `;`
//          不是语句终止符。识别方式是回看 `(` 前面的关键字是不是 `for`。
//        · 纯字面量行 —— 替换后代码长度为 0，是一条长模板/SQL/innerHTML，
//          直接跳过。
//
// ── 为什么 CSS 不适用（必须排除，实测过不是借口）─────────────────────────
// 一条 CSS 规则本身就含 `;` 和 `{}`，这是语法要求，不是压缩。
// 把上面这条判据原样套到 CSS 上，css/style.css 会报出 **190 个假警报**
// （1485 行里有 190 行 `;` >= 2，全是正常的多声明规则）。
// 换成 CSS 自己的类比判据「一行出现 >= 2 个规则块 `{`」也一样不可用：
// 本仓库习惯把兄弟规则并排写，全站立刻多出 74 处正常写法。
// 结论：css/、shared/ 直接排除在扫描范围外。这不是放过它们 ——
// 它们在当前树上按同一条判据实测 **0 处**违规，没有东西被藏起来。
//
// ── 扫描范围（以及为什么不扫别的）────────────────────────────────────────
//   js/**.js    —— 发到浏览器的前端主体，本轮去压缩的对象
//   sw.js       —— Service Worker，也发到浏览器
//   *.html      —— 只取**内联** <script>（不带 src 的）。当前 13 个页面
//                  内联脚本数为 0，所以这条是空跑；留着是为了以后有人
//                  往 HTML 里塞一段压缩脚本时也能被抓到。
// 不扫：
//   functions/  —— 后端，是另一条去压缩工作线（且明确不属本次范围）
//   scripts/    —— 开发工具，不发给用户；且里面 8 处
//                  `if (cond) { a; b; }` 守卫式一行两句是**正常写法**，
//                  会把判据阈值顶穿
//   tests/      —— 本仓库的测试是**故意**写成高密度表格式的
//                  （tests/frontend.test.js 第 4 行就有约 20 个语句），
//                  拿它当反面教材等于禁掉一种刻意的风格
//   css/        —— 见上，实测 0 处
//
// ── 白名单 ───────────────────────────────────────────────────────────────
// 每一条都必须写明豁免理由，没有理由的条目请直接删掉。
// 条目用「文件 + 该 offending 行里必须出现的片段」来匹配，而不是行号：
//   · 行号会被别人插一行就打乱；
//   · 片段匹配保证豁免只能落在**那一句**上，不会顺手放过同一个文件里
//     将来新出现的另一行压缩代码。
// 条目失效（重写后那条不再违规）不算失败，只在诊断里报一下 —— 因为并发
// 改动是常态，一个失效的豁免意味着「这里已经没有压缩代码了」，是个好消息。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const readRoot = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

/**
 * 把注释 / 字符串 / 模板字面量 / 正则字面量原地替换成等长空白。
 * 长度和换行都保持不变 —— 这样报出来的行号仍然指向真实文件里的那一行。
 */
function blankLiterals(src) {
  const out = src.split('');
  const blank = (i) => { if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  let prevSig = ''; // 上一个非空白字符，用于判断 `/` 是正则还是除号
  const regexAllowed = () => prevSig === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prevSig);

  while (i < src.length) {
    const ch = src[i];
    const nxt = src[i + 1];
    if (ch === '\n') { prevSig = '\n'; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

    // 行注释
    if (ch === '/' && nxt === '/') { while (i < src.length && src[i] !== '\n') { blank(i); i++; } continue; }
    // 块注释
    if (ch === '/' && nxt === '*') {
      blank(i); i++; blank(i); i++;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; }
      if (i < src.length) { blank(i); i++; blank(i); i++; }
      continue;
    }
    // 单双引号字符串
    if (ch === '"' || ch === "'") {
      const quote = ch;
      blank(i); i++; prevSig = '"';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\n') break; // 没闭合，放弃这一行
        if (src[i] === '\\') { blank(i); i++; if (i < src.length) { blank(i); i++; } continue; }
        blank(i); i++;
      }
      if (i < src.length && src[i] === quote) { blank(i); i++; }
      continue;
    }
    // 模板字面量：字面量部分整段屏蔽，但 ${...} 里的**代码**要留着，
    // 否则 `${a ? 1 : 2}` 这种真语句会被误当成纯字面量行。
    if (ch === '`') {
      blank(i); i++; prevSig = '`';
      let depth = 0;
      while (i < src.length) {
        if (src[i] === '\n' && depth === 0) break;
        if (src[i] === '\\') { blank(i); i++; if (i < src.length) { if (depth === 0) blank(i); i++; } continue; }
        if (depth === 0 && src[i] === '`') { blank(i); i++; break; }
        if (depth === 0 && src[i] === '$' && src[i + 1] === '{') { blank(i); i++; blank(i); i++; depth = 1; continue; }
        if (depth > 0) {
          if (src[i] === '{') depth++;
          if (src[i] === '}') { depth--; if (depth === 0) { blank(i); i++; continue; } }
          i++; continue;
        }
        blank(i); i++;
      }
      continue;
    }
    // 正则字面量
    if (ch === '/' && regexAllowed()) {
      let j = i + 1, closed = false, inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) { for (let k = i; k <= j; k++) blank(k); i = j + 1; prevSig = '/'; continue; }
    }
    if (!/\s/.test(ch)) prevSig = ch;
    i++;
  }
  return out.join('');
}

/**
 * 数一行的语句终止符。for 头部的两个 `;` 不算 —— 它们分隔的是
 * 初始化 / 条件 / 步进，不是三条语句。
 */
function countStatementSemis(line) {
  let paren = 0;
  let semis = 0;
  let i = 0;
  const forHeaders = new Set();
  while (i < line.length) {
    const ch = line[i];
    if (ch === '(') {
      paren++;
      let j = i - 1;
      while (j >= 0 && /\s/.test(line[j])) j--;
      const end = j + 1;
      while (j >= 0 && /[A-Za-z]/.test(line[j])) j--;
      if (line.slice(j + 1, end) === 'for') forHeaders.add(paren);
      i++;
      continue;
    }
    if (ch === ')') { paren = Math.max(0, paren - 1); i++; continue; }
    if (ch === ';') { if (!forHeaders.has(paren)) semis++; i++; continue; }
    i++;
  }
  return semis;
}

/** 阈值：一行里有 2 个以上语句终止符，就不是正常排版了 */
const SUSPECT = 2;

/**
 * 扫一个 JS 源码，返回被判定为「压成一行」的行。
 * @param {string} src 源码
 * @param {number} lineOffset 行号偏移（HTML 内联脚本用）
 */
export function findCompressedLines(src, lineOffset = 0) {
  const blanked = blankLiterals(src).split('\n');
  const raw = src.split('\n');
  const hits = [];
  for (let i = 0; i < blanked.length; i++) {
    // 剥掉字面量后整行为空 = 一条长模板 / 长 SQL / 长 innerHTML，不是压缩
    if (blanked[i].replace(/\s/g, '') === '') continue;
    const semis = countStatementSemis(blanked[i]);
    if (semis >= SUSPECT) {
      hits.push({ line: i + 1 + lineOffset, semis, length: raw[i].length, text: raw[i].trim() });
    }
  }
  return hits;
}

// ── 收集被扫文件 ──────────────────────────────────────────────────────────

const walk = (rel, out = []) => {
  for (const name of readdirSync(new URL(rel, ROOT))) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    if (statSync(new URL(rel + name, ROOT)).isDirectory()) walk(rel + name + '/', out);
    else out.push(rel + name);
  }
  return out;
};

const JS_FILES = walk('js/').filter((f) => f.endsWith('.js'));
const HTML_FILES = readdirSync(new URL('.', ROOT)).filter((f) => f.endsWith('.html'));

// ── 显式白名单 ────────────────────────────────────────────────────────────

const WHITELIST = [
  // ── js/app/reply-feedback.js / js/app/security.js：并发 agent 正在改 ──────
  { file: 'js/app/reply-feedback.js', contains: 'export function feedbackMarkup(', reason: '并发 agent 正在重写此文件（不属于本 worker 的范围）；重写后本条会自行失效并在诊断里报出' },
  { file: 'js/app/reply-feedback.js', contains: 'export function bindFeedback(', reason: '同上：bindFeedback 全函数压在一行（806 字符）' },
  { file: 'js/app/security.js', contains: "action=passkey-test-start", reason: '并发 agent 正在重写此文件（本 worker 不得触碰）；webauthn passkey 注册流程压成一行' },
  { file: 'js/app/security.js', contains: 'let cred;try{', reason: '同上：passkey 断言 try/catch 压成一行' },

  // ── sw.js：常驻豁免 ─────────────────────────────────────────────────────
  { file: 'sw.js', contains: "self.addEventListener('fetch'", reason: '常驻豁免：Service Worker 的 fetch 处理器是一条 409 字符的单行快路径。它被 tests/frontend.test.js 引用且整段是缓存语义，压缩是有意为之；本 worker 无权改 sw.js。实测行为被 frontend.test.js 的「never intercepts HTML/auth/API」覆盖' },
];

/** 白名单条目必须写理由 —— 防止以后有人光加豁免不写来由 */
test('白名单每一条都写明了豁免理由', () => {
  const noReason = WHITELIST.filter((w) => !w.reason || !w.reason.trim()).map((w) => `${w.file} :: ${w.contains}`);
  assert.deepEqual(noReason, [], '这些豁免没写理由，补上或删掉：\n' + noReason.join('\n'));
  const dupes = WHITELIST.map((w) => `${w.file} :: ${w.contains}`).filter((v, i, a) => a.indexOf(v) !== i);
  assert.deepEqual(dupes, [], '白名单有重复条目：\n' + dupes.join('\n'));
});

/** 主守门：扫描范围内的代码没有被压回一行 */
test('全站前端代码没有重新被压成一行', (t) => {
  const offenders = [];
  for (const rel of [...JS_FILES, 'sw.js']) {
    for (const hit of findCompressedLines(readRoot(rel))) {
      const hit2 = { ...hit, file: rel };
      const exempt = WHITELIST.find((w) => w.file === rel && hit.text.includes(w.contains));
      if (!exempt) offenders.push(hit2);
    }
  }
  // HTML：只看内联脚本（不带 src）
  for (const rel of HTML_FILES) {
    const html = readRoot(rel);
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const offset = html.slice(0, m.index).split('\n').length - 1;
      for (const hit of findCompressedLines(m[1], offset)) {
        if (!WHITELIST.some((w) => w.file === rel && hit.text.includes(w.contains))) {
          offenders.push({ ...hit, file: rel });
        }
      }
    }
  }

  // 失效的豁免（重写后那条不再违规）只在诊断里报，不算失败
  const used = new Set();
  for (const rel of [...JS_FILES, 'sw.js']) {
    for (const hit of findCompressedLines(readRoot(rel))) {
      const exempt = WHITELIST.find((w) => w.file === rel && hit.text.includes(w.contains));
      if (exempt) used.add(exempt);
    }
  }
  for (const w of WHITELIST) {
    if (!used.has(w)) t.diagnostic(`白名单条目已失效（该行不再违规，可删）：${w.file} :: ${w.contains}`);
  }

  assert.deepEqual(
    offenders.map((o) => `${o.file}:${o.line}（${o.semis} 个语句 / ${o.length} 字符）  ${o.text}`),
    [],
    '以下代码把多条语句压进了一行：\n' +
      offenders.map((o) => `  ${o.file}:${o.line}  ${o.semis} 个语句 / ${o.length} 字符\n    ${o.text}`).join('\n')
  );
});

/**
 * 自检：判据本身必须能抓到东西。
 * 没有这条，判据哪天写坏了（比如屏蔽逻辑漏了某种字面量），
 * 上面那条守门会安安静静地永远绿 —— 假绿比不绿更贵。
 */
test('判据自检：合成的压缩行必须被抓到，正常行必须放过', () => {
  const bad = findCompressedLines([
    "const a=document.createElement('p');a.textContent='x';a.id='y';a.hidden=true;",
    "launcher.onclick=async()=>{if(!p.hidden){close();return;}p.hidden=false;focus();};",
  ].join('\n'));
  assert.equal(bad.length, 2, '两条合成压缩行都该被抓到');

  const good = findCompressedLines([
    "const a = document.createElement('p');",
    'for (let i = 0; i < bytes.length; i += CHUNK) {',
    'try { animate.cancel(); } catch (_) {}',
    'export function f(a, { b = 1 } = {}) {',
    'panel.innerHTML = "<header><strong>灯灯</strong></header><div></div>";',
    '  // 只是注释；{}[;];();',
    'const t = `很长的模板 ${a ? 1 : 2} 结束`;',
  ].join('\n'));
  assert.deepEqual(good.map((g) => g.line), [], '正常排版一行都不该被抓到');
});
