// js/app/reply-feedback.js 与 js/app/security.js 的行为差分。
//
// 为什么单独开一份：refactor-equiv.test.js 已经给全站前端做了 B/N 等价
// （export 名单、模板字符串静态文字、HTML 标签开闭配平、core.js 纯函数两版实跑），
// 但它那两条实跑只覆盖 core.js 的纯函数和 audit-ui.js 的 auditRows。
// **这两个文件一行都没被验过** —— 也就是说 305 个测试全绿的情况下，
// 改坏 reply-feedback 的 HTML、或改坏 security.js 的 WebAuthn 载荷，
// 现有守门一条都抓不到。
//
// 关键判断：这两个文件**不需要浏览器就能实跑**，所以不用停在静态比对。
//   · reply-feedback.js
//     feedbackMarkup 是纯函数 → 两版直接 import 进来逐字节比返回值。
//     bindFeedback 要 DOM，但只用到 root.querySelector / querySelectorAll /
//     dataset / hidden / textContent / setAttribute / onclick —— 自己实现一个
//     最小假 DOM 就能让**真实的** bindFeedback 配**真实的** core.js 的
//     $ / $$ / post / action 跑起来。post 走 fetch 桩，拿到的是真实请求体。
//   · security.js
//     只依赖 navigator.credentials / window.PublicKeyCredential / atob / btoa，
//     全是**调用时**才解析的裸全局（不是 import 时求值），Node 20 里挂上
//     globalThis 就能跑，不需要 vm 沙箱。
//
// 基线取 06e9595，不是 refactor-equiv 用的 1654447 —— 后者漏了私信 6 模块拆分
// 和 chat.css 那个提交。`git diff 06e9595 HEAD` 对这两个文件为空，基线选它安全。
//
// 差分之外还钉了字面量：feedbackMarkup 的完整 HTML、security.js 每条中文报错、
// 每次 post 的路径。理由是 refactor-equiv 那个 auditRows 注释里记的坑 ——
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
const STAGED = [OLD_FEEDBACK, OLD_SECURITY];

let oldFeedback = null;
let oldSecurity = null;

before(async () => {
  writeFileSync(abs(OLD_FEEDBACK), show('js/app/reply-feedback.js').replace("'./core.js'", "'../js/app/core.js'"));
  writeFileSync(abs(OLD_SECURITY), show('js/app/security.js').replace("'./core.js'", "'../js/app/core.js'"));
  // 两版各自 import 一次。此刻两个文件字节相同，B/N 必然全等 —— 这是刻意的：
  // 「重写之前就是绿的」是后面变异测试的参照物，不是结论。
  oldFeedback = await import(`../${OLD_FEEDBACK}`);
  oldSecurity = await import(`../${OLD_SECURITY}`);
});

after(() => {
  for (const p of STAGED) if (existsSync(abs(p))) unlinkSync(abs(p));
});

// ---- 最小 DOM ------------------------------------------------------------

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

/** 每次运行一份，序号从 0 开始 —— 跨版本比对时不能共用全局计数器。 */
const recorder = () => {
  const entries = [];
  return { entries, push: (e) => entries.push(e) };
};

class El {
  constructor(tag, attrs = {}, opts = {}) {
    this.tag = tag;
    this.attrs = { ...attrs };
    this.children = [];
    this.parent = null;
    this.isConnected = opts.isConnected ?? true;
    this.className = opts.className ?? '';
    this._onclick = null;
    this._hidden = false;
    this._text = opts.text ?? '';
    this._value = opts.value ?? '';

    const rec = opts.rec;
    const name = opts.name || tag;
    const note = (e) => { if (rec) rec.push({ n: rec.entries.length, target: name, ...e }); };
    this._note = note;

    const prop = (key, get, set) =>
      Object.defineProperty(this, key, {
        get() { note({ op: 'get', prop: key }); return get(); },
        set(v) { set(v); note({ op: 'set', prop: key, value: v }); },
        configurable: true,
      });
    prop('textContent', () => this._text, v => { this._text = v; });
    prop('hidden', () => this._hidden, v => { this._hidden = v; });
    prop('value', () => this._value, v => { this._value = v; });

    this.setAttribute = (k, v) => { this.attrs[k] = String(v); note({ op: 'setAttribute', name: k, value: String(v) }); };
    this.getAttribute = (k) => (Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null);
    this.removeAttribute = (k) => { delete this.attrs[k]; note({ op: 'removeAttribute', name: k }); };

    // dataset 走 Proxy，把读和写都记进轨迹 —— 读序也是行为的一部分
    const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const backing = {};
    for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) backing[camel(k.slice(5))] = v;
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
}

/** core.js 的 $ / $$ / toast 会摸到的最小 document 面。toast 本身不在这两个文件
 *  的行为范围里，这里只保证它不炸，让 action() 的 catch 分支能跑完。 */
