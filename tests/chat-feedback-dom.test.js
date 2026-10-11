// 守门：私信评价槽（js/app/features/chat/feedback.js）的节点搬移。
//
// 这条来自线上真实报错：灯灯助手浮窗显示
//   "The operation would yield an incorrect node tree." + 「再试一次」
// 每当灯灯发来一条**新的、可评价的**回复时必现。
//
// 根因是 v88.6 那次拆模块时打错了一个选择器：
//   重构前  const controls = $('#support-actions', box)
//             if (controls) $('#support-status', box).append(controls)
//   重构后  const controls = $('#support-status', box)   ← ← 抄错了
//             if (controls) $('#support-status', box).append(controls)
// 于是变成「把 #support-status 塞进 #support-status 自己肚子里」，
// DOM 规范直接抛 HierarchyRequestError，被 region() 的 catch 接住，
// 渲染成上面那块错误面板 —— 整个聊天区变成不可用。
//
// 为什么测试要自己造 DOM：真实浏览器里没法跑单测，而**这条 bug 的全部内容
// 就是一条 DOM 语义**。所以桩 DOM 必须老实实现那条硬约束：
// append 一个「自己或自己的子孙」就抛同样的错。桩若没有这条规则，
// 这个测试会量出一片假绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = readFileSync(ROOT + 'js/app/features/chat/feedback.js', 'utf8');

const PLAYER = 7;

/**
 * 极简元素。刻意只实现 feedback.js 真正用到的那几个成员，
 * 以及那条「节点不能进自己或子孙」的硬约束 —— 别的都不重要。
 */
function el(tag = 'div', id = '') {
  const node = {
    tag,
    id,
    children: [],
    parent: null,
    textContent: '',
    set innerHTML(v) {
      this._html = v;
      // 真实 innerHTML 赋值会重建整棵子树 —— 这正是那段「先搬走再重画」存在的原因
      this.children = [];
      for (const child of hooks.parse(v)) {
        child.parent = this;
        this.children.push(child);
      }
    },
    get innerHTML() {
      return this._html || '';
    },
    append(...nodes) {
      for (const n of nodes) {
        // ↓↓↓ 这一条是本测试的全部价值所在 ↓↓↓
        // 真实 DOM 的规则是「不能把节点塞进它自己、或它的**祖先**里」——
        // 反了会变成「子节点不能往父节点里搬」，那是合法的移动，会量出假红。
        // 反向检查：n 是 this 的祖先（含自己）时，搬进去就成环了。
        if (n === this || n.contains(this)) {
          const err = new Error('The operation would yield an incorrect node tree.');
          err.name = 'HierarchyRequestError';
          throw err;
        }
        n.parent = this;
        this.children = this.children.filter((c) => c !== n);
        this.children.push(n);
      }
    },
    contains(n) {
      if (n === this) return true;
      return this.children.some((c) => c.contains(n));
    },
  };
  return node;
}

/** innerHTML 解析的替身：只认一个约定的槽位标记 */
const hooks = {
  parse(html) {
    if (!html.includes('reply-feedback')) return [];
    const actions = el('div');
    actions.className = 'actions';
    const wrap = el('div');
    wrap.className = 'reply-feedback';
    wrap.children = [actions];
    // 让 $ 能按真代码里的复合选择器找到它
    hooks.onParse?.(wrap, actions);
    return [wrap];
  },
};

/** 加载 feedback.js，把三个依赖换成桩 */
async function loadFeedback(dom) {
  const context = vm.createContext({
    console,
    document: { activeElement: null },
    Element: function Element() {},
  });
  const mk = (exports, ident = 'stub') =>
    new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
    }, { context, identifier: ident });

  const dom_ = mk(dom);
  const fb = mk({
    feedbackMarkup: () => '<div class="reply-feedback"></div>',
    bindFeedback: () => {},
  }, 'reply-feedback');
  const thread = mk({ isTypingHere: () => false }, 'thread');

  const mod = new vm.SourceTextModule(SRC, { context, identifier: 'feedback' });
  await mod.link((specifier) => {
    if (specifier === '../../core.js') return dom_;
    if (specifier === '../../reply-feedback.js') return fb;
    if (specifier === './thread.js') return thread;
    throw new Error('意外依赖: ' + specifier);
  });
  await mod.evaluate();
  return mod.namespace;
}

