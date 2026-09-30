// 全站重构的等价性守门。
//
// 背景：v88.6 把整个前端从「手工压缩写法」重写成可读代码，跨了 70 多个文件。
// 这种规模的纯重构最怕的不是写不出新代码，而是**手滑改了某个 HTML 片段
// 或某个导出**，而当场看不出来 —— 要等到线上才发现。
//
// 做法：拿重构前的基线提交（下面 BASELINE）当参照，只对**确实改动过**的文件
// 检查三件事：
//   1. export 名单必须一致（其他文件在 import，改了就断链）
//   2. 模板字符串里的**静态文字**必须一致（HTML 骨架和中文文案）
//   3. HTML 标签开闭配平度的**变化量**必须为 0
//   4. core.js 的纯函数**同时 import 两版实跑**，同批输入输出逐字相同
//
// 三个设计取舍，都是被自己的第一版检查器坑出来的：
//
//   · 只查改动过的文件。旧代码里本来就有标签不配平的地方（<br> <img> <input>
//     这些 void 元素本来就没闭合标签），拿绝对标准去要求未改动的旧文件，
//     会报出一堆「丢了片段」的假警报 —— 而且那个文件根本没被碰过，
//     报告自相矛盾。
//   · 插值切分要数括号。`${(()=>{return 1})()}` 这种插值内部带 `}`，
//     用 `\$\{[^}]*\}` 切会把后半截漏成「静态片段」，同样制造假警报。
//   · 比变化量而不是绝对值。重构只该让代码变可读，标签配平度不该变化；
//     基线里已有的偏差不算在这次重构头上。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

/** 重构前的基线提交 */
const BASELINE = '1654447';

const show = (path) =>
  execSync(`git show ${BASELINE}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 28 });

const read = (p) => readFileSync(p, 'utf8');

/** 基线里有、现在还在、且确实被改动过的前端文件 */
const CHANGED = execSync(`git ls-tree -r --name-only ${BASELINE} -- js/`, { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.js') && existsSync(f) && show(f) !== read(f));

const exportNames = (src) =>
  [...src.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)]
    .map((m) => m[1])
    .sort();

/**
 * 按括号深度切模板字符串，`${...}` 内部**普通**的 `{}` 也不会漏出来。
 * 返回静态片段（插值本身不比 —— 允许重命名和改格式）。
 *
 * 坑：插值里常有箭头函数 `${(()=>{return x})()}`，里面那对裸 `{}`
 * 如果不计数，遇到第一个 `}` 就提前收尾，后半截插值会被当成静态片段，
 * 于是凭空造出「丢了片段」的假警报。
 */
function staticSegments(src) {
  const segs = [];
  const flush = (buf) => {
    const t = buf.trim();
    if (t) segs.push(t);
  };
  for (const m of src.matchAll(/`([^`]*)`/g)) {
    const body = m[1];
    if (!body.includes('<')) continue;
    let buf = '';
    let inInterp = false;
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (!inInterp) {
        if (c === '$' && body[i + 1] === '{') {
          flush(buf); buf = '';
          inInterp = true;
          depth = 1;
          i++;
          continue;
        }
        buf += c;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) inInterp = false;
      }
    }
    flush(buf);
  }
  return segs;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** void 元素：HTML 规范里就没有闭合标签，不参与配平 */
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);

function tagBalance(src) {
  const code = stripComments(src);
  const diff = {};
  for (const m of code.matchAll(/<([a-z][a-z0-9]*)\b(?![^>]*\/>)[^>]*>/g)) {
    if (VOID.has(m[1])) continue;
    diff[m[1]] = (diff[m[1]] || 0) + 1;
  }
  for (const m of code.matchAll(/<\/([a-z][a-z0-9]*)>/g)) {
    if (VOID.has(m[1])) continue;
    diff[m[1]] = (diff[m[1]] || 0) - 1;
  }
  return diff;
}

test(`重构没改任何 export 名单（对照 ${BASELINE}，检查 ${CHANGED.length} 个改动文件）`, () => {
  const problems = [];
  for (const path of CHANGED) {
    const before = exportNames(show(path));
    const after = exportNames(read(path));
    const lost = before.filter((n) => !after.includes(n));
    const added = after.filter((n) => !before.includes(n));
    if (lost.length || added.length) {
      problems.push(`${path}: 少了 [${lost.join(' ')}]，多了 [${added.join(' ')}]`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test(`重构没改任何模板字符串里的静态文字（对照 ${BASELINE}）`, () => {
  const problems = [];
  for (const path of CHANGED) {
    const after = new Set(staticSegments(read(path)));
    const lost = [...new Set(staticSegments(show(path)))].filter((s) => !after.has(s));
    if (lost.length) {
      problems.push(
        `${path}: 丢了 ${lost.length} 段 → ` +
          lost.slice(0, 3).map((s) => JSON.stringify(s.slice(0, 70))).join(' / ')
      );
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test(`重构没改变任何文件的 HTML 标签配平度（对照 ${BASELINE}）`, () => {
  const problems = [];
  for (const path of CHANGED) {
    const before = tagBalance(show(path));
    const after = tagBalance(read(path));
    for (const t of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const delta = (after[t] || 0) - (before[t] || 0);
      if (delta !== 0) {
        problems.push(`${path}: <${t}> 配平度变化 ${delta > 0 ? '+' : ''}${delta}（基线 ${before[t] || 0} → 现在 ${after[t] || 0}）`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('core.js 纯函数两版实跑输出全等', async () => {
  const OLD = 'js/app/_equiv_core_old.js';
  writeFileSync(OLD, show('js/app/core.js'));
  try {
    const oldM = await import(`../${OLD}`);
    const newM = await import('../js/app/core.js');
    const problems = [];
    const INPUTS = [null, undefined, '', 0, false, 'x', '<b>y</b>', 'pending', 'closed',
                    '{"name":"n"}', '{"breakfast":true}', '[]', 'garbage', 'https://a.test/', 'javascript:x'];
    for (const fn of ['text', 'status', 'optionLabel', 'ticketBody', 'empty', 'linkUrl', 'imageUrl', 'date']) {
      if (typeof oldM[fn] !== 'function' || typeof newM[fn] !== 'function') continue;
      for (const input of INPUTS) {
        let a, b;
        try { a = oldM[fn](input); } catch (e) { a = 'THROW:' + e.message; }
        try { b = newM[fn](input); } catch (e) { b = 'THROW:' + e.message; }
        if (a !== b) {
          problems.push(`${fn}(${JSON.stringify(input)}): 旧 ${JSON.stringify(a)} ≠ 新 ${JSON.stringify(b)}`);
        }
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  } finally {
    unlinkSync(OLD);
  }
});