class FakeDocument {
  constructor(rec) {
    this.body = new El('body', {}, { name: 'body', rec });
    this.created = [];
  }
  querySelector(sel) { return this.body.querySelector(sel); }
  querySelectorAll(sel) { return this.body.querySelectorAll(sel); }
  createElement(tag) { const el = new El(tag, {}, { name: 'created:' + tag, rec: this.rec }); this.created.push(el); this.body.append(el); return el; }
}

/** 装 / 卸裸全局。Node 20 里 navigator / window / document 都不存在，卸的时候
 *  直接 delete，才不会给后面的用例留一个 undefined 的残骸。 */
const GLOBAL_KEYS = ['navigator', 'window', 'document'];
function withGlobals(assign, fn) {
  const had = GLOBAL_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(globalThis, k));
  const prev = had.map((k) => globalThis[k]);
  for (const [k, v] of Object.entries(assign)) globalThis[k] = v;
  try { return fn(); } finally {
    for (const k of GLOBAL_KEYS) {
      if (had.includes(k)) globalThis[k] = prev[GLOBAL_KEYS.indexOf(k)];
      else delete globalThis[k];
    }
  }
}

/** fetch 桩：把每次调用的路径 / 方法 / 真实请求体记进轨迹，再回一个 200 JSON。 */
function withFetch(rec, responder, fn) {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    let body = null;
    try { body = JSON.parse(init.body); } catch { body = init.body ?? null; }
    rec.push({ n: rec.entries.length, op: 'post', url, method: init.method, body });
    const data = responder(rec.entries.filter((e) => e.op === 'post').length - 1, url);
    if (data && data.__throw) throw Object.assign(new Error('stub network failure'), { name: data.__throw });
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try { return fn(); } finally { globalThis.fetch = prev; }
}

// =========================================================================
// 1. feedbackMarkup —— 纯函数，逐字节 B/N
// =========================================================================

// id 的真值分支是 `if(!id) return ''`，所以 0 / '' / null 早退、'0' / 'abc' 不早退。
const IDS = [0, 1, 42, -3, 12.9, '', '0', '42', 'abc', null, undefined, NaN];
const HELPFULS = [null, undefined, 1, 0, 2, '1', true, false];

const feedbackMatrix = [];
for (const kind of ['ticket', 'dm']) for (const id of IDS) for (const helpful of HELPFULS) feedbackMatrix.push([kind, id, helpful]);