/** 搭出线上报错时的真实场景 */
function scenario() {
  const supportStatus = el('div', 'support-status');
  const feedbackSlot = el('div', 'latest-reply-feedback');
  const actionsSlot = el('div');            // #support-actions，初始在客服面板里
  actionsSlot.id = 'support-actions';
  actionsSlot.parent = supportStatus;
  supportStatus.children = [actionsSlot];

  const reg = new Map([
    ['#support-actions', actionsSlot],
    ['#latest-reply-feedback', feedbackSlot],
    ['#support-status', supportStatus],
    ['#latest-reply-feedback .reply-feedback .actions', null], // innerHTML 解析时补
  ]);

  hooks.onParse = (_wrap, actions) => reg.set('#latest-reply-feedback .reply-feedback .actions', actions);

  const $ = (sel) => reg.get(sel) ?? null;
  const box = el('main');
  return { $, box, supportStatus, feedbackSlot, actionsSlot };
}

test('评价灯灯新回复时不抛 DOM 异常（线上报 incorrect node tree 就是这里）', async () => {
  const s = scenario();
  const mod = await loadFeedback({
    $: s.$,
    esc: (v) => String(v),
    state: { session: { player: { id: PLAYER } } },
  });

  const messages = [{ id: 42, to_player_id: PLAYER, content: '这是灯灯的一条新回复', helpful: null }];

  let threw = null;
  let rated;
  try {
    rated = mod.updateReplyFeedback(s.box, { messages, isAssistant: true, ratedId: null });
  } catch (e) {
    threw = e;
  }
  assert.equal(threw, null, `updateReplyFeedback 抛了：${threw?.name} ${threw?.message}`);
  assert.equal(rated, 42, '应当返回这条待评价回复的 id');
});

test('重画评价槽前，#support-actions 先被搬回客服面板 —— 否则会被 innerHTML 一起冲掉', async () => {
  const s = scenario();
  const mod = await loadFeedback({
    $: s.$,
    esc: (v) => String(v),
    state: { session: { player: { id: PLAYER } } },
  });

  const messages = [{ id: 42, to_player_id: PLAYER, content: '新回复', helpful: null }];
  mod.updateReplyFeedback(s.box, { messages, isAssistant: true, ratedId: null });

  // 走到最后一步 placeSupportActions：按钮组应当已经被搬进新的反馈槽
  assert.ok(
    s.feedbackSlot.contains(s.actionsSlot),
    '客服按钮组应当出现在评价槽里，而不是留在客服面板'
  );
  assert.equal(
    s.actionsSlot.parent === s.supportStatus,
    false,
    '按钮组不应同时还挂在客服面板下'
  );
});

test('没有待评价回复时不动任何节点', async () => {
  const s = scenario();
  const mod = await loadFeedback({
    $: s.$,
    esc: (v) => String(v),
    state: { session: { player: { id: PLAYER } } },
  });

  const before = s.feedbackSlot.innerHTML;
  const rated = mod.updateReplyFeedback(s.box, { messages: [], isAssistant: true, ratedId: null });
  assert.equal(rated, null);
  assert.equal(s.feedbackSlot.innerHTML, before, '没有可评价内容时不该重画槽位');
  assert.equal(s.actionsSlot.parent, s.supportStatus, '按钮组应留在客服面板里');
});

test('非灯灯会话完全不碰反馈槽', async () => {
  const s = scenario();
  const mod = await loadFeedback({
    $: s.$,
    esc: (v) => String(v),
    state: { session: { player: { id: PLAYER } } },
  });
  const rated = mod.updateReplyFeedback(s.box, {
    messages: [{ id: 42, to_player_id: PLAYER, content: 'x', helpful: null }],
    isAssistant: false,
    ratedId: null,
  });
  assert.equal(rated, null);
  assert.equal(s.actionsSlot.parent, s.supportStatus);
});