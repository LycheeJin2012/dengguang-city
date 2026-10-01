// js/ui/assistant-window.js 的行为等价性守门（重写专用）。
//
// 这个模块没法用「export 名单 + 字面量」静态比对蒙混过去：它整段都是副作用 ——
// 建元素、写属性、拼 innerHTML、挂事件、动态 import 聊天页。上一轮
// `exam-sessions.js` 的翻车正是静态比对的教训：action 白名单被兜底 return 吃掉，
// export 名字没变，305 个测试全绿。
//
// 所以这里做**真的行为对比**：
//   · 用 vm.SourceTextModule 把两版源码都真实 link 一遍（和 tests/frontend.test.js
//     同一种写法），`../app/core.js` 与动态 import 的 `../app/chat-page.js`
//     换成受控的桩，于是不需要真实浏览器也不需要把整个应用图拖进来；
//   · 桩 DOM 把每一次「建节点 / 写属性 / 写 innerHTML / attachShadow /
//     append / focus / 事件回调」按**发生顺序**记进日志；
//   · 跑三组脚本化交互（未登录全流程、已登录懒加载与焦点、切换用户重渲染），
//     比对两版日志逐条相同。
//
// innerHTML 是整串记进日志的，所以 Shadow DOM 里那条
// <link href="/css/style.css?v=90"> 的逐字节一致被顺带证到，不另设断言
// （版本号本身有专门一条用例钉住必须与全站一致）。
//
// 覆盖不到的部分：真实浏览器里的布局、焦点环样式、事件冒泡顺序。冒泡在本模块
// 是单点监听（keydown 挂在 panel 上），桩里按「监听器数组按注册顺序触发」处理，
// 与只有一个监听器时的行为一致；样式由 tests/press-motion-preview.html 在真
// 浏览器里负责。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REL = 'js/ui/assistant-window.js';

