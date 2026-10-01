// js/app/reply-feedback.js 与 js/app/security.js 的行为差分。
//
// 为什么单独开一份：refactor-equiv.test.js 已经给全站前端做了 B/N 等价
// （export 名单、模板字符串静态文字、HTML 标签开闭配平、core.js 纯函数两版实跑），
// 但那两条实跑只覆盖 core.js 的纯函数和 audit-ui.js 的 auditRows。
// **这两个文件一行都没被验过** —— 305 个测试全绿的情况下，改坏 reply-feedback
// 的 HTML、或改坏 security.js 的 WebAuthn 载荷，现有守门一条都抓不到。
//
// 关键判断：这两个文件**不需要浏览器就能实跑**，所以不停在静态比对。
//   · reply-feedback.js
//     feedbackMarkup 是纯函数 → 两版直接 import 进来逐字节比返回值。
//     bindFeedback 要 DOM，但它只用到 root.querySelector / querySelectorAll /
//     dataset / hidden / textContent / setAttribute / onclick —— 写一个最小假 DOM
//     就能让**真实的** bindFeedback 配**真实的** core.js 的 $ / $$ / post / action
//     跑起来。post 只把 fetch 换成桩，所以路径和请求体都是真的。
//   · security.js
//     只依赖 navigator.credentials / window.PublicKeyCredential / atob / btoa，
//     全是**调用时**才解析的裸全局（不是 import 时求值），Node 20 里挂上 globalThis
//     就能跑，不需要 vm 沙箱。
//
// 基线取 06e9595，不是 refactor-equiv 用的 1654447 —— 后者漏了私信 6 模块拆分和
// chat.css 那个提交。`git diff 06e9595 HEAD` 对这两个文件为空，选它安全。
//
// 差分之外还钉了字面量：feedbackMarkup 的完整 HTML、security.js 每条中文报错、
// 每次 post 的路径与请求体。理由是 refactor-equiv 里 auditRows 那条注释记的坑 ——
// 「两版都走进同一个兜底分支，于是什么都一致了，其实一格都没验到」。
// 差分负责抓「新版被改坏」，字面量负责抓「差分本身没验到东西」。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE = '06e9595';
const root = fileURLToPath(new URL('../', import.meta.url));
const abs = (p) => path.join(root, p);
const read = (p) => readFileSync(abs(p), 'utf8');
const show = (p) => execSync(`git show ${BASELINE}:${p}`, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });

// ---- 基线落盘 --------------------------------------------------------------
// refactor-equiv.test.js 把基线版本写成 js/app/_equiv_*.js 再 import。这里改放
// tests/ 下并把 './core.js' 改写成 '../js/app/core.js'：frontend.test.js 和
// asset-version.test.js 都会遍历 js/ 全量 link 一遍，多两个临时文件进去就多一份
// 并发踩踏面；tests/ 没有任何测试遍历，文件名也不匹配 --test 的 *.test.js 通配。

const OLD_FEEDBACK = 'tests/_equiv_reply_feedback_old.mjs';
const OLD_SECURITY = 'tests/_equiv_security_old.mjs';

let oldFeedback = null;   // 06e9595 版的 reply-feedback.js
let oldSecurity = null;   // 06e9595 版的 security.js
let curFeedback = null;   // 当前工作区版
let curSecurity = null;

before(async () => {
  writeFileSync(abs(OLD_FEEDBACK), show('js/app/reply-feedback.js').replace("'./core.js'", "'../js/app/core.js'"));
  writeFileSync(abs(OLD_SECURITY), show('js/app/security.js').replace("'./core.js'", "'../js/app/core.js'"));
  // 两版各自 import 一次。此刻两个文件字节相同、B/N 必然全等 —— 这是刻意的：
  // 「重写之前就是绿的」是后面变异测试的参照物，不是结论。
  oldFeedback = await import(`../${OLD_FEEDBACK}`);
  oldSecurity = await import(`../${OLD_SECURITY}`);
  curFeedback = await import('../js/app/reply-feedback.js');
  curSecurity = await import('../js/app/security.js');
});

after(() => {
  for (const p of [OLD_FEEDBACK, OLD_SECURITY]) if (existsSync(abs(p))) unlinkSync(abs(p));
});

// ---- 通用工具 --------------------------------------------------------------

/** 每次运行一份，序号从 0 开始 —— 跨版本比对时不能共用全局计数器。 */
function recorder() {
  const entries = [];
  return {
    entries,
    push(e) { if (!('n' in e)) e.n = entries.length; entries.push(e); },
  };
}

const GLOBAL_KEYS = ['navigator', 'window', 'document'];

/** 装 / 卸裸全局。Node 20 里 navigator / window / document 都不存在，卸的时候
 *  直接 delete，才不会给后面的用例留一个 undefined 的残骸。异步版：必须 await
 *  fn() 再恢复，否则 finally 会在 promise 还没跑完时就跑掉。 */
async function withGlobals(assign, fn) {
  const had = GLOBAL_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(globalThis, k));
  const prev = GLOBAL_KEYS.map((k) => globalThis[k]);
  for (const [k, v] of Object.entries(assign)) globalThis[k] = v;
  try { return await fn(); } finally {
    GLOBAL_KEYS.forEach((k, i) => { if (had.includes(k)) globalThis[k] = prev[i]; else delete globalThis[k]; });
  }
}

/** fetch 桩：把每次调用的路径 / 方法 / 真实请求体记进轨迹，再回一个 200 JSON。
 *  responder 收到的序号 i 是**本次桩内**的（从 0 起），不继承同一测试里前几次桩的
 *  计数 —— 否则前几轮留下的 post 会把下标顶掉，responder 答非所问。 */
async function withFetch(rec, responder, fn) {
  const prev = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    let body = null;
    try { body = JSON.parse(init.body); } catch { body = init.body ?? null; }
    rec.push({ op: 'post', url, method: init.method, body });
    const data = responder(n++, url);
    if (data && data.__throw) throw Object.assign(new Error('stub network failure'), { name: data.__throw });
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try { return await fn(); } finally { globalThis.fetch = prev; }
}