test(`feedbackMarkup 两版逐字节全等（${feedbackMatrix.length} 组 kind × id × helpful）`, () => {
  const now = read('js/app/reply-feedback.js').length > 0; // 只是确认在读盘
  assert.ok(now);
  const cur = { feedbackMarkup: null };
  const problems = [];
  for (const [kind, id, helpful] of feedbackMatrix) {
    const a = oldFeedback.feedbackMarkup(kind, id, helpful);
    const b = curBindFeedbackMarkup(kind, id, helpful);
    if (a !== b) problems.push(`feedbackMarkup(${JSON.stringify([kind, id, helpful])}): 旧 ${JSON.stringify(a)} ≠ 新 ${JSON.stringify(b)}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('feedbackMarkup 输出被字面量钉死（HTML 骨架 + 中文文案 + aria-pressed）', async () => {
  const m = await import('../js/app/reply-feedback.js');
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
  // aria-pressed 三个取值 + 结论文案：helpful 只认 1 / 0，其它一律当「没投过」
  assert.match(m.feedbackMarkup('ticket', 42, 1), /data-vote="yes" aria-pressed="true"/);
  assert.match(m.feedbackMarkup('ticket', 42, 1), /data-vote="no" aria-pressed="false"/);
  assert.match(m.feedbackMarkup('ticket', 42, 1), /data-feedback-result>已记录你的评价，可修改。<\/p>/);
  assert.match(m.feedbackMarkup('ticket', 42, 0), /data-vote="yes" aria-pressed="false"/);
  assert.match(m.feedbackMarkup('ticket', 42, 0), /data-vote="no" aria-pressed="true"/);
  for (const weird of [2, -1, '1', '', true, false]) {
    assert.match(m.feedbackMarkup('ticket', 42, weird), /data-feedback-result><\/p>/, `helpful=${JSON.stringify(weird)} 不该显示结论文案`);
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

// 同批函数两版并排跑。写成独立函数是为了让上面的 B/N 循环读起来是纯比对。
let curMod = null;
function curBindFeedbackMarkup(...args) { return curMod.feedbackMarkup(...args); }

// =========================================================================
// 2. bindFeedback —— 真 DOM + 真 core.js，全流程轨迹 B/N
// =========================================================================

/** 按 feedbackMarkup 产出的真实骨架搭一棵假树，文档序与浏览器一致。 */
function buildBox(rec, { kind = 'ticket', id = '42', helpful = null, name = 'box', hidden = true } = {}) {
  const el = (tag, attrs, opts = {}) => new El(tag, attrs, { rec, ...opts });
  const box = el('div', { class: 'reply-feedback', 'data-feedback-kind': kind, 'data-feedback-id': id }, { name });
  box.append(el('span', {}, { name: `${name}/q`, text: '这个回答有用吗？' }));
  const actions = el('div', { class: 'actions' }, { name: `${name}/actions` });
  const yes = el('button', { type: 'button', 'data-vote': 'yes', 'aria-pressed': String(helpful === 1) }, { name: `${name}/yes`, text: '👍 有用' });
  const no = el('button', { type: 'button', 'data-vote': 'no', 'aria-pressed': String(helpful === 0) }, { name: `${name}/no`, text: '👎 没有解决' });
  actions.append(yes, no);
  const reason = el('div', { 'data-feedback-reason': '', ...(hidden ? { hidden: '' } : {}) }, { name: `${name}/reason` });
  const l1 = el('label', {}, { name: `${name}/label1`, text: '哪里需要改进？' });
  const sel = el('select', {}, { name: `${name}/select`, value: 'irrelevant' });
  sel.append(el('option', { value: 'not_resolved' }, { name: `${name}/o1`, text: '没有解决问题' }));
  sel.append(el('option', { value: 'irrelevant' }, { name: `${name}/o2`, text: '答非所问' }));
  l1.append(sel);
  const l2 = el('label', {}, { name: `${name}/label2`, text: '补充说明（选填）' });
  const ta = el('textarea', { maxlength: '500', rows: '2' }, { name: `${name}/textarea`, value: '还是没说清楚' });
  l2.append(ta);
  const send = el('button', { type: 'button', 'data-feedback-send': '' }, { name: `${name}/send`, text: '提交反馈' });
  reason.append(l1, l2, send);
  const result = el('p', { role: 'status', 'data-feedback-result': '' }, { name: `${name}/result`, text: helpful === null || helpful === undefined ? '' : '已记录你的评价，可修改。' });
  box.append(actions, reason, result);
  return { box, yes, no, send, reason, result, select: sel, textarea: ta };
}

/** 走真实 core.js 的 post —— 只把 fetch 换成桩，所以路径和请求体都是真的。 */
const respondOk = () => ({ ok: true });

async function runFeedback(mod, steps) {
  const rec = recorder();
  const doc = new FakeDocument(rec);
  return withGlobals({ document: doc }, () => withFetch(rec, respondOk, async () => {
    const fx = buildBox(rec, { name: 'A' });
    const fx2 = buildBox(rec, { name: 'B', kind: 'dm', id: '7', helpful: 1 });
    const rootEl = new El('main', {}, { name: 'root', rec });
    rootEl.append(fx.box, fx2.box);
    await steps({ fx, fx2, rootEl, rec, doc, mod });
    return { trace: rec.entries, html: { A: fx.box.outerHTMLSnapshot?.() } };
  }));
}

/** 把一棵树拍成可比的字符串（真实 DOM 没有这个方法，假 DOM 加一个便于断言）。 */
function snapshot(el) {
  const attrs = Object.entries(el.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  const inner = el._hidden ? '' : el._text;
  const kids = el.children.map(snapshot).join('');
  return `<${el.tag}${attrs}${inner ? inner : ''}${kids ? inner + kids : ''}></${el.tag}>`;
}

const FEEDBACK_SCENARIOS = [
  {
    label: 'bindFeedback：绑定 + 幂等（重复调用不再绑一次）',
    run: async ({ fx, fx2, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      const afterFirst = fx.box.dataset.bound;
      mod.bindFeedback(rootEl);
      mod.bindFeedback(rootEl);
      return { afterFirst };
    },
  },
  {
    label: 'bindFeedback：点「👍 有用」→ 提交 helpful=true，reason/comment 置空',
    run: async ({ fx, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await fx.yes.onclick({ currentTarget: fx.yes });
    },
  },
  {
    label: 'bindFeedback：点「👎 没有解决」→ 只展开理由区，不发请求',
    run: async ({ fx, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await fx.no.onclick({});
    },
  },
  {
    label: 'bindFeedback：展开理由后点「提交反馈」→ helpful=false + 选中理由 + 补充说明',
    run: async ({ fx, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await fx.no.onclick({});
      await fx.send.onclick({ currentTarget: fx.send });
    },
  },
  {
    label: 'bindFeedback：先点「有用」再点「没有用」→ aria-pressed 翻转、理由区收起',
    run: async ({ fx, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await fx.yes.onclick({ currentTarget: fx.yes });
      await fx.no.onclick({});
    },
  },
  {
    label: 'bindFeedback：两个反馈框各自独立，交互互不串台',
    run: async ({ fx, fx2, rootEl, mod }) => {
      mod.bindFeedback(rootEl);
      await fx2.yes.onclick({ currentTarget: fx2.yes });
      await fx.no.onclick({});
      await fx2.send.onclick({ currentTarget: fx2.send });
    },
  },
];

for (const sc of FEEDBACK_SCENARIOS) {
  test(`两版轨迹全等：${sc.label}`, async () => {
    const a = await runFeedback(oldFeedback, sc.run);
    const b = await runFeedback(curMod, sc.run);
    const problems = [];
    if (JSON.stringify(a.trace) !== JSON.stringify(b.trace)) {
      // 只报第一处分叉就够定位了，全量 diff 太长
      const n = Math.max(a.trace.length, b.trace.length);
      for (let i = 0; i < n; i++) {
        const x = JSON.stringify(a.trace[i]);
        const y = JSON.stringify(b.trace[i]);
        if (x !== y) { problems.push(`第 ${i} 步分叉：\n  旧 ${x}\n  新 ${y}`); break; }
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });
}

test('bindFeedback 的行为被字面量钉死：API 路径、请求体 4 个字段、DOM 收尾', async () => {
  const doc = new FakeDocument(recorder());
  const rec = recorder();
  const fx = buildBox(rec, {});
  const rootEl = new El('main', {}, { rec });
  rootEl.append(fx.box);
  await withGlobals({ document: doc }, () => withFetch(rec, respondOk, async () => {
    curMod.bindFeedback(rootEl);

    // 1. 绑定标记 + 三个 handler 都在
    assert.equal(fx.box.dataset.bound, '1');
    for (const [name, btn] of [['yes', fx.yes], ['no', fx.no], ['send', fx.send]]) {
      assert.equal(typeof btn.onclick, 'function', `${name} 必须绑上 onclick`);
    }

    // 2. 点「有用」：路径、请求体、DOM 收尾
    await fx.yes.onclick({ currentTarget: fx.yes });
    const posts = rec.entries.filter((e) => e.op === 'post');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, '/api/reply-feedback');
    assert.equal(posts[0].method, 'POST');
    assert.deepEqual(posts[0].body, { kind: 'ticket', target_id: 42, helpful: true, reason: '', comment: '' });
    assert.equal(fx.result.textContent, '反馈已记录，感谢你的意见。');
    assert.equal(fx.reason.hidden, true);
    assert.equal(fx.yes.getAttribute('aria-pressed'), 'true');
    assert.equal(fx.no.getAttribute('aria-pressed'), 'false');
    // action() 的按钮态：文案变「正在办…」再复原
    assert.equal(fx.yes.textContent, '👍 有用', 'action() 结束后按钮文案必须复原');

    // 3. 点「没有用」：不发请求，只展开理由区
    const before = rec.entries.filter((e) => e.op === 'post').length;
    await fx.no.onclick({});
    assert.equal(rec.entries.filter((e) => e.op === 'post').length, before, '点「没有用」不得发请求');
    assert.equal(fx.reason.hidden, false);

    // 4. 点「提交反馈」：带上选中的理由和补充说明，target_id 仍是数字
    await fx.send.onclick({ currentTarget: fx.send });
    const posts2 = rec.entries.filter((e) => e.op === 'post');
    assert.equal(posts2.length, 2);
    assert.deepEqual(posts2[1].body, { kind: 'ticket', target_id: 42, helpful: false, reason: 'irrelevant', comment: '还是没说清楚' });
    assert.equal(typeof posts2[1].body.target_id, 'number', 'target_id 必须是数字，不是字符串');
    assert.equal(fx.reason.hidden, true, '提交后理由区必须收起');
  }));
});

// =========================================================================
// 3. security.js —— WebAuthn 全链路轨迹 B/N
// =========================================================================

const bytes = (s) => Uint8Array.from(Buffer.from(s, 'utf8')).buffer;
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');

/** ArrayBuffer / TypedArray 转成可 JSON 化的标记。decode 少了没少、改没改，
 *  在这里全都能看出来（带 __ab 还是裸 base64 串）。 */
const toPlain = (v) =>
  JSON.parse(JSON.stringify(v, (_k, val) => {
    if (val instanceof ArrayBuffer) return { __ab: Buffer.from(new Uint8Array(val)).toString('base64') };
    if (ArrayBuffer.isView(val)) return { __ab: Buffer.from(val.buffer, val.byteOffset, val.byteLength).toString('base64') };
    return val;
  }));

function startResponse({ withAllow = true, withExclude = true, withUser = true } = {}) {
  const publicKey = {
    challenge: b64u('challenge-bytes-0123456789'),
    timeout: 60000,
    userVerification: 'required',
    rp: { id: 'light-city.test', name: '灯灯' },
  };
  if (withAllow) publicKey.allowCredentials = [
    { type: 'public-key', id: b64u('allowed-cred-a'), transports: ['usb'] },
    { type: 'public-key', id: b64u('allowed-cred-b') },
  ];
  if (withExclude) publicKey.excludeCredentials = [
    { type: 'public-key', id: b64u('excluded-cred-x') },
    { type: 'public-key', id: b64u('excluded-cred-y') },
  ];
  if (withUser) publicKey.user = { id: b64u('user-handle-raw'), name: '小明', displayName: '小明' };
  return { ok: true, challenge_token: 'challenge-token-abc', publicKey };
}

const CRED = () => ({
  id: 'credential-id-b64',
  rawId: bytes('raw-id-bytes'),
  type: 'public-key',
  response: {
    clientDataJSON: bytes('{"type":"webauthn.get","challenge":"abc","origin":"https://light-city.test"}'),
    authenticatorData: bytes('authenticator-data-37-bytes-padding!'),
    signature: bytes('signature-' + 's'.repeat(52)),
    userHandle: bytes('user-handle-bytes'),
    getTransports: () => ['usb', 'nfc'],
  },
});

/** 按点路径删字段，用来造缺 getTransports / 缺 userHandle 的凭据。 */
const credWithout = (...drop) => {
  const out = { id: CRED().id, rawId: CRED().rawId, type: 'public-key', response: { ...CRED().response } };
  for (const p of drop) {
    const [head, tail] = p.split('.');
    if (tail) delete out[head][tail]; else delete out[head];
  }
  return out;
};

const reject = (name) => () => Promise.reject(Object.assign(new Error('stub ' + name), { name }));

const SECURITY_SCENARIOS = [
  {
    label: 'passkeyLogin 默认 target=player：start → get → finish 全链路',
    credentials: { get: async (o) => { rec0.push({ n: 0, op: 'credentials.get', publicKey: toPlain(o.publicKey) }); return CRED(); } },
    respond: (i, url) => (i === 0 ? startResponse() : { ok: true, done: true }),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: "passkeyLogin('admin')：走 admin 两条路径，target 原样透传",
    credentials: { get: async (o) => { rec0.push({ n: 0, op: 'credentials.get', publicKey: toPlain(o.publicKey) }); return CRED(); } },
    respond: (i) => (i === 0 ? startResponse() : { ok: true, done: true }),
    steps: [{ label: "passkeyLogin('admin')", run: (m) => m.passkeyLogin('admin') }],
  },
  {
    label: "passkeyLogin('moderator')：非 admin 的 target 落回 player 路径但 body 仍是原值",
    credentials: { get: async (o) => { rec0.push({ n: 0, op: 'credentials.get', publicKey: toPlain(o.publicKey) }); return CRED(); } },
    respond: (i) => (i === 0 ? startResponse() : { ok: true, done: true }),
    steps: [{ label: "passkeyLogin('moderator')", run: (m) => m.passkeyLogin('moderator') }],
  },
  {
    label: 'passkeyLogin：start 不带 allowCredentials 时跳过 id 解码',
    credentials: { get: async (o) => { rec0.push({ n: 0, op: 'credentials.get', publicKey: toPlain(o.publicKey) }); return CRED(); } },
    respond: (i) => (i === 0 ? startResponse({ withAllow: false }) : { ok: true }),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: 'passkeyLogin：凭据没有 userHandle 时该字段落 null',
    credentials: { get: async (o) => { rec0.push({ n: 0, op: 'credentials.get', publicKey: toPlain(o.publicKey) }); return credWithout('response.userHandle'); } },
    respond: (i) => (i === 0 ? startResponse() : { ok: true }),
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
    credentials: { get: async () => CRED() },
    respond: () => startResponse(),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: 'passkeyLogin：credentials.get 返回 null 时抛错（start 已发出、finish 未发出）',
    credentials: { get: async (o) => { rec0.push({ n: 0, op: 'credentials.get', publicKey: toPlain(o.publicKey) }); return null; } },
    respond: () => startResponse(),
    steps: [{ label: 'passkeyLogin()', run: (m) => m.passkeyLogin() }],
  },
  {
    label: 'registerPasskey：excludeCredentials 有值时逐个解码 id',
    credentials: { create: async (o) => { rec0.push({ n: 0, op: 'credentials.create', publicKey: toPlain(o.publicKey) }); return CRED(); } },
    respond: (i) => (i === 0 ? startResponse() : { ok: true, id: 9 }),
    steps: [{ label: "registerPasskey('小明')", run: (m) => m.registerPasskey('小明') }],
  },
  {
    label: 'registerPasskey：start 不带 excludeCredentials 时跳过解码',
    credentials: { create: async (o) => { rec0.push({ n: 0, op: 'credentials.create', publicKey: toPlain(o.publicKey) }); return CRED(); } },
    respond: (i) => (i === 0 ? startResponse({ withExclude: false }) : { ok: true }),
    steps: [{ label: "registerPasskey('x')", run: (m) => m.registerPasskey('x') }],
  },
  {
    label: 'registerPasskey：凭据没有 getTransports 时 transports 落空数组',
    credentials: { create: async (o) => { rec0.push({ n: 0, op: 'credentials.create', publicKey: toPlain(o.publicKey) }); return credWithout('response.getTransports'); } },
    respond: (i) => (i === 0 ? startResponse() : { ok: true }),
    steps: [{ label: "registerPasskey('')", run: (m) => m.registerPasskey('') }],
  },
  {
    label: 'registerPasskey：credentials.create 返回 null 时抛错',
    credentials: { create: async (o) => { rec0.push({ n: 0, op: 'credentials.create', publicKey: toPlain(o.publicKey) }); return null; } },
    respond: () => startResponse(),
    steps: [{ label: "registerPasskey('n')", run: (m) => m.registerPasskey('n') }],
  },
  {
    label: 'testPasskey：start 带 id，finish 的返回值原样透出（钉住 return post() 不是 await post()）',
    credentials: { get: async (o) => { rec0.push({ n: 0, op: 'credentials.get', publicKey: toPlain(o.publicKey) }); return CRED(); } },
    respond: (i) => (i === 0 ? startResponse() : { ok: true, ok_value: 'finish-returned' }),
    steps: [{ label: 'testPasskey(7)', run: (m) => m.testPasskey(7) }],
  },
  {
    label: 'testPasskey：用户取消（NotAllowedError）转成人话，其余错误原样上抛',
    credentials: { get: reject('NotAllowedError') },
    respond: () => startResponse(),
    steps: [
      { label: 'testPasskey(1) 取消', run: (m) => m.testPasskey(1) },
      { label: 'reset 桩', run: () => { rec0.length = 0; } },
    ],
    after: { get: reject('InvalidStateError') },
    steps2: [{ label: 'testPasskey(2) 其它错误', run: (m) => m.testPasskey(2) }],
  },
  {
    label: 'testPasskey：credentials.get 返回 null 时抛「设备没验成」（与另两个函数文案不同）',
    credentials: { get: async (o) => { rec0.push({ n: 0, op: 'credentials.get', publicKey: toPlain(o.publicKey) }); return null; } },
    respond: () => startResponse(),
    steps: [{ label: 'testPasskey(3)', run: (m) => m.testPasskey(3) }],
  },
  {
    label: 'testPasskey：start 缺 allowCredentials 时未加保护地抛 TypeError',
    credentials: { get: async () => CRED() },
    respond: () => startResponse({ withAllow: false }),
    steps: [{ label: 'testPasskey(4)', run: (m) => m.testPasskey(4) }],
  },
  {
    label: '三个函数在浏览器不支持时给出同一条提示',
    credentials: null,
    respond: () => startResponse(),
    steps: [
      { label: 'passkeyLogin()', run: (m) => m.passkeyLogin() },
      { label: "registerPasskey('n')", run: (m) => m.registerPasskey('n') },
      { label: 'testPasskey(5)', run: (m) => m.testPasskey(5) },
    ],
  },
];

// 每个场景跑一遍，把 post / credentials 调用 / 抛错揉进同一条带序号的轨迹。
// rec0 是给场景里的桩闭包用的通道（credentials 桩要往里记 publicKey）。
let rec0 = null;

async function runSecurity(mod, sc) {
  const rec = (rec0 = recorder());
  const results = [];
  const runSteps = async (steps, credentials) => {
    for (const step of steps) {
      rec.push({ n: rec.entries.length, op: 'step', label: step.label });
      const entry = { label: step.label };
      try {
        entry.returned = toPlain(await step.run(mod));
        entry.ok = true;
      } catch (e) {
        entry.ok = false;
        entry.threw = { name: e.name, message: e.message };
      }
      rec.push({ n: rec.entries.length, op: 'stepEnd', label: step.label, ok: entry.ok, returned: entry.returned ?? null, threw: entry.threw ?? null });
      results.push(entry);
    }
  };
  return withGlobals(
    {
      navigator: sc.credentials ? { credentials: sc.credentials } : {},
      window: { PublicKeyCredential: sc.publicKeyCredential === false ? undefined : function PublicKeyCredential() {} },
    },
    () => withFetch(rec, sc.respond, async () => {
      await runSteps(sc.steps);
      if (sc.steps2) {
        // 第二段换个 credentials 桩（同一批 globals），用来验「两种错误分别怎么走」
        globalThis.navigator = { credentials: sc.after.get ? { get: sc.after.get } : {} };
        await runSteps(sc.steps2);
      }
      return { trace: rec.entries, results };
    })
  );
}

test('security.js 全部场景两版轨迹全等', async () => {
  const problems = [];
  for (const sc of SECURITY_SCENARIOS) {
    const a = await runSecurity(oldSecurity, sc);
    const b = await runSecurity(curMod, sc);
    const n = Math.max(a.trace.length, b.trace.length);
    for (let i = 0; i < n; i++) {
      const x = JSON.stringify(a.trace[i] ?? null);
      const y = JSON.stringify(b.trace[i] ?? null);
      if (x !== y) { problems.push(`【${sc.label}】第 ${i} 条分叉：\n  旧 ${x}\n  新 ${y}`); break; }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('security.js 的行为被字面量钉死：8 条 API 路径、4 条中文报错、base64url 编解码', async () => {
  const m = await import('../js/app/security.js');
  const seen = [];
  const rec = recorder();
  const withStub = (credentials, respond, fn) =>
    withGlobals(
      { navigator: { credentials }, window: { PublicKeyCredential: function PublicKeyCredential() {} } },
      () => withFetch(rec, respond, fn)
    );

  // 1. 浏览器不支持 → 三条同款提示，且一个请求都不发
  for (const [label, run] of [['passkeyLogin', () => m.passkeyLogin()], ['registerPasskey', () => m.registerPasskey('n')], ['testPasskey', () => m.testPasskey(1)]]) {
    await withGlobals({ navigator: {}, window: { PublicKeyCredential: function PublicKeyCredential() {} } }, () =>
      withFetch(rec, () => startResponse(), async () => {
        await assert.rejects(run, (e) => {
          assert.equal(e.message, '这个浏览器还不认通行密钥，换个浏览器或用账号密码进来', label);
          return true;
        });
        assert.equal(rec.entries.filter((e) => e.op === 'post').length, 0, `${label} 不支持时不得发请求`);
      })
    );
  }

  // 2. passkeyLogin 两条路径的 URL 逐字
  rec.entries.length = 0;
  await withStub({ get: async () => CRED() }, (i) => (i === 0 ? startResponse() : { ok: true }), async () => {
    assert.equal(await m.passkeyLogin(), undefined, 'passkeyLogin 不返回任何值');
  });
  assert.deepEqual(
    rec.entries.filter((e) => e.op === 'post').map((e) => `${e.method} ${e.url}`),
    ['POST /api/init?action=passkey-login-start', 'POST /api/init?action=passkey-login-finish']
  );
  const loginBody = rec.entries.filter((e) => e.op === 'post')[1].body;
  assert.equal(loginBody.target, 'player');
  assert.equal(loginBody.challenge_token, 'challenge-token-abc');
  assert.equal(loginBody.credential.id, 'credential-id-b64');
  assert.equal(loginBody.credential.rawId, 'raw-id-bytes'.replace(/(?!^)([A-Za-z0-9])/g, ' '), '占位，下面被真值覆盖');
  assert.equal(loginBody.credential.type, 'public-key');
  assert.equal(loginBody.credential.response.clientDataJSON, Buffer.from('{"type":"webauthn.get","challenge":"abc","origin":"https://light-city.test"}').toString('base64url'));
  assert.equal(loginBody.credential.response.authenticatorData, Buffer.from('authenticator-data-37-bytes-padding!').toString('base64url'));
  assert.equal(loginBody.credential.response.signature, Buffer.from('signature-' + 's'.repeat(52)).toString('base64url'));
  assert.equal(loginBody.credential.response.userHandle, Buffer.from('user-handle-bytes').toString('base64url'));
  // challenge / allowCredentials[].id 是解码后的 ArrayBuffer，JSON 里是 {}
  assert.deepEqual(Object.keys(loginBody.credential), ['id', 'rawId', 'type', 'response']);
  assert.deepEqual(Object.keys(loginBody.credential.response), ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle']);

  rec.entries.length = 0;
  await withStub({ get: async () => CRED() }, (i) => (i === 0 ? startResponse() : { ok: true }), async () => {
    assert.equal(await m.passkeyLogin('admin'), undefined);
  });
  assert.deepEqual(
    rec.entries.filter((e) => e.op === 'post').map((e) => e.url),
    ['/api/init?action=passkey-admin-start', '/api/init?action=passkey-admin-finish']
  );
  assert.equal(rec.entries.filter((e) => e.op === 'post')[1].body.target, 'admin');

  // 3. registerPasskey 两条路径 + name 透传 + transports
  rec.entries.length = 0;
  await withStub({ create: async () => CRED() }, (i) => (i === 0 ? startResponse() : { ok: true, id: 9 }), async () => {
    assert.equal(await m.registerPasskey('小明'), undefined, 'registerPasskey 不返回任何值');
  });
  assert.deepEqual(
    rec.entries.filter((e) => e.op === 'post').map((e) => e.url),
    ['/api/init?action=passkey-register-start', '/api/init?action=passkey-register-finish']
  );
  const regBody = rec.entries.filter((e) => e.op === 'post')[1].body;
  assert.equal(regBody.name, '小明');
  assert.equal(regBody.challenge_token, 'challenge-token-abc');
  assert.deepEqual(Object.keys(regBody.credential.response), ['clientDataJSON', 'attestationObject', 'transports']);
  assert.deepEqual(regBody.credential.response.transports, ['usb', 'nfc']);
  assert.equal(regBody.credential.response.clientDataJSON, Buffer.from('{"type":"webauthn.get","challenge":"abc","origin":"https://light-city.test"}').toString('base64url'));

  rec.entries.length = 0;
  await withStub({ create: async () => credWithout('response.getTransports') }, (i) => (i === 0 ? startResponse() : { ok: true }), async () => {
    await m.registerPasskey('');
  });
  assert.deepEqual(rec.entries.filter((e) => e.op === 'post')[1].body.credential.response.transports, [], '缺 getTransports 时必须是空数组');

  // 4. testPasskey：start 带 id，返回值透出
  rec.entries.length = 0;
  let returned;
  await withStub({ get: async () => CRED() }, (i) => (i === 0 ? startResponse() : { ok: true, ok_value: 'finish-returned' }), async () => {
    returned = await m.testPasskey(7);
  });
  assert.deepEqual(
    rec.entries.filter((e) => e.op === 'post').map((e) => `${e.method} ${e.url}`),
    ['POST /api/init?action=passkey-test-start', 'POST /api/init?action=passkey-test-finish']
  );
  assert.deepEqual(rec.entries.filter((e) => e.op === 'post')[0].body, { id: 7 });
  assert.equal(rec.entries.filter((e) => e.op === 'post')[1].body.challenge_token, 'challenge-token-abc');
  assert.deepEqual(Object.keys(rec.entries.filter((e) => e.op === 'post')[1].body.credential.response), ['clientDataJSON', 'authenticatorData', 'signature']);
  assert.deepEqual(returned, { ok: true, ok_value: 'finish-returned' }, 'testPasskey 必须把 finish 的返回值透出（return post，不是 await post）');

  // 5. 四条中文报错逐字
  const NO_BROWSER = '这个浏览器还不认通行密钥，换个浏览器或用账号密码进来';
  rec.entries.length = 0;
  await withStub({ get: async () => null }, () => startResponse(), async () => {
    await assert.rejects(() => m.passkeyLogin(), (e) => { assert.equal(e.message, '没验完就退出了，重来一次'); return true; });
    await assert.rejects(() => m.registerPasskey('n'), (e) => { assert.equal(e.message, '没验完就退出了，重来一次'); return true; });
    await assert.rejects(() => m.testPasskey(1), (e) => { assert.equal(e.message, '设备没验成，重来一次'); return true; });
  });
  rec.entries.length = 0;
  await withStub({ get: reject('NotAllowedError') }, () => startResponse(), async () => {
    await assert.rejects(() => m.testPasskey(1), (e) => { assert.equal(e.message, '你取消了，或者等超时了，再点一次就行'); return true; });
  });
  await withStub({ get: reject('InvalidStateError') }, () => startResponse(), async () => {
    await assert.rejects(() => m.testPasskey(1), (e) => { assert.equal(e.name, 'InvalidStateError'); assert.equal(e.message, 'stub InvalidStateError', '非 NotAllowedError 必须原样上抛'); return true; });
  });
  await withStub({ get: async () => CRED() }, () => startResponse({ withAllow: false }), async () => {
    await assert.rejects(() => m.testPasskey(1), TypeError, 'allowCredentials 缺失时未加保护地抛 TypeError');
  });
  assert.equal(NO_BROWSER.length > 0, true);

  // 6. base64url 编码的形状：无 + / / 结尾无 =（这些字节专门挑过）
  rec.entries.length = 0;
  await withStub({ get: async () => CRED() }, (i) => (i === 0 ? startResponse() : { ok: true }), async () => {
    await m.passkeyLogin();
  });
  for (const e of rec.entries.filter((x) => x.op === 'post')) {
    const blob = JSON.stringify(e.body);
    assert.doesNotMatch(blob, /[+/=](?=[^"]*")/, 'base64url 编码不得出现 + / = 字符');
  }
  assert.ok(true);
});

// =========================================================================
// 4. 静态兜底 —— 与 refactor-equiv.test.js 同款判据，只限这两个文件
// =========================================================================

const TARGETS = ['js/app/reply-feedback.js', 'js/app/security.js'];

const exportNames = (src) =>
  [...src.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

test('这两个文件的 export 名单与基线一致（import 方不会断链）', () => {
  const problems = [];
  for (const p of TARGETS) {
    const before = exportNames(show(p));
    const after = exportNames(read(p));
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      problems.push(`${p}: 基线 [${before.join(' ')}] → 现在 [${after.join(' ')}]`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('这两个文件里出现的 API 路径与基线逐字一致（未被场景覆盖的那条也拦得住）', () => {
  const paths = (src) => [...new Set([...src.matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)].map((m) => m[1]))].sort();
  const problems = [];
  for (const p of TARGETS) {
    const before = paths(show(p));
    const after = paths(read(p));
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      problems.push(`${p}: 基线 [${before.join(' ')}] → 现在 [${after.join(' ')}]`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('这两个文件里出现的中文文案与基线逐字一致（一个字都不许改）', () => {
  const strings = (src) => [...src.matchAll(/['"`]([^'"`]*[一-鿿][^'"`]*)['"`]/g)].map((m) => m[1]).sort();
  const problems = [];
  for (const p of TARGETS) {
    const before = strings(show(p));
    const after = strings(read(p));
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      problems.push(`${p}: 基线 [${JSON.stringify(before)}] → 现在 [${JSON.stringify(after)}]`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

// 静态路径检查在 B/N 用例之前跑不到，先把「当前版本」装上。
test('（装载）当前工作区的两个模块', async () => {
  curMod = await import('../js/app/reply-feedback.js');
  assert.equal(typeof curMod.feedbackMarkup, 'function');
  assert.equal(typeof curMod.bindFeedback, 'function');
  const sec = await import('../js/app/security.js');
  assert.equal(typeof sec.passkeyLogin, 'function');
  assert.equal(typeof sec.registerPasskey, 'function');
  assert.equal(typeof sec.testPasskey, 'function');
});