/** 重写前版本取自 git HEAD，工作区怎么改它都是不动摇的对照 */
const OLD_SRC = execFileSync('git', ['show', `HEAD:${REL}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
const NEW_SRC = readFileSync(ROOT + REL, 'utf8');

const VOID = new Set(['link', 'br', 'img', 'input', 'meta', 'hr', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);

// ── 记录型 DOM ────────────────────────────────────────────────────────────

class El {
  constructor(tag, log, doc, label) {
    this.tagName = (tag || '').toUpperCase();
    this.log = log;
    this.doc = doc;
    this.label = label;
    this.attrs = Object.create(null);
    this.childNodes = [];
    this.parent = null;
    this.shadowRoot = null;
    this.listeners = Object.create(null);
    this._text = '';
    this._html = '';
    this._root = null;
    this._hidden = false;
    this._inert = false;
    this._onclick = null;
  }

  // 属性写入全部记日志 —— 这是「DOM 赋值顺序」被比对的地方
  set id(v) { this.log.push(`${this.label}.id=${v}`); this.attrs.id = String(v); }
  get id() { return this.attrs.id || ''; }
  set type(v) { this.log.push(`${this.label}.type=${v}`); this.attrs.type = String(v); }
  get type() { return this.attrs.type || ''; }
  set hidden(v) { this.log.push(`${this.label}.hidden=${v}`); this._hidden = !!v; }
  get hidden() { return this._hidden; }
  set inert(v) { this.log.push(`${this.label}.inert=${v}`); this._inert = !!v; }
  get inert() { return this._inert; }
  set textContent(v) { this.log.push(`${this.label}.textContent=${JSON.stringify(v)}`); this._text = v; }
  get textContent() { return this._text; }
  set innerHTML(v) {
    this.log.push(`${this.label}.innerHTML=${v}`);
    this._html = v;
    this._root = parseHTML(v, this.log, this.doc, this.label);
  }
  get innerHTML() { return this._html; }
  set onclick(fn) { this.log.push(`${this.label}.onclick=`); this._onclick = fn; }
  get onclick() { return this._onclick; }
  setAttribute(k, v) { this.log.push(`${this.label}.setAttribute(${k},${v})`); this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  addEventListener(type, fn) { this.log.push(`${this.label}.addEventListener(${type})`); (this.listeners[type] ||= []).push(fn); }
  focus() { this.log.push(`focus(${this.label})`); if (this.doc) this.doc.activeElement = this; }
  append(...kids) {
    for (const k of kids) { k.parent = this; this.childNodes.push(k); }
    this.log.push(`${this.label}.append(${kids.map(describe).join(',')})`);
  }
  replaceChildren(...kids) {
    this.childNodes = kids;
    for (const k of kids) k.parent = this;
    this.log.push(`${this.label}.replaceChildren(${kids.map(describe).join(',')})`);
  }
  attachShadow(init) {
    this.log.push(`${this.label}.attachShadow(${JSON.stringify(init)})`);
    const s = new El('shadowroot', this.log, this.doc, 'shadow');
    s.attachShadow = () => { throw new Error('nested shadow not supported by the stub'); };
    this.shadowRoot = s;
    return s;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  /** 容器语义：在 innerHTML 解析出的树里找；没解析过 innerHTML 就在自己的子树里找 */
  querySelectorAll(sel) { return (this._root || this)._selectAll(sel); }

  // 简单选择器：tag / #id / .class / [attr]（可组合），后继与子代组合器
  matchesSimple(sel) {
    if (sel === '*') return true;
    const tokens = sel.match(/[.#]?[\w-]+|\[[^\]]+\]/g) || [];
    if (!tokens.length) return false;
    return tokens.every((t) => {
      if (t.startsWith('#')) return this.attrs.id === t.slice(1);
      if (t.startsWith('.')) return String(this.attrs.class || '').split(/\s+/).includes(t.slice(1));
      if (t.startsWith('[')) {
        const m = /^\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]$/.exec(t);
        if (!m) return false;
        return m[2] === undefined ? m[1] in this.attrs : this.attrs[m[1]] === m[2];
      }
      return this.tagName === t.toUpperCase();
    });
  }
  /** 选择器引擎：支持 tag / #id / .class / [attr] 及其组合，逗号并列，后代与子代组合器 */
  _selectAll(sel, acc = []) {
    for (const part of String(sel).split(',')) {
      const chain = part.trim().split(/\s*>\s*|\s+/).filter(Boolean);
      if (!chain.length) continue;
      const step = (node, idx) => {
        for (const c of node.childNodes) {
          if (!(c instanceof El)) continue;
          if (c.matchesSimple(chain[idx])) {
            if (idx === chain.length - 1) acc.push(c);
            else step(c, idx + 1);
          }
          step(c, idx); // 更深的子孙也可能起头
        }
      };
      step(this, 0);
    }
    return acc;
  }
  get children() { return this.childNodes.filter((c) => c instanceof El); }
}

const describe = (n) => (n instanceof El ? (n.attrs.id ? '#' + n.attrs.id : n.attrs.class ? n.tagName.toLowerCase() + '.' + String(n.attrs.class).split(/\s+/).join('.') : n.label) : String(n));

/** 极简 HTML -> El 树。只为读懂本模块自己写进去的那两段无嵌套歧义的片段。 */
function parseHTML(html, log, doc, owner) {
  const root = new El('root', log, doc, `${owner}>root`);
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m.index > last) stack[stack.length - 1]._text += html.slice(last, m.index);
    last = re.lastIndex;
    const [, close, name, attrText, selfClose] = m;
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const el = new El(name, log, doc, `${owner}>${name}`);
    for (const a of attrText.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) el.attrs[a[1]] = a[2] === undefined ? '' : a[2];
    if (el.attrs.id) el.label = `${owner}>#${el.attrs.id}`;
    else if (el.attrs.class) el.label = `${owner}>${name}.${el.attrs.class}`;
    el.parent = stack[stack.length - 1];
    el.parent.childNodes.push(el);
    if (!VOID.has(name.toLowerCase()) && !selfClose) stack.push(el);
  }
  return root;
}