/** 装好 globals + fetch 桩跑一段，结束后全部还原，把 post 记录交还回来。 */
async function stage({ credentials, publicKeyCredential = true, respond, document }, fn) {
  const rec = recorder();
  const assign = {
    navigator: credentials ? { credentials } : {},
    window: { PublicKeyCredential: publicKeyCredential ? function PublicKeyCredential() {} : undefined },
  };
  if (document) assign.document = document;
  const value = await withGlobals(assign, () => withFetch(rec, respond, fn));
  return { rec, value, posts: () => rec.entries.filter((e) => e.op === 'post') };
}

/** ArrayBuffer / TypedArray 转成可 JSON 化的标记。decode 少了没少、encode 改了没有，
 *  在这里全都能看出来（带 __ab 还是裸 base64 串）。 */
const toPlain = (v) =>
  v === undefined
    ? '<undefined>'
    : JSON.parse(JSON.stringify(v, (_k, val) => {
        if (val instanceof ArrayBuffer) return { __ab: Buffer.from(new Uint8Array(val)).toString('base64') };
        if (ArrayBuffer.isView(val)) return { __ab: Buffer.from(val.buffer, val.byteOffset, val.byteLength).toString('base64') };
        return val;
      }));

/** 轨迹分叉时只报第一处，够定位就行 —— 全量 diff 太长。 */
function firstDivergence(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = JSON.stringify(a[i] ?? null);
    const y = JSON.stringify(b[i] ?? null);
    if (x !== y) return `第 ${i} 条分叉：\n  旧 ${x}\n  新 ${y}`;
  }
  return null;
}

// ---- 最小 DOM --------------------------------------------------------------

/** 只认三种写法：标签名、[attr]、[attr=value]。别的一律不匹配 —— 选择器被改成
 *  第四种语法时，宁可让测试红掉，也不要默默当成通配符放过去。 */
function selectorMatches(node, sel) {
  sel = sel.trim();
  let m;
  if ((m = /^\[([\w-]+)\]$/.exec(sel))) return Object.prototype.hasOwnProperty.call(node.attrs, m[1]);
  if ((m = /^\[([\w-]+)=("?)([^"\]]*)\2\]$/.exec(sel))) return node.attrs[m[1]] === m[3];
  if (/^[a-z][\w-]*$/i.test(sel)) return node.tag === sel.toLowerCase();
  return false;
}

class El {
  constructor(tag, attrs = {}, opts = {}) {
    this.tag = tag;
    this.attrs = { ...attrs };
    this.children = [];
    this.parent = null;
    this.isConnected = opts.isConnected ?? true;
    this.className = opts.className ?? '';
    this._onclick = null;
    this._hidden = 'hidden' in this.attrs;
    this._text = opts.text ?? '';
    this._value = opts.value ?? '';

    const rec = opts.rec;
    const name = opts.name || tag;
    const note = (e) => { if (rec) rec.push({ target: name, ...e }); };
    this._note = note;

    const prop = (key, get, set) =>
      Object.defineProperty(this, key, {
        get() { note({ op: 'get', prop: key }); return get(); },
        set(v) { set(v); note({ op: 'set', prop: key, value: v }); },
        configurable: true,
      });
    prop('textContent', () => this._text, (v) => { this._text = v; });
    prop('hidden', () => this._hidden, (v) => { this._hidden = v; });
    prop('value', () => this._value, (v) => { this._value = v; });

    this.setAttribute = (k, v) => { this.attrs[k] = String(v); note({ op: 'setAttribute', name: k, value: String(v) }); };
    this.getAttribute = (k) => (Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null);
    this.removeAttribute = (k) => { delete this.attrs[k]; note({ op: 'removeAttribute', name: k }); };

    // dataset 走 Proxy，把读和写都记进轨迹 —— 读序也是行为的一部分
    const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const backing = {};
    for (const [k, v] of Object.entries(this.attrs)) if (k.startsWith('data-')) backing[camel(k.slice(5))] = v;
    this.dataset = new Proxy(backing, {
      get: (t, k) => { if (typeof k === 'string') note({ op: 'read', prop: `dataset.${k}`, value: t[k] }); return t[k]; },
      set: (t, k, v) => { t[k] = v; note({ op: 'write', prop: `dataset.${String(k)}`, value: v }); return true; },
    });
  }

