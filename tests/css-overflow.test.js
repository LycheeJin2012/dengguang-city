// 守门：.table-wrap 不许再出现「盒子卡高 + 内容可见溢出」把页脚画穿。
//
// ── 这个 bug 是什么 ────────────────────────────────────────────────────
// 后台工单列表在窄窗口下，最后几行会「穿过页脚」，压到页脚文字上
// （用户 2026-10-01 实测报告，窗口 CSS 宽度约 960px）。
//
// 根因是一行 CSS：
//
//   .table-wrap{max-width:100%;overflow:visible}      ← v75 引入，写错
//   .table-wrap{overflow:auto; max-height:min(72vh,720px)}   ← 基础规则
//
// 这条 override 写在基础规则**之后**、同特异性，所以 `overflow:visible`
// （**简写**，同时管 x 和 y）把基础规则的 `overflow:auto` 整个盖掉了，
// 而 `max-height:min(72vh,720px)` 还留着。于是：
//
//   盒子高度被 max-height 卡在 230px，内容却是 visible 不裁剪
//   → 表格实际画到 y=2846，而 #footer 的顶在 y=302 —— 压穿 2544px
//
// v75 之前的写法是 `overflow-x:hidden; overflow-x:clip`：只约束**横向**，
// 竖向滚动照旧。改成 `overflow:visible` 等于把「别横向溢出」写成了
// 「别裁剪」，方向都反了。
//
// ── 修法与判据 ────────────────────────────────────────────────────────
// 全局那条改回只管横向：`.table-wrap{min-width:0;max-width:100%;overflow-x:clip}`
// 「窄屏卡片布局不要内层滚动条」这个真实需求，挪进 @media(max-width:1100px)，
// 并且**必须**与 `max-height:none` 成对出现 —— 只写 overflow:visible 而留着
// max-height，就是原来那个 bug。
//
// 实测（本地真浏览器，iframe 造三个视口跑媒体查询）：
//   视口      断点        旧规则                          已修
//   1400px   >1100       overflow:visible → 画穿 2544px   overflow:auto → 不重叠
//   960px    ≤1100       max-height:none   → 不重叠      max-height:none → 不重叠
//   531px    ≤1100       max-height:none   → 不重叠      max-height:none → 不重叠

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const SOURCE = 'css/source/components.css';
const BUILT = 'css/style.css';

/** 把 CSS 里的注释剥掉，免得注释里写的 `overflow:visible` 被当成真规则。 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 抓出某个选择器的所有规则体。简单按分号切，够用且不会因为复杂选择器误配对。
 * @returns {string[]} 每个规则体的声明串
 */