function makeDoc(log) {
  const doc = { activeElement: null, _n: 0 };
  doc.body = new El('body', log, doc, 'body');
  doc.createElement = (tag) => new El(tag, log, doc, `el${++doc._n}`);
  doc.querySelector = (sel) => doc.body.querySelector(sel);
  return doc;
}

// ── 挂载：真实 link 一遍源码，依赖换成桩 ────────────────────────────────────

async function mount(src, opts) {
  const log = [];
  const doc = makeDoc(log);
  const state = {
    authPending: Promise.resolve(),
    session: opts.sessionId == null ? null : { player: { id: opts.sessionId } },
  };
  const region = (el, importer, onReady) => {
    log.push('region(el)');
    return Promise.resolve().then(() => importer()).then((m) => { onReady(m, el); return m; });
  };
  const login = () => {
    log.push('login()');
    if (opts.autoLoginTo != null) state.session = { player: { id: opts.autoLoginTo } };
    return Promise.resolve();
  };
  const renderChat = (el, o) => {
    log.push(`renderChat(${describe(el)}, assistantOnly=${o.assistantOnly}, isVisible=${typeof o.isVisible === 'function'})`);
    if (opts.sendForm) {
      const form = new El('form', log, doc, 'form');
      form.attrs.id = 'send-form';
      form.childNodes.push(new El('textarea', log, doc, 'textarea'));
      el.childNodes.push(form);
    }
    renderChat.isVisible = o.isVisible;
    return Promise.resolve();
  };
  renderChat.isVisible = null;

  const context = vm.createContext({
    document: doc, console, Promise, setTimeout, clearTimeout,
    JSON, Object, Array, String, Number, Boolean, Error, Math, RegExp, Date, Symbol, Map, Set,
  });
  const core = new vm.SyntheticModule(['state', 'login', 'region'], function () {
    this.setExport('state', state);
    this.setExport('login', login);
    this.setExport('region', region);
  }, { context, identifier: 'core-stub' });
  const chat = new vm.SyntheticModule(['renderChat'], function () {
    this.setExport('renderChat', renderChat);
  }, { context, identifier: 'chat-page-stub' });
  const resolve = (spec) => {
    if (spec === '../app/core.js') return core;
    if (spec === '../app/chat-page.js') return chat; // 静态与动态都指向同一个桩
    throw new Error(`unexpected import: ${spec}`);
  };
  let chatLinked = false;
  // 静态 import 走 link 回调；动态 import() 走 importModuleDynamously 回调
  const mod = new vm.SourceTextModule(src, {
    identifier: ROOT + REL,
    context,
    importModuleDynamically: async (spec) => {
      if (spec !== '../app/chat-page.js') throw new Error(`unexpected dynamic import: ${spec}`);
      // 换用户重渲染会第二次 import()，同一个桩只能 link 一次
      if (!chatLinked) {
        chatLinked = true;
        await chat.link(() => { throw new Error('chat-page 桩不应再 import 任何东西'); });
        await chat.evaluate();
      }
      return chat;
    },
  });
  await mod.link(resolve);
  await mod.evaluate();

  const drain = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { log, doc, state, drain, launch: () => mod.namespace.mountAssistantWindow(), isVisible: () => renderChat.isVisible };
}

// ── 三个场景 ──────────────────────────────────────────────────────────────

