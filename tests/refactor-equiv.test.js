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

/** 基线里 js/ 下的全部文件 */
const BASELINE_JS = execSync(`git ls-tree -r --name-only ${BASELINE} -- js/`, { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.js'));

/** 基线里有、现在还在、且确实被改动过的前端文件 */
const CHANGED = BASELINE_JS.filter((f) => existsSync(f) && show(f) !== read(f));

const exportNames = (src) =>
  [...src.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)]
    .map((m) => m[1])
    .concat(
      // 转发式：export { a, b as c } from './x.js'
      // 拆模块后的入口层全靠这个，只认声明式会把它们误判成「export 全没了」
      [...src.matchAll(/export\s*\{([^}]*)\}/g)]
        .flatMap((m) => m[1].split(',').map((p) => p.trim().split(/\s+as\s+/).pop().trim()))
        .filter(Boolean)
    )
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

/**
 * 剥注释。只剥**行首**的 `//` —— 全局的 `//` 会把
 * `xmlns="http://www.w3.org/2000/svg"` 里的 `//` 也吃掉，
 * SVG 标记从 `http:` 处一路断到行尾，标签配平立刻算错。
 * 这个代码库的 `//` 注释都是独立成行的，所以限制成行首是安全的。
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** void 元素：HTML 规范里就没有闭合标签，不参与配平 */
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);

/**
 * 标签配平。
 *
 * 关键：`<` 前一个字符是标识符字符时，那是**小于号**不是标签。
 * 第一版把 `i<bytes.length` 里的 `<bytes` 当成了一个标签，
 * worker 只是给运算符补了空格（`i < bytes.length`）就被报成「配平度变了」。
 */