function ruleBodies(css, selector) {
  const flat = stripComments(css).replace(/\s+/g, ' ');
  const out = [];
  const re = new RegExp(`(?:^|[{};])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  let m;
  while ((m = re.exec(flat))) out.push(m[1].trim());
  return out;
}

/**
 * 只抽**顶层**规则（不在任何 @media / @supports 里面），并按出现顺序返回。
 *
 * 为什么必须区分顶层：媒体查询里那条 `.table-wrap{max-height:none;overflow:visible}`
 * 是**有意**的简写，它和 max-height:none 成对出现；而顶层基础规则里的
 * `overflow:auto` 也是**合法**的简写。真正要禁止的是「顶层、且在基础规则
 * 之后又用简写重设 overflow」—— 那正是把 auto 盖掉的动作。
 */
function topLevelRules(css) {
  const flat = stripComments(css).replace(/\s+/g, ' ');
  const out = [];
  let buf = '';
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] !== '{') {
      buf += flat[i];
      continue;
    }
    const selector = buf.trim();
    buf = '';
    let depth = 1;
    let j = i + 1;
    while (j < flat.length && depth) {
      if (flat[j] === '{') depth++;
      else if (flat[j] === '}') depth--;
      j++;
    }
    // at-rule 的整块在这里被一次性吃掉，内部规则不会被记录 —— 正是我们要的
    if (!selector.startsWith('@')) out.push({ selector, body: flat.slice(i + 1, j - 1).trim() });
    i = j - 1;
  }
  return out;
}

/** @media(max-width:1100px){…} 这一段的内容（只取一层，够用）。 */
function media1100(css) {
  const flat = stripComments(css).replace(/\s+/g, ' ');
  const start = flat.indexOf('@media(max-width:1100px){');
  assert.ok(start >= 0, '找不到 @media(max-width:1100px) 断点，判据本身可能失效了');
  let depth = 0;
  for (let i = start + '@media(max-width:1100px){'.length - 1; i < flat.length; i++) {
    if (flat[i] === '{') depth++;
    if (flat[i] === '}' && --depth === 0) return flat.slice(start, i + 1);
  }
  throw new Error('@media(max-width:1100px) 没有闭合');
}

test('.table-wrap 的顶层覆盖规则不得用 overflow 简写盖掉基础规则的 auto', () => {
  for (const file of [SOURCE, BUILT]) {
    const global = topLevelRules(read(file)).filter((r) => r.selector === '.table-wrap');
    assert.ok(global.length >= 1, `${file} 里一条顶层 .table-wrap 规则都没抓到，判据失效`);
    // 第一条是基础规则（overflow:auto + max-height），简写合法。
    // 从第二条起，任何顶层重设都不得再用简写。
    for (const rule of global.slice(1)) {
      assert.equal(
        /(^|[;\s])overflow\s*:/.test(rule.body),
        false,
        `${file}: 顶层第 ${global.indexOf(rule) + 1} 条 .table-wrap 用了 overflow 简写 —— ` +
          `它出现在基础规则之后，会把 overflow:auto 盖掉，而 max-height 还在，` +
          `结果就是内容画穿页脚。要表达「只管横向」请写 overflow-x。\n  规则体：${rule.body}`
      );
    }
  }
});

test('基础规则本身仍然是 auto + max-height（内层滚动与上限都在）', () => {
  // 若有人把 max-height 删掉，桌面端就会变成一张无限长的表；
  // 若有人把 overflow 改成 hidden，会让 sticky 表头失去滚动容器。
  const body = topLevelRules(read(SOURCE)).find(
    (r) => r.selector === '.table-wrap' && /max-height\s*:/.test(r.body)
  );
  assert.ok(body, '基础规则里的 max-height 不见了');
  assert.match(body.body, /overflow\s*:\s*auto/, '基础规则应当保留 overflow:auto');
  assert.match(body.body, /max-height\s*:\s*min\(72vh,\s*720px\)/, 'max-height 上限被改了，确认是有意为之');
});

test('≤1100px 断点里 max-height:none 与 overflow:visible 必须成对出现', () => {
  for (const file of [SOURCE, BUILT]) {
    const block = media1100(read(file));
    const body = ruleBodies(block, '.table-wrap')[0];
    assert.ok(body, `${file}: ≤1100px 断点里找不到 .table-wrap 规则 —— 窄屏会退回内层滚动条`);
    assert.match(body, /max-height\s*:\s*none/, `${file}: 断点里必须解除 max-height`);
    assert.match(body, /overflow\s*:\s*visible/, `${file}: 断点里应放行 overflow`);
  }
});

test('判据自检：简写检测必须能抓到真正的简写，放过显式轴向', () => {
  const bad = 'min-width:0;max-width:100%;overflow:visible';
  assert.equal(/(^|[;\s])overflow\s*:/.test(bad), true, '裸 overflow 简写必须被抓到');

  const good = 'min-width:0;max-width:100%;overflow-x:clip';
  assert.equal(/(^|[;\s])overflow\s*:/.test(good), false, 'overflow-x 不该被误判成简写');

  const goodY = 'max-height:340px;overflow-y:auto';
  assert.equal(/(^|[;\s])overflow\s*:/.test(goodY), false, 'overflow-y 不该被误判成简写');

  // 顶层提取器：媒体查询里的规则不算顶层，注释里的伪规则要剥掉
  const css =
    '/* .table-wrap{overflow:visible} 注释 */\n' +
    '.table-wrap{overflow:auto;max-height:1px}\n' +
    '@media(max-width:1100px){.table-wrap{max-height:none;overflow:visible}}\n' +
    '.table-wrap{min-width:0;overflow-x:clip}';
  const top = topLevelRules(css).filter((r) => r.selector === '.table-wrap');
  assert.equal(top.length, 2, '顶层只应有两条（媒体查询里那条不算）');
  assert.equal(/(^|[;\s])overflow\s*:/.test(top[0].body), true, '基础规则用简写是合法的');
  assert.equal(/(^|[;\s])overflow\s*:/.test(top[1].body), false, '覆盖规则用简写才是 bug');
});