/** 场景 A：未登录 —— 挂载 / 打开 / 点登录 / 关闭 / Escape / 重复挂载 */
async function scenarioGuest(src) {
  const env = await mount(src, { sessionId: null, autoLoginTo: 4 });
  const marks = [];
  const cut = (label) => { marks.push(`## ${label}\n` + env.log.splice(0).map((l) => '   ' + l).join('\n')); };

  env.launch();
  cut('mount');
  const launcher = env.doc.body.querySelector('#assistant-launcher');
  const panel = env.doc.body.querySelector('#assistant-window');
  const shadow = panel.querySelector('.assistant-window-content').shadowRoot;
  const embedded = shadow.querySelector('.assistant-embedded');

  await launcher.onclick();
  env.drain();
  cut('open (guest)');
  const prompt = embedded.querySelector('main>p');
  const loginBtn = embedded.querySelector('main>button');
  marks.push(`guest prompt: p=${JSON.stringify(prompt && prompt.textContent)} button=${JSON.stringify(loginBtn && loginBtn.textContent)}`);
  marks.push(`guest subtree: ${embedded.querySelectorAll('*').map(describe).join(' > ')}`);
  marks.push(`focus after open: ${describe(env.doc.activeElement)}`);
  marks.push(`login button present: ${!!loginBtn}`);
  await loginBtn.onclick();
  env.drain();
  cut('click 市民登录');

  await launcher.onclick();
  cut('close via launcher');

  let prevented = 0;
  for (const fn of panel.listeners.keydown) await fn({ key: 'Escape', preventDefault: () => { prevented++; } });
  cut('escape');
  marks.push(`escape preventDefault calls: ${prevented}`);

  env.launch();
  cut('second mount (should early-return)');
  marks.push(`body children after second mount: ${env.doc.body.children.map(describe).join(', ')}`);
  return marks;
}

/** 场景 B：已登录 —— region 懒加载 / renderChat 参数 / isVisible / 焦点落点 / 重开短路 */
async function scenarioLoggedIn(src) {
  const env = await mount(src, { sessionId: 7, sendForm: true });
  const marks = [];
  const cut = (label) => { marks.push(`## ${label}\n` + env.log.splice(0).map((l) => '   ' + l).join('\n')); };

  env.launch();
  cut('mount');
  const launcher = env.doc.body.querySelector('#assistant-launcher');
  const panel = env.doc.body.querySelector('#assistant-window');
  const shadow = panel.querySelector('.assistant-window-content').shadowRoot;

  await launcher.onclick();
  env.drain();
  cut('open (logged in)');
  marks.push(`embedded children: ${shadow.querySelector('.assistant-embedded').children.map(describe).join(', ')}`);
  marks.push(`isVisible while open: ${env.isVisible()()}`);
  panel._hidden = true; // 直接改字段，避免测试自己的写入混进日志
  marks.push(`isVisible while hidden: ${env.isVisible()()}`);
  panel._hidden = false;
  marks.push(`focus after open: ${describe(env.doc.activeElement)}`);

  await launcher.onclick();
  await launcher.onclick();
  env.drain();
  const rendersBefore = env.log.filter((l) => l === 'region(el)').length;
  cut('reopen same user (loaded short-circuit)');
  marks.push(`region() calls while reopening the same user: ${rendersBefore}（0 = loaded 短路生效）`);

  // 换用户：owner 变了必须重新渲染。上一步结束时浮窗是开着的，
  // 所以要先关一次再开，否则这一下只是把面板关掉，压根不会重新渲染。
  await launcher.onclick();
  env.state.session = { player: { id: 9 } };
  await launcher.onclick();
  env.drain();
  const rendersAfter = env.log.filter((l) => l === 'region(el)').length;
  cut('reopen as a different user');
  marks.push(`region() calls after switching user: ${rendersAfter}（>=1 = owner 变化触发了重渲染）`);
  marks.push(`isVisible after switch: ${env.isVisible()()}`);
  return marks;
}

/** 场景 C：未登录时点「市民登录」成功后，内容区应被换成聊天页 */
async function scenarioLoginSwitch(src) {
  const env = await mount(src, { sessionId: null, autoLoginTo: 12, sendForm: true });
  const marks = [];
  const cut = (label) => { marks.push(`## ${label}\n` + env.log.splice(0).map((l) => '   ' + l).join('\n')); };

  env.launch();
  cut('mount');
  const launcher = env.doc.body.querySelector('#assistant-launcher');
  const panel = env.doc.body.querySelector('#assistant-window');
  const shadow = panel.querySelector('.assistant-window-content').shadowRoot;
  await launcher.onclick();
  env.drain();
  const embedded = shadow.querySelector('.assistant-embedded');
  marks.push(`before login: ${embedded.querySelectorAll('*').map(describe).join(', ')}`);

  await embedded.querySelector('main>button').onclick();
  env.drain();
  cut('after login');
  marks.push(`after login: ${embedded.querySelectorAll('*').map(describe).join(', ')}`);
  marks.push(`focus after login: ${describe(env.doc.activeElement)}`);
  return marks;
}