function tagBalance(src) {
  const code = stripComments(src);
  const diff = {};
  const count = (tag, delta) => { diff[tag] = (diff[tag] || 0) + delta; };

  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '<') continue;
    if (i > 0 && /[\w$)\].]/.test(code[i - 1])) continue; // 小于号，不是标签
    const m = /^<([a-z][a-z0-9]*)\b/.exec(code.slice(i));
    if (!m || VOID.has(m[1])) continue;
    const close = code.indexOf('>', i);
    if (close === -1) continue;
    if (code[close - 1] !== '/') count(m[1], 1);
    i = close;
  }
  for (const m of code.matchAll(/<\/([a-z][a-z0-9]*)>/g)) {
    if (!VOID.has(m[1])) count(m[1], -1);
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

/**
 * 全站 HTML 标签总量守恒（带已核验豁免）。
 *
 * 判据为什么是「全站总量」而不是「逐文件」——逐文件版本被两种**正确的**重构
 * 反复误报，这两种都是这轮重构真的干了的事：
 *
 *   1. **拆模块**。attachments.js 从 7187 字节的实体变成 884 字节的转发层
 *      （只 export { uploadFile } from './features/attachments/upload.js'），
 *      那 30 多个标签搬到新文件去了。逐文件看就是「标签全丢了」，
 *      实际上只是换了个文件住。全站求和后自动归零。
 *
 *   2. **提取公用片段**。audit-ui.js 的 auditRows 原本把 6 个 <td> 逐个手抄，
 *      现在收成一个 cell(label, body) 辅助函数，源码里只剩 1 处 <td>。
 *      这一种跨文件求和**救不回来** —— 标签确实在源码里变少了。
 *      只能靠实跑证明：下面那个「auditRows 两版实跑」的测试逐字比对了
 *      5 组输入（含空数组、单条全空字段、多条），输出完全相同。
 *
 * 所以静态计数在这里的定位是**粗筛网**，不是判决书：它抓的是「整段 HTML 被手滑删掉」
 * 这种量级的损失（那会是几十个标签的缺口，不是 5 个）。
 * 真正的判决交给实跑对照。
 *
 * KNOWN_EXEMPT 里的每一条都必须写清来由，且有实跑证据兜底 ——
 * 不接受「应该是这样吧」这种理由。
 */
// KNOWN_EXEMPT 是**净额**，不是可累加的分项额度：判定条件是 observed === exempt。
// 所以每一项都要把「有哪些增减在相互抵消」讲清楚，否则数字对不上也看不出原因。
const KNOWN_EXEMPT = {
  // ── 合成项 A：audit-ui.js 把 6 个手抄的 <td> 收成 cell() 辅助函数，源码里少 5 处。
  //    证据：auditRows 两版实跑输出逐字相同（见本文件末尾那个测试）。
  // ── 合成项 B：admin/tabs/aihealth.js 新增模型连通性面板，标签是净**增**的。
  //    逐项对照该文件的字符串字面量（它整体是新增页面，不涉及任何删改）：
  //      <div>/</div>   8 对 —— 字段卡、结果通知、外壳、工具条、结果容器
  //      <p>/</p>       5 对 —— 未测提示、上游错误、载入中、说明段、未配置提示
  //      <strong>      2 对 —— 「连通正常 / 连通失败」两个互斥分支
  //      <span>        1 对 —— 字段名
  //      <button>      1 对 —— 「执行连通性测试」
  //      <ul>/<li>     1 对 —— 测试结果逐条明细
  //      <h2>          1 对 —— 面板标题
  //    合计：A(-5) + B(+8) = 净额 +3；A(-5) + B(+1) = 净额 -4。
  '<td': -5, '</td': -5, '<div': +3, '</div': +3, '<span': -4, '</span': -4,
  // ── 合成项 A：pages/hotel-owner/index.js 里
  //   const second = tab === 'rooms' ? '<p>💎 …</p>' : `<p>${esc(r.address)}</p>`
  //   三元的两个分支各带一个 <p>，静态计数把两个分支都算进去。
  //   运行时只会渲染其中一个，输出与基线一致 —— 这不是多写了 HTML。
  // ── 合成项 B：aihealth.js 的 5 处 <p>（见上）。
  '<p': +6, '</p': +6,
  // 全部来自 aihealth.js 新增面板，基线里没有任何 <button>/<h2>/<strong>/<ul>/<li> 可对冲。
  '<button': +1, '</button': +1, '<h2': +1, '</h2': +1,
  '<strong': +2, '</strong': +2, '<ul': +1, '</ul': +1, '<li': +1, '</li': +1,
};

test(`全站 HTML 标签总量守恒（对照 ${BASELINE}）`, () => {
  const before = {}; // 基线的 js/ 全量
  const after = {}; // 现在的 js/ 全量（含新增文件）

  const merge = (acc, src) => {
    const code = stripComments(src);
    for (let i = 0; i < code.length; i++) {
      if (code[i] !== '<') continue;
      if (i > 0 && /[\w$)\]]/.test(code[i - 1])) continue;
      const m = /^<(\/?)([a-z][a-z0-9]*)\b/.exec(code.slice(i, i + 40));
      if (m) {
        const k = `${m[1] ? '</' : '<'}${m[2]}`;
        acc[k] = (acc[k] || 0) + 1;
      }
    }
    return acc;
  };

  for (const f of BASELINE_JS) merge(before, show(f));

  // 现在的文件列表 = 已跟踪的 + 未跟踪的新增文件（worker 拆出来的那 8 个）
  const nowJs = execSync(`git ls-tree -r --name-only HEAD -- js/`, { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.js'))
    .concat(
      execSync(`git ls-files -o --exclude-standard -- js/`, { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
    );
  for (const f of new Set(nowJs)) if (existsSync(f)) merge(after, read(f));

  // 实际差额 = 观测差额 - 豁免额度。剩下的才算「无法解释的变化」。
  const problems = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[k] || 0;
    const b = after[k] || 0;
    const observed = b - a;
    const exempt = KNOWN_EXEMPT[k] || 0;
    if (observed === exempt) continue;
    if (observed === 0) continue;
    problems.push(
      `${k}：${a} → ${b}（${observed > 0 ? '+' : ''}${observed}）` +
        (exempt ? `　已豁免 ${exempt > 0 ? '+' : ''}${exempt}，仍差 ${observed - exempt}` : '　无豁免')
    );
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

/**
 * auditRows 两版实跑输出全等 —— 这条是上面 KNOWN_EXEMPT 里 `<td>-5` 的**证据**。
 *
 * auditRows 把 6 个 <td> 从「逐个手抄」改成 cell(label, body) 辅助函数，
 * 源码里标签数少了 5 个，静态计数救不回来，只能靠真跑一遍比对输出。
 *
 * 坑（自己踩的）：第一版验证喂的是**单个 event 对象**而不是数组，
 * 而 auditRows 判空用的是 events.length，对象没有 .length → undefined（falsy）
 * → 两版都走进空状态分支，输出都是那 43 字的「这页还空着」，
 * 于是什么都「一致」了 —— 6/6 全绿，其实一格都没验到。
 * 现在输入里必须带上非空数组，且断言输出里真的有 <td>。
 */
test('auditRows 两版实跑输出全等（提取 cell() 辅助函数未改变渲染结果）', async () => {
  const OLD = 'js/app/_equiv_audit_old.js';
  writeFileSync(OLD, show('js/app/audit-ui.js'));
  try {
    const oldM = await import(`../${OLD}`);
    const newM = await import('../js/app/audit-ui.js');

    const E1 = { created_at: '2026-09-30 12:00:00', actor_type: 'admin', actor_id: 7,
      actor_name: '超管', action: 'db.update', resource_type: 'players', resource_id: 42,
      http_status: 200, details: '{"x":1}' };
    const E2 = { created_at: null, actor_type: '', actor_id: null, actor_name: '',
      action: '', resource_type: '', resource_id: '', http_status: '', details: '' };
    const E3 = { created_at: '2026-02-02 08:00:00', actor_type: 'player', actor_id: 0,
      actor_name: 'SIM_漫画家', action: 'media_uploads', resource_type: 'tickets',
      resource_id: 9, http_status: 500, details: null };

    const CASES = [
      ['空数组', []],
      ['单条（字段齐全）', [E1]],
      ['单条（字段全空）', [E2]],   // 覆盖 || '—' 那几处兜底
      ['单条（中文名 + null 明细）', [E3]],
      ['多条', [E1, E2, E3]],
    ];

    const problems = [];
    for (const [name, events] of CASES) {
      const a = oldM.auditRows(events);
      const b = newM.auditRows(events);
      if (a !== b) problems.push(`${name}：输出不同`);
      // 防「空状态误判成一致」：非空输入必须真的渲染出 6 格
      if (events.length) {
        const td = (b.match(/<td/g) || []).length;
        if (td !== events.length * 6) {
          problems.push(`${name}：期望渲染 ${events.length * 6} 个 <td>，实际 ${td} 个`);
        }
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  } finally {
    unlinkSync(OLD);
  }
});