  get onclick() { return this._onclick; }
  set onclick(fn) { this._onclick = fn; this._note({ op: 'assign', prop: 'onclick', value: typeof fn === 'function' ? '<fn>' : String(fn) }); }

  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  querySelectorAll(sel) { return this.descendants().filter((n) => selectorMatches(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  // core.js 的 toast 会 setTimeout(() => el.remove(), 5000)，不实现它会在测试结束后
  // 抛 TypeError（node 会当成 uncaughtException）。toast 本身不在本次验证范围。
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; this.isConnected = false; }
}

/** core.js 的 $ / $$ / toast 会摸到的最小 document 面。toast 本身不在这两个文件的
 *  行为范围里，这里只保证它不炸，让 action() 的 catch 分支能跑完。 */
class FakeDocument {
  constructor(rec) {
    this.rec = rec;
    this.body = new El('body', {}, { name: 'body', rec });
  }
  querySelector(sel) { return this.body.querySelector(sel); }
  querySelectorAll(sel) { return this.body.querySelectorAll(sel); }
  createElement(tag) { return this.body.append(new El(tag, {}, { name: 'created:' + tag, rec: this.rec })), this.body.children.at(-1); }
}

// =========================================================================
// 1. feedbackMarkup —— 纯函数，逐字节 B/N + 字面量
// =========================================================================

// id 的真值分支是 `if(!id) return ''`，所以 0 / '' / null 早退、'0' / 'abc' 不早退。
const IDS = [0, 1, 42, -3, 12.9, '', '0', '42', 'abc', null, undefined, NaN];
const HELPFULS = [null, undefined, 1, 0, 2, '1', true, false];
const MATRIX = [];
for (const kind of ['ticket', 'dm']) for (const id of IDS) for (const helpful of HELPFULS) MATRIX.push([kind, id, helpful]);

test(`feedbackMarkup 两版逐字节全等（${MATRIX.length} 组 kind × id × helpful）`, () => {
  const problems = [];
  for (const args of MATRIX) {
    const a = oldFeedback.feedbackMarkup(...args);
    const b = curFeedback.feedbackMarkup(...args);
    if (a !== b) problems.push(`feedbackMarkup(${args.map((v) => JSON.stringify(v)).join(', ')}): 旧 ${JSON.stringify(a)} ≠ 新 ${JSON.stringify(b)}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('feedbackMarkup 输出被字面量钉死（HTML 骨架 + 中文文案 + aria-pressed）', () => {
  const m = curFeedback;
  // 逐字节钉住最常见的那一种渲染。改一个空格、换一个 class、改一个字都会红。
  assert.equal(
    m.feedbackMarkup('ticket', 42, null),
    '<div class="reply-feedback" data-feedback-kind="ticket" data-feedback-id="42"><span>这个回答有用吗？</span>' +
      '<div class="actions"><button type="button" data-vote="yes" aria-pressed="false">👍 有用</button>' +
      '<button type="button" data-vote="no" aria-pressed="false">👎 没有解决</button></div>' +
      '<div data-feedback-reason hidden><label>哪里需要改进？<select><option value="not_resolved">没有解决问题</option>' +
      '<option value="irrelevant">答非所问</option><option value="incorrect">内容有误</option>' +
      '<option value="other">其他</option></select></label><label>补充说明（选填）' +
      '<textarea maxlength="500" rows="2"></textarea></label><button type="button" data-feedback-send>提交反馈</button></div>' +
      '<p role="status" data-feedback-result></p></div>'
  );
  // 结论文案只认 nullish：源码的守卫是 `helpful===null||helpful===undefined`，
  // 所以 2 / -1 / '' / true / false 全都会显示「已记录你的评价」。
  // 这是既有行为（回传脏值时也会显示成功文案），本次只钉住，不改。
  assert.match(m.feedbackMarkup('ticket', 42, 1), /data-feedback-result>已记录你的评价，可修改。<\/p>/);
  assert.match(m.feedbackMarkup('ticket', 42, 0), /data-vote="yes" aria-pressed="false"/);
  assert.match(m.feedbackMarkup('ticket', 42, 0), /data-vote="no" aria-pressed="true"/);
  for (const weird of [2, -1, '1', '', true, false]) {
    assert.match(m.feedbackMarkup('ticket', 42, weird), /data-feedback-result>已记录你的评价，可修改。<\/p>/, `helpful=${JSON.stringify(weird)} 走的是非 nullish 分支`);
  }
  for (const empty of [null, undefined]) {
    assert.match(m.feedbackMarkup('ticket', 42, empty), /data-feedback-result><\/p>/, `helpful=${JSON.stringify(empty)} 必须留空`);
  }
  // aria-pressed 只认严格 1 / 0（=== 比较，不受上面那个 nullish 守卫影响）
  for (const [helpful, yes, no] of [[1, 'true', 'false'], [0, 'false', 'true'], [2, 'false', 'false'], ['1', 'false', 'false'], [true, 'false', 'false']]) {
    const html = m.feedbackMarkup('ticket', 42, helpful);
    assert.ok(html.includes(`data-vote="yes" aria-pressed="${yes}"`), `helpful=${JSON.stringify(helpful)} 的 yes 态`);
    assert.ok(html.includes(`data-vote="no" aria-pressed="${no}"`), `helpful=${JSON.stringify(helpful)} 的 no 态`);
  }
  // 四个理由选项的 value 与中文逐字
  for (const [v, label] of [['not_resolved', '没有解决问题'], ['irrelevant', '答非所问'], ['incorrect', '内容有误'], ['other', '其他']]) {
    assert.ok(m.feedbackMarkup('ticket', 1, null).includes(`<option value="${v}">${label}</option>`), v);
  }
  // id 早退：0 / '' / null / undefined / NaN 出空串，'0' 出 id="0"，'abc' 出 NaN
  for (const id of [0, '', null, undefined, NaN]) assert.equal(m.feedbackMarkup('ticket', id, null), '', JSON.stringify(id));
  assert.match(m.feedbackMarkup('ticket', '0', null), /data-feedback-id="0"/);
  assert.match(m.feedbackMarkup('ticket', 'abc', null), /data-feedback-id="NaN"/);
});

// =========================================================================
// 2. bindFeedback —— 真 DOM + 真 core.js，全流程轨迹 B/N + 字面量
// =========================================================================

/** 按 feedbackMarkup 产出的真实骨架搭一棵假树，文档序与浏览器一致。 */
function buildBox(rec, { kind = 'ticket', id = '42', helpful = null, name = 'A', collapsed = true } = {}) {
  const el = (tag, attrs, opts = {}) => new El(tag, attrs, { rec, ...opts });
  const box = el('div', { class: 'reply-feedback', 'data-feedback-kind': kind, 'data-feedback-id': id }, { name });
  box.append(el('span', {}, { name: `${name}/q`, text: '这个回答有用吗？' }));
  const actions = el('div', { class: 'actions' }, { name: `${name}/actions` });
  const yes = el('button', { type: 'button', 'data-vote': 'yes', 'aria-pressed': String(helpful === 1) }, { name: `${name}/yes`, text: '👍 有用' });
  const no = el('button', { type: 'button', 'data-vote': 'no', 'aria-pressed': String(helpful === 0) }, { name: `${name}/no`, text: '👎 没有解决' });
  actions.append(yes, no);
  const reason = el('div', { 'data-feedback-reason': '', ...(collapsed ? { hidden: '' } : {}) }, { name: `${name}/reason` });
  const l1 = el('label', {}, { name: `${name}/label1`, text: '哪里需要改进？' });
  const select = el('select', {}, { name: `${name}/select`, value: 'irrelevant' });
  select.append(el('option', { value: 'not_resolved' }, { name: `${name}/o1`, text: '没有解决问题' }));
  select.append(el('option', { value: 'irrelevant' }, { name: `${name}/o2`, text: '答非所问' }));
  l1.append(select);
  const l2 = el('label', {}, { name: `${name}/label2`, text: '补充说明（选填）' });
  l2.append(el('textarea', { maxlength: '500', rows: '2' }, { name: `${name}/textarea`, value: '还是没说清楚' }));
  const send = el('button', { type: 'button', 'data-feedback-send': '' }, { name: `${name}/send`, text: '提交反馈' });
  reason.append(l1, l2, send);
  const result = el('p', { role: 'status', 'data-feedback-result': '' }, { name: `${name}/result`, text: helpful === null || helpful === undefined ? '' : '已记录你的评价，可修改。' });
  box.append(actions, reason, result);
  return { box, yes, no, send, reason, result, select, textarea: l2.children[0] };
}

/** 走真实 core.js 的 post —— 只把 fetch 换成桩，所以路径和请求体都是真的。 */
async function runFeedback(mod, steps) {
  const rec = recorder();
  const doc = new FakeDocument(rec);
  return withGlobals({ document: doc }, () => withFetch(rec, () => ({ ok: true }), async () => {
    const A = buildBox(rec, { name: 'A' });
    const B = buildBox(rec, { name: 'B', kind: 'dm', id: '7', helpful: 1 });
    const rootEl = new El('main', {}, { name: 'root', rec });
    rootEl.append(A.box, B.box);
    const out = await steps({ A, B, rootEl, rec, doc, mod });
    return { trace: rec.entries, out };
  }));
}

const FEEDBACK_SCENARIOS = [
  {
    label: '绑定 + 幂等（重复调用不再绑一次）',
    run: ({ A, B, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      const boundAfterFirst = { A: A.box.dataset.bound, B: B.box.dataset.bound };
      mod.bindFeedback(rootEl);
      mod.bindFeedback(rootEl);
      return { boundAfterFirst, handlers: { yes: typeof A.yes.onclick, no: typeof A.no.onclick, send: typeof A.send.onclick } };
    },
  },
  {
    label: '点「👍 有用」→ 提交 helpful=true，reason/comment 置空',
    run: async ({ A, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await A.yes.onclick({ currentTarget: A.yes });
    },
  },
  {
    label: '点「👎 没有解决」→ 只展开理由区，不发请求',
    run: async ({ A, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await A.no.onclick({});
    },
  },
  {
    label: '展开理由后点「提交反馈」→ helpful=false + 选中理由 + 补充说明',
    run: async ({ A, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await A.no.onclick({});
      await A.send.onclick({ currentTarget: A.send });
    },
  },
  {
    label: '先点「有用」再点「没有用」→ aria-pressed 翻转、理由区展开',
    run: async ({ A, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await A.yes.onclick({ currentTarget: A.yes });
      await A.no.onclick({});
    },
  },
  {
    label: '连点两次「有用」→ 请求发两次，第二次 reason/comment 仍为空',
    run: async ({ A, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await A.yes.onclick({ currentTarget: A.yes });
      await A.yes.onclick({ currentTarget: A.yes });
    },
  },
  {
    label: '两个反馈框各自独立，交互互不串台',
    run: async ({ A, B, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await B.yes.onclick({ currentTarget: B.yes });
      await A.no.onclick({});
      await B.send.onclick({ currentTarget: B.send });
    },
  },
];

for (const sc of FEEDBACK_SCENARIOS) {
  test(`两版轨迹全等：bindFeedback ${sc.label}`, async () => {
    const a = await runFeedback(oldFeedback, sc.run);
    const b = await runFeedback(curFeedback, sc.run);
    const d = firstDivergence(a.trace, b.trace);
    assert.equal(d, null, d || '');
    assert.deepEqual(b.out, a.out, '场景返回值也应全等');
  });
}

test('bindFeedback 的行为被字面量钉死：API 路径、请求体 4 个字段、DOM 收尾', async () => {
  const rec = recorder();
  const doc = new FakeDocument(rec);
  await withGlobals({ document: doc }, () => withFetch(rec, () => ({ ok: true }), async () => {
    const A = buildBox(rec, {});
    const rootEl = new El('main', {}, { name: 'root', rec });
    rootEl.append(A.box);
    const posts = () => rec.entries.filter((e) => e.op === 'post');
    curFeedback.bindFeedback(rootEl);

    // 1. 绑定标记 + 三个 handler 都在
    assert.equal(A.box.dataset.bound, '1');
    for (const [name, btn] of [['yes', A.yes], ['no', A.no], ['send', A.send]]) {
      assert.equal(typeof btn.onclick, 'function', `${name} 必须绑上 onclick`);
    }

    // 2. 点「有用」：路径、请求体、DOM 收尾
    await A.yes.onclick({ currentTarget: A.yes });
    assert.equal(posts().length, 1);
    assert.equal(posts()[0].url, '/api/reply-feedback');
    assert.equal(posts()[0].method, 'POST');
    assert.deepEqual(posts()[0].body, { kind: 'ticket', target_id: 42, helpful: true, reason: '', comment: '' });
    assert.equal(A.result.textContent, '反馈已记录，感谢你的意见。');
    assert.equal(A.reason.hidden, true);
    assert.equal(A.yes.getAttribute('aria-pressed'), 'true');
    assert.equal(A.no.getAttribute('aria-pressed'), 'false');
    assert.equal(A.yes.textContent, '👍 有用', 'action() 结束后按钮文案必须复原');

    // 3. 点「没有用」：不发请求，只展开理由区
    await A.no.onclick({});
    assert.equal(posts().length, 1, '点「没有用」不得发请求');
    assert.equal(A.reason.hidden, false);

    // 4. 点「提交反馈」：带上选中的理由和补充说明，target_id 仍是数字
    await A.send.onclick({ currentTarget: A.send });
    assert.equal(posts().length, 2);
    assert.deepEqual(posts()[1].body, { kind: 'ticket', target_id: 42, helpful: false, reason: 'irrelevant', comment: '还是没说清楚' });
    assert.equal(typeof posts()[1].body.target_id, 'number', 'target_id 必须是数字，不是字符串');
    assert.equal(A.reason.hidden, true, '提交后理由区必须收起');
  }));
});

test('bindFeedback：post 失败时自己的 DOM 一个都不动（错误交给 action → toast）', async () => {
  const rec = recorder();
  const doc = new FakeDocument(rec);
  await withGlobals({ document: doc }, () => withFetch(rec, () => ({ __throw: 'AbortError' }), async () => {
    const A = buildBox(rec, {});
    const rootEl = new El('main', {}, { name: 'root', rec });
    rootEl.append(A.box);
    curFeedback.bindFeedback(rootEl);
    const before = { text: A.result.textContent, hidden: A.reason.hidden, yes: A.yes.getAttribute('aria-pressed'), no: A.no.getAttribute('aria-pressed') };
    await A.yes.onclick({ currentTarget: A.yes });
    assert.equal(A.result.textContent, before.text, '请求失败时不得写结论文案');
    assert.equal(A.reason.hidden, before.hidden, '请求失败时不得动理由区');
    assert.equal(A.yes.getAttribute('aria-pressed'), before.yes, '请求失败时不得改 aria-pressed');
    assert.equal(A.no.getAttribute('aria-pressed'), before.no, '请求失败时不得改 aria-pressed');
    assert.equal(A.yes.textContent, '👍 有用', 'action() 仍要复原按钮文案');
  }));
});

// =========================================================================
// 3. security.js —— WebAuthn 全链路轨迹 B/N + 字面量
// =========================================================================

const bytes = (s) => Uint8Array.from(Buffer.from(s, 'utf8')).buffer;
const b64u = (b) => Buffer.from(b).toString('base64url');

/** 专门挑的字节：标准 base64 编码它是 `+/+/774AEQ==` —— + / / = 三样齐全。
 *  拿它当 challenge 和 rawId，才能验到 encode/decode 里的 -→+ 、_→/ 和剥 = 。 */
const TRICKY = Uint8Array.from([0xfb, 0xff, 0xbf, 0xef, 0xbe, 0x00, 0x11]);

test('测试向量自检：TRICKY 真能逼出 url-safe 分支（否则下面几条等于没验）', () => {
  const std = Buffer.from(TRICKY).toString('base64');
  assert.ok(std.includes('+'), `标准 base64 必须含 +，实际 ${std}`);
  assert.ok(std.includes('/'), `标准 base64 必须含 /，实际 ${std}`);
  assert.ok(std.endsWith('='), `标准 base64 必须有 = 填充，实际 ${std}`);
  assert.doesNotMatch(b64u(TRICKY), /[+/=]/, 'url-safe 形式必须不含 + / =');
  assert.deepEqual(Buffer.from(b64u(TRICKY), 'base64url'), Buffer.from(TRICKY), 'url-safe 必须能原样解码回去');
});

function startResponse({ withAllow = true, withExclude = true, withUser = true, tricky = false } = {}) {
  const publicKey = {
    challenge: tricky ? b64u(TRICKY) : b64u('challenge-bytes-0123456789'),
    timeout: 60000,
    userVerification: 'required',
    rp: { id: 'light-city.test', name: '灯灯' },
  };
  if (withAllow) {
    publicKey.allowCredentials = [
      { type: 'public-key', id: b64u(tricky ? TRICKY : 'allowed-cred-a'), transports: ['usb'] },
      { type: 'public-key', id: b64u('allowed-cred-b') },
    ];
  }
  if (withExclude) {
    publicKey.excludeCredentials = [
      { type: 'public-key', id: b64u('excluded-cred-x') },
      { type: 'public-key', id: b64u('excluded-cred-y') },
    ];
  }
  if (withUser) publicKey.user = { id: b64u('user-handle-raw'), name: '小明', displayName: '小明' };
  return { ok: true, challenge_token: 'challenge-token-abc', publicKey };
}

function credential(tricky = false) {
  return {
    id: 'credential-id-b64',
    rawId: tricky ? TRICKY.buffer.slice(0) : bytes('raw-id-bytes'),
    type: 'public-key',
    response: {
      clientDataJSON: bytes('{"type":"webauthn.get","challenge":"abc","origin":"https://light-city.test"}'),
      authenticatorData: bytes('authenticator-data-padding!'),
      signature: bytes('signature-' + 's'.repeat(52)),
      userHandle: bytes('user-handle-bytes'),
      getTransports: () => ['usb', 'nfc'],
    },
  };
}

/** 按点路径删字段，用来造缺 getTransports / 缺 userHandle 的凭据。 */
const credWithout = (...drop) => {
  const base = credential();
  const out = { id: base.id, rawId: base.rawId, type: base.type, response: { ...base.response } };
  for (const p of drop) {
    const [head, tail] = p.split('.');
    if (tail) delete out[head][tail]; else delete out[head];
  }
  return out;
};

const rejectWith = (name) => () => Promise.reject(Object.assign(new Error('stub ' + name), { name }));

/** 场景里的 credentials 桩要往轨迹里记 publicKey，用这个通道拿 recorder。 */
let rec0 = null;
const noteGet = (method) => async (o) => { rec0.push({ op: `credentials.${method}`, publicKey: toPlain(o.publicKey) }); return credential(); };
const noteGetWith = (make) => async (o) => { rec0.push({ op: 'credentials.get', publicKey: toPlain(o.publicKey) }); return make(); };

const startThen = (finish) => (i) => (i === 0 ? startResponse() : finish);
const startThenOptions = (opts, finish) => (i) => (i === 0 ? startResponse(opts) : finish);

const SECURITY_SCENARIOS = [
  {
    label: 'passkeyLogin 默认 target=player：start → get → finish 全链路',
    credentials: { get: noteGet('get') },
    respond: startThen({ ok: true, done: true }),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: "passkeyLogin('admin')：走 admin 两条路径",
    credentials: { get: noteGet('get') },
    respond: startThen({ ok: true }),
    steps: [{ label: "passkeyLogin('admin')", run: (m) => m.passkeyLogin('admin') }],
  },
  {
    label: "passkeyLogin('moderator')：非 admin 的 target 落回 player 路径，但 body 仍是原值",
    credentials: { get: noteGet('get') },
    respond: startThen({ ok: true }),
    steps: [{ label: "passkeyLogin('moderator')", run: (m) => m.passkeyLogin('moderator') }],
  },
  {
    label: 'passkeyLogin：start 不带 allowCredentials 时跳过 id 解码',
    credentials: { get: noteGet('get') },
    respond: startThenOptions({ withAllow: false }, { ok: true }),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: 'passkeyLogin：凭据没有 userHandle 时该字段落 null',
    credentials: { get: noteGetWith(() => credWithout('response.userHandle')) },
    respond: startThen({ ok: true }),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: 'passkeyLogin：challenge / allowCredentials / rawId 走 url-safe 字节（encode+decode 双向）',
    tricky: true,
    credentials: { get: async (o) => { rec0.push({ op: 'credentials.get', publicKey: toPlain(o.publicKey) }); return credential(true); } },
    respond: (i) => (i === 0 ? startResponse({ tricky: true }) : { ok: true }),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: 'passkeyLogin：navigator.credentials 缺失时抛错且一个请求都不发',
    credentials: null,
    respond: () => startResponse(),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: 'passkeyLogin：window.PublicKeyCredential 缺失时抛错且一个请求都不发',
    publicKeyCredential: false,
    credentials: { get: async () => credential() },
    respond: () => startResponse(),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: 'passkeyLogin：credentials.get 返回 null 时抛错（start 已发、finish 未发）',
    credentials: { get: noteGetWith(() => null) },
    respond: () => startResponse(),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: 'registerPasskey：excludeCredentials 有值时逐个解码 id',
    credentials: { create: noteGet('create') },
    respond: startThen({ ok: true, id: 9 }),
    steps: [{ label: "registerPasskey('小明')", run: (m) => m.registerPasskey('小明') }],
  },
  {
    label: 'registerPasskey：start 不带 excludeCredentials 时跳过解码',
    credentials: { create: noteGet('create') },
    respond: startThenOptions({ withExclude: false }, { ok: true }),
    steps: [{ label: "registerPasskey('x')", run: (m) => m.registerPasskey('x') }],
  },
  {
    label: 'registerPasskey：凭据没有 getTransports 时 transports 落空数组',
    credentials: { create: noteGetWith(() => credWithout('response.getTransports')) },
    respond: startThen({ ok: true }),
    steps: [{ label: "registerPasskey('')", run: (m) => m.registerPasskey('') }],
  },
  {
    label: 'registerPasskey：credentials.create 返回 null 时抛错',
    credentials: { create: noteGetWith(() => null) },
    respond: () => startResponse(),
    steps: [{ label: "registerPasskey('n')", run: (m) => m.registerPasskey('n') }],
  },
  {
    label: 'testPasskey：start 带 id，finish 的返回值原样透出（钉住 return post() 不是 await post()）',
    credentials: { get: noteGet('get') },
    respond: startThen({ ok: true, ok_value: 'finish-returned' }),
    steps: [{ label: 'testPasskey(7)', run: (m) => m.testPasskey(7) }],
  },
  {
    label: 'testPasskey：用户取消（NotAllowedError）转人话；换个桩再验其它错误原样上抛',
    credentials: { get: rejectWith('NotAllowedError') },
    respond: () => startResponse(),
    steps: [{ label: 'testPasskey(1) 取消', run: (m) => m.testPasskey(1) }],
    afterCredentials: { get: rejectWith('InvalidStateError') },
    stepsAfter: [{ label: 'testPasskey(2) 其它错误', run: (m) => m.testPasskey(2) }],
  },
  {
    label: 'testPasskey：credentials.get 返回 null 时抛「设备没验成」（与另两个函数文案不同）',
    credentials: { get: noteGetWith(() => null) },
    respond: () => startResponse(),
    steps: [{ label: 'testPasskey(3)', run: (m) => m.testPasskey(3) }],
  },
  {
    label: 'testPasskey：start 缺 allowCredentials 时未加保护地抛 TypeError',
    credentials: { get: async () => credential() },
    respond: () => startResponse({ withAllow: false }),
    steps: [{ label: 'testPasskey(4)', run: (m) => m.testPasskey(4) }],
  },
  {
    label: '三个函数在浏览器不支持时给出同一条提示、都不发请求',
    credentials: null,
    respond: () => startResponse(),
    steps: [
      { label: 'passkeyLogin()', run: (m) => m.passkeyLogin() },
      { label: "registerPasskey('n')", run: (m) => m.registerPasskey('n') },
      { label: 'testPasskey(5)', run: (m) => m.testPasskey(5) },
    ],
  },
];

/** 一个场景跑一遍：post / credentials 调用 / 抛错全揉进同一条带序号的轨迹。 */
async function runSecurity(mod, sc) {
  const rec = (rec0 = recorder());
  const results = [];
  const play = async (steps) => {
    for (const step of steps) {
      rec.push({ op: 'step', label: step.label });
      const entry = { label: step.label };
      try {
        entry.returned = toPlain(await step.run(mod));
        entry.ok = true;
      } catch (e) {
        entry.ok = false;
        entry.threw = { name: e.name, message: e.message };
      }
      rec.push({ op: 'stepEnd', label: step.label, ok: entry.ok, returned: entry.returned ?? null, threw: entry.threw ?? null });
      results.push(entry);
    }
  };
  return withGlobals(
    {
      navigator: sc.credentials ? { credentials: sc.credentials } : {},
      window: { PublicKeyCredential: sc.publicKeyCredential === false ? undefined : function PublicKeyCredential() {} },
    },
    () => withFetch(rec, sc.respond, async () => {
      await play(sc.steps);
      if (sc.stepsAfter) {
        globalThis.navigator = { credentials: sc.afterCredentials };
        await play(sc.stepsAfter);
      }
      return { trace: rec.entries, results };
    })
  );
}

test('security.js 全部场景两版轨迹全等', async () => {
  const problems = [];
  for (const sc of SECURITY_SCENARIOS) {
    const a = await runSecurity(oldSecurity, sc);
    const b = await runSecurity(curSecurity, sc);
    const d = firstDivergence(a.trace, b.trace);
    if (d) problems.push(`【${sc.label}】${d}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('security.js 的行为被字面量钉死：8 条 API 路径、4 条中文报错、base64url 编解码', async () => {
  const m = curSecurity;
  // credentials 传 null 表示「navigator.credentials 整个没有」—— 守卫是
  // `!navigator.credentials`，所以必须让这个属性为 falsy，不能给个空对象。
  const noBrowser = (label) => (e) => {
    assert.equal(e.message, '这个浏览器还不认通行密钥，换个浏览器或用账号密码进来', label);
    return true;
  };

  // 1. 浏览器不支持 → 三个函数同款提示，且一个请求都不发
  for (const [label, run] of [['passkeyLogin', () => m.passkeyLogin()], ['registerPasskey', () => m.registerPasskey('n')], ['testPasskey', () => m.testPasskey(1)]]) {
    const r = await stage({ credentials: null, respond: () => startResponse() }, async () => {
      await assert.rejects(run, noBrowser(label));
    });
    assert.equal(r.posts().length, 0, `${label} 不支持时不得发请求`);
  }
  // 缺的是 PublicKeyCredential（credentials 在）也要同一条提示
  await stage({ credentials: { get: async () => credential() }, publicKeyCredential: false, respond: () => startResponse() }, async () => {
    await assert.rejects(() => m.passkeyLogin(), noBrowser('缺 PublicKeyCredential'));
  });

  // 2. passkeyLogin 两条路径
  const r1 = await stage({ credentials: { get: async () => credential() }, respond: startThen({ ok: true }) }, async () => {
    assert.equal(await m.passkeyLogin(), undefined, 'passkeyLogin 不返回任何值');
  });
  assert.deepEqual(r1.posts().map((e) => `${e.method} ${e.url}`), ['POST /api/init?action=passkey-login-start', 'POST /api/init?action=passkey-login-finish']);
  assert.deepEqual(r1.posts()[0].body, {}, 'start 不带 body');
  const loginBody = r1.posts()[1].body;
  assert.deepEqual(Object.keys(loginBody), ['challenge_token', 'target', 'credential']);
  assert.equal(loginBody.challenge_token, 'challenge-token-abc');
  assert.equal(loginBody.target, 'player');
  assert.deepEqual(Object.keys(loginBody.credential), ['id', 'rawId', 'type', 'response']);
  assert.equal(loginBody.credential.id, 'credential-id-b64');
  assert.equal(loginBody.credential.rawId, b64u(bytes('raw-id-bytes')), 'rawId 必须 base64url 编码');
  assert.equal(loginBody.credential.type, 'public-key');
  assert.deepEqual(Object.keys(loginBody.credential.response), ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle']);
  assert.equal(loginBody.credential.response.clientDataJSON, b64u(bytes('{"type":"webauthn.get","challenge":"abc","origin":"https://light-city.test"}')));
  assert.equal(loginBody.credential.response.authenticatorData, b64u(bytes('authenticator-data-padding!')));
  assert.equal(loginBody.credential.response.signature, b64u(bytes('signature-' + 's'.repeat(52))));
  assert.equal(loginBody.credential.response.userHandle, b64u(bytes('user-handle-bytes')));

  const r2 = await stage({ credentials: { get: async () => credential() }, respond: startThen({ ok: true }) }, async () => {
    assert.equal(await m.passkeyLogin('admin'), undefined);
  });
  assert.deepEqual(r2.posts().map((e) => e.url), ['/api/init?action=passkey-admin-start', '/api/init?action=passkey-admin-finish']);
  assert.equal(r2.posts()[1].body.target, 'admin');
  // 非 admin 的 target：请求路径落回 player，但 body 里透原值
  const r3 = await stage({ credentials: { get: async () => credential() }, respond: startThen({ ok: true }) }, async () => {
    await m.passkeyLogin('moderator');
  });
  assert.deepEqual(r3.posts().map((e) => e.url), ['/api/init?action=passkey-login-start', '/api/init?action=passkey-login-finish']);
  assert.equal(r3.posts()[1].body.target, 'moderator');

  // 3. registerPasskey
  const r4 = await stage({ credentials: { create: async () => credential() }, respond: startThen({ ok: true, id: 9 }) }, async () => {
    assert.equal(await m.registerPasskey('小明'), undefined, 'registerPasskey 不返回任何值');
  });
  assert.deepEqual(r4.posts().map((e) => e.url), ['/api/init?action=passkey-register-start', '/api/init?action=passkey-register-finish']);
  const regBody = r4.posts()[1].body;
  assert.deepEqual(Object.keys(regBody), ['name', 'challenge_token', 'credential']);
  assert.equal(regBody.name, '小明');
  assert.equal(regBody.challenge_token, 'challenge-token-abc');
  assert.deepEqual(Object.keys(regBody.credential.response), ['clientDataJSON', 'attestationObject', 'transports']);
  assert.deepEqual(regBody.credential.response.transports, ['usb', 'nfc']);
  assert.equal(regBody.credential.response.clientDataJSON, b64u(bytes('{"type":"webauthn.get","challenge":"abc","origin":"https://light-city.test"}')));
  assert.ok('attestationObject' in regBody.credential.response, 'attestationObject 键存在');

  const r5 = await stage({ credentials: { create: async () => credWithout('response.getTransports') }, respond: startThen({ ok: true }) }, async () => {
    await m.registerPasskey('');
  });
  assert.deepEqual(r5.posts()[1].body.credential.response.transports, [], '缺 getTransports 时必须是空数组');
  assert.equal(r5.posts()[1].body.name, '', 'name 允许空串');

  // 4. testPasskey：start 带 id，返回值透出
  const r6 = await stage({ credentials: { get: async () => credential() }, respond: startThen({ ok: true, ok_value: 'finish-returned' }) }, async () => {
    return m.testPasskey(7);
  });
  assert.deepEqual(r6.posts().map((e) => `${e.method} ${e.url}`), ['POST /api/init?action=passkey-test-start', 'POST /api/init?action=passkey-test-finish']);
  assert.deepEqual(r6.posts()[0].body, { id: 7 });
  assert.deepEqual(Object.keys(r6.posts()[1].body), ['challenge_token', 'credential']);
  assert.deepEqual(Object.keys(r6.posts()[1].body.credential.response), ['clientDataJSON', 'authenticatorData', 'signature']);
  assert.deepEqual(r6.value, { ok: true, ok_value: 'finish-returned' }, 'testPasskey 必须把 finish 的返回值透出（return post，不是 await post）');

  // 5. 四条中文报错逐字
  await stage({ credentials: { get: async () => null, create: async () => null }, respond: () => startResponse() }, async () => {
    await assert.rejects(() => m.passkeyLogin(), (e) => { assert.equal(e.message, '没验完就退出了，重来一次'); return true; });
    await assert.rejects(() => m.registerPasskey('n'), (e) => { assert.equal(e.message, '没验完就退出了，重来一次'); return true; });
    await assert.rejects(() => m.testPasskey(1), (e) => { assert.equal(e.message, '设备没验成，重来一次'); return true; });
  });
  await stage({ credentials: { get: rejectWith('NotAllowedError') }, respond: () => startResponse() }, async () => {
    await assert.rejects(() => m.testPasskey(1), (e) => { assert.equal(e.message, '你取消了，或者等超时了，再点一次就行'); return true; });
  });
  await stage({ credentials: { get: rejectWith('InvalidStateError') }, respond: () => startResponse() }, async () => {
    await assert.rejects(() => m.testPasskey(1), (e) => {
      assert.equal(e.name, 'InvalidStateError');
      assert.equal(e.message, 'stub InvalidStateError', '非 NotAllowedError 必须原样上抛');
      return true;
    });
  });
  await stage({ credentials: { get: async () => credential() }, respond: () => startResponse({ withAllow: false }) }, async () => {
    await assert.rejects(() => m.testPasskey(1), TypeError, 'allowCredentials 缺失时未加保护地抛 TypeError');
  });

  // 6. url-safe 编解码双向：challenge 进来是 base64url，交给 credentials.get 时必须
  //    已经是原始字节；rawId 出去必须还是不含 + / / = 的 base64url。
  let seen = null;
  const r7 = await stage(
    { credentials: { get: async (o) => { seen = o.publicKey; return credential(true); } }, respond: (i) => (i === 0 ? startResponse({ tricky: true }) : { ok: true }) },
    async () => { await m.passkeyLogin(); }
  );
  assert.ok(seen, 'credentials.get 必须被调用');
  assert.deepEqual([...new Uint8Array(seen.challenge)], [...TRICKY], 'challenge 必须在 get 之前解码回原始字节');
  assert.deepEqual([...new Uint8Array(seen.allowCredentials[0].id)], [...TRICKY], 'allowCredentials[].id 必须解码回原始字节');
  assert.equal(Buffer.from(seen.allowCredentials[1].id).toString('utf8'), 'allowed-cred-b', '未受影响的 id 也不能被改坏');
  assert.deepEqual(Object.keys(seen.allowCredentials[1]), ['type', 'id'], '映射后不得丢字段');
  const trickyRawId = r7.posts()[1].body.credential.rawId;
  assert.doesNotMatch(trickyRawId, /[+/=]/, 'base64url 编码不得出现 + / =');
  assert.equal(trickyRawId, b64u(TRICKY));
  assert.deepEqual(Buffer.from(trickyRawId, 'base64url'), Buffer.from(TRICKY), 'base64url 必须能原样解码回去');
});

// =========================================================================
// 4. 静态兜底 —— 与 refactor-equiv.test.js 同款判据，只限这两个文件
// =========================================================================

const TARGETS = ['js/app/reply-feedback.js', 'js/app/security.js'];

/** 剥注释：块注释与行首的 //
 *  必须剥 —— 注释里的引号会把下面的字面量扫描配对错，而注释又不是用户可见文案。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 扫出真正的字符串字面量（' " `），不靠正则猜配对。
 *
 * 第一版用 `/['"`]([^'"`]*[一-鿿][^'"`]*)['"`]/g` 直接配对，结果被自己的排版打脸：
 * reply-feedback.js 一旦按正常代码换行，源码里引号的开合配对整个变了，正则从某处
 * 一路吞到几百行外，把半个文件当成一个「文案」。那不是文案变了，是判据不成立。
 *
 * 模板字面量里的 `\` + 换行（续行）要还原成「什么都没有」——它不进最终字符串。
 * 不还原的话，压缩版和拆行版的同一段 HTML 会被判成不同文案。
 */
function stringLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const q = src[i];
    if (q !== "'" && q !== '"' && q !== '`') { i++; continue; }
    let j = i + 1;
    let buf = '';
    while (j < src.length && src[j] !== q) {
      if (src[j] === '\\') {
        if (src[j + 1] === '\n') { j += 2; continue; }   // 续行：产出为空
        if (src[j + 1] === '\r' && src[j + 2] === '\n') { j += 3; continue; }
        buf += src[j] + src[j + 1];
        j += 2;
        continue;
      }
      buf += src[j];
      j++;
    }
    out.push(buf);
    i = j + 1;
  }
  return out;
}

const staticCompare = (label, pick) =>
  test(`${label}（与基线 ${BASELINE} 逐字一致）`, () => {
    const problems = [];
    for (const p of TARGETS) {
      const before = pick(stripComments(show(p)));
      const after = pick(stripComments(read(p)));
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        problems.push(`${p}: 基线 ${JSON.stringify(before)}\n      现在 ${JSON.stringify(after)}`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });

// import 方（features/tickets/view.js、features/chat/{feedback,thread}.js、admin/tabs/password.js 等）
// 靠这个名字取东西，少一个就断链。
staticCompare('export 名单未变', (s) => [...new Set([...s.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))].sort());
// 路径是编在字符串里的，场景没覆盖到的那条也拦得住。
staticCompare('API 路径未变', (s) => [...new Set(stringLiterals(s).filter((v) => v.startsWith('/api/')))].sort());
// 一个字都不许改 —— 扫真实字面量，只留含汉字的那些。
// reply-feedback.js 的模板是单个字面量，整段 HTML 一起进对比；
// security.js 的四条中文报错逐条进对比。
staticCompare('中文文案未变', (s) => stringLiterals(s).filter((v) => /[一-鿿]/.test(v)).sort());
// class 名 / data-* 属性是 CSS 和测试的锚点。
staticCompare('class 与 data-* 属性名未变', (s) => [...new Set([...s.matchAll(/\b(?:class|data-[a-z-]+)=["']([^"']*)["']/g)].map((m) => m[1]))].sort());