const scenarios = [
  ['未登录全流程（挂载→打开→登录→关闭→Escape→重复挂载）', scenarioGuest],
  ['已登录懒加载（region/renderChat/isVisible/焦点/重开短路/换用户）', scenarioLoggedIn],
  ['登录成功后内容区从登录引导切到聊天页', scenarioLoginSwitch],
];

/**
 * ?v= 资源版本号归一化。
 *
 * 版本号是**有意**改的：每次改了要发给浏览器的 CSS/JS 都必须 bump，
 * 否则用户继续吃旧缓存（v88.6 就是这个坑，Shadow DOM 漏 bump 单独查了半天才找到）。
 * 所以它不属于「重写引入的漂移」，比之前先抹平成 ?v=N。
 * 版本号本身由下面「浮窗里的 ?v= 与全站版本号一致」那条用例单独钉住。
 */
const normalizeVersion = (text) => text.replace(/\?v=\d+/g, '?v=N');

for (const [name, run] of scenarios) {
  test(`assistant-window 行为等价：${name}`, async () => {
    const before = await run(OLD_SRC);
    const after = (await run(NEW_SRC)).map(normalizeVersion);
    assert.notDeepEqual(before, [], '对照版本跑空了 —— 说明场景本身没产生任何可观测行为，等于没验');
    assert.ok(before.join('\n').includes('mountAssistantWindow') || before.join('\n').length > 50, '场景日志过短，桩可能没接上');
    assert.deepEqual(after, before.map(normalizeVersion), 'DOM 操作序列不一致');
  });
}

test('assistant-window：Shadow DOM 的 innerHTML 除资源版本号外逐字节相同', async () => {
  const grab = async (src) => {
    const env = await mount(src, { sessionId: null });
    env.launch();
    const panel = env.doc.body.querySelector('#assistant-window');
    return {
      panelHTML: panel.innerHTML,
      shadowHTML: panel.querySelector('.assistant-window-content').shadowRoot.innerHTML,
    };
  };
  // ?v= 版本号是**有意**改的（每次改了要发给浏览器的 CSS/JS 都要 bump，
  // 否则用户吃旧缓存），不属于「重写引入的漂移」，比之前先归一化。
  const normalize = normalizeVersion;
  const before = await grab(OLD_SRC);
  const after = await grab(NEW_SRC);
  assert.equal(normalize(after.shadowHTML), normalize(before.shadowHTML),
    'Shadow DOM 的 innerHTML 变了 —— 注意 /css/style.css 的 ?v= 版本号漏 bump 会让整个浮窗吃旧缓存');
  assert.match(after.shadowHTML, /<link rel="stylesheet" href="\/css\/style\.css\?v=\d+"><div class="assistant-embedded"><\/div>/,
    'Shadow DOM 必须自带一条带版本号的样式表 link，且后面紧跟挂载点');
});

test('assistant-window：浮窗里的 ?v= 与全站版本号一致', () => {
  // asset-version.test.js 已经扫过 js/ 和 css/，这里针对本文件再钉一次：
  // 它写的是 Shadow DOM 内部，漏 bump 的症状是「只有浮窗样式不更新」，
  // 比全站漏 bump 更难从页面上看出来。
  const html = readFileSync(ROOT + 'index.html', 'utf8');
  const site = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]))];
  const m = /href="\/css\/style\.css\?v=(\d+)"/.exec(NEW_SRC);
  assert.ok(m, '源码里必须能读出 Shadow DOM 的 <link> 版本号');
  assert.equal(site.length, 1, '前提：全站本来就该只有一个版本号');
  assert.equal(m[1], site[0], '浮窗的 ?v= 与全站版本号不一致');
});

test('assistant-window：export 名单没变', () => {
  const names = (s) => [...s.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)].map((x) => x[1]);
  assert.deepEqual(names(NEW_SRC), names(OLD_SRC));
  assert.deepEqual(names(NEW_SRC), ['mountAssistantWindow']);
});
