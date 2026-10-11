// 守门：私信评价槽里，客服操作按钮不能和「有用 / 没有解决」挤在同一行。
//
// ── 用户报告的现象（2026-10-11 实测截图）────────────────────────────
// 灯灯个人助手的浮窗宽度是 width:min(420px,calc(100vw - 24px))，也就是
// 420px。扣掉 #thread 的 padding 和 .chat-assistance 的 padding，实际可用
// 宽度约 384px。而评价槽里要排的是五个按钮：
//
//   👍 有用 ≈72px   👎 没有解决 ≈96px   转人工 ≈64px
//   刷新回复 ≈80px  提交工单 ≈80px      合计 ≈392px + 4 个间隙
//
// 384 < 412，所以**必然**换行，而且是稳定地「4 + 1」：
// 最后那个「提交工单」孤零零掉到第二行，看上去像坏掉了。
//
// ── 根因 ─────────────────────────────────────────────────────────────
// chat.css 里这两条是一对：
//
//   #support-actions{display:contents}
//   #support-status>#support-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
//
// 第二条要求父级是 #support-status 才会生效。而 feedback.js 的
// placeSupportActions() 会把这个按钮组**搬出**客服面板、塞进
// `#latest-reply-feedback .reply-feedback .actions`。搬出去之后：
//
//   · 第二条不匹配了 → flex-wrap / gap / margin 全部失效
//   · 第一条仍然匹配（它是纯 id 选择器）→ 按钮被摊平成父容器的直接子项
//
// 结果就是五个按钮一起挤在一个 flex 行里，靠父容器那条 gap:5px 撑着，
// 谁都不换行成组，看起来就是一坨。
//
// ── 修法 ─────────────────────────────────────────────────────────────
// 按钮组待在评价槽里时，给它 flex-basis:100%，让它独占一行：
// 上面一行是「评价这条回复」，下面一行是「客服操作」，各归各的。
// 选择器带两个 id，特异性高于 #support-actions{display:contents}，
// 所以不必依赖书写顺序。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 注意：ROOT 必须是 URL，不能是 fileURLToPath 的产物 —— 下面 new URL(rel, ROOT)
// 才成立。写成路径会得到一串 'Invalid URL'，而且是 10 条一起红，
// 很容易误以为是判据在报警。
const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const SOURCE = 'css/source/chat.css';
const BUILT = 'css/style.css';

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 抓出某个选择器的所有规则体 */
function ruleBodies(css, selector) {
  const flat = stripComments(css).replace(/\s+/g, ' ');
  const out = [];
  const re = new RegExp(`(?:^|[{};])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  let m;
  while ((m = re.exec(flat))) out.push(m[1].trim());
  return out;
}

/** 顶层规则，按出现顺序 */
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
    if (!selector.startsWith('@')) out.push({ selector, body: flat.slice(i + 1, j - 1).trim() });
    i = j - 1;
  }
  return out;
}

for (const file of [SOURCE, BUILT]) {
  test(`${file}：按钮组被搬进评价槽后必须独占一行，不能摊平成同行的按钮`, () => {
    const css = read(file);
    const bodies = ruleBodies(css, '#latest-reply-feedback #support-actions');
    assert.ok(
      bodies.length > 0,
      '找不到 #latest-reply-feedback #support-actions 规则 —— ' +
        '客服操作按钮会退回 display:contents，与「有用/没有解决」挤成一行，' +
        '420px 宽的浮窗里必然 4+1 换行'
    );

    for (const body of bodies) {
      assert.match(body, /display\s*:\s*flex/, '按钮组进评价槽后必须恢复 flex（不能留在 display:contents）');
      assert.match(body, /flex-wrap\s*:\s*wrap/, '按钮组自己也要能换行');
      assert.match(
        body,
        /flex-basis\s*:\s*100%/,
        '缺少 flex-basis:100% —— 不占满一行就还是和评价按钮挤在一起'
      );
    }
  });

  test(`${file}：该规则必须比 #support-actions{display:contents} 特异性更高`, () => {
    const rules = topLevelRules(read(file));
    const moved = rules.find((r) => r.selector === '#latest-reply-feedback #support-actions');
    assert.ok(moved, '规则不存在，判据本身失效了');

    const ids = (sel) => (sel.match(/#[\w-]+/g) || []).length;
    assert.ok(
      ids(moved.selector) > 1,
      `选择器 ${moved.selector} 只有 ${ids(moved.selector)} 个 id，压不过 #support-actions{display:contents}`
    );
  });

  test(`${file}：display:contents 的老规则仍须保留（它在客服面板里还要用）`, () => {
    const bodies = ruleBodies(read(file), '#support-actions');
    assert.ok(
      bodies.some((b) => /display\s*:\s*contents/.test(b)),
      '顺手把 #support-actions{display:contents} 删掉会改变客服面板内的布局，不在本次修复范围'
    );
  });
}

// .actions 的基础规则定义在 components.css，不在 chat.css，所以这条只在构建产物上断言。
// （早先在 chat.css 上也断言过，结果是「找不到 .actions 规则」—— 那是判据写错了作用域，
//   不是产品出问题。判据自己报错和被测代码报错，必须分得清，否则会把测试脚本的
//   bug 记成产品缺陷。）
test('评价槽的 .actions 必须允许换行，否则独占一行也实现不了', () => {
  const bodies = ruleBodies(read(BUILT), '.actions');
  assert.ok(bodies.length > 0, '构建产物里找不到 .actions 规则，判据失效');
  assert.ok(
    bodies.some((b) => /flex-wrap\s*:\s*wrap/.test(b)),
    '父级 .actions 没有 flex-wrap:wrap，flex-basis:100% 不会换到下一行'
  );
});

// ── 判据自身有牙吗 ──────────────────────────────────────────────────
// 上面四条全是「规则存在且长得对」的断言。最容易翻车的是：有人把规则删了
// 或者把选择器改成一个不生效的（比如降成单 id），测试还绿。
// 这里把判据反过来用一次：拿一个**故意写坏**的选择器去查，应当查不到。
test('判据有牙：换成单 id 的选择器必须查不到（否则上面几条都是空转）', () => {
  const css = read(SOURCE);
  assert.equal(ruleBodies(css, '#support-actions').length > 0, true, '对照组：老规则确实能查到');
  assert.equal(
    ruleBodies(css, '#definitely-not-here #support-actions').length,
    0,
    '查一个不存在的选择器却查到了，说明这个匹配器本身是坏的'
  );
});

test('判据有牙：flex-basis 必须真的被检查（写成 flex-basis:99% 也得红）', () => {
  const css = read(SOURCE);
  const bodies = ruleBodies(css, '#latest-reply-feedback #support-actions');
  assert.ok(bodies.length > 0);
  const passes = (b) => /flex-basis\s*:\s*100%/.test(b);
  assert.equal(passes(bodies[0]), true, '当前规则应当通过');
  assert.equal(passes('flex-basis:99%'), false, '99% 不占满整行，判据必须不通过');
  assert.equal(passes('flex-basis:auto'), false, 'auto 同样不行');
});