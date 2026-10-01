// 守门：后端路由的可达性判断不许靠「grep 前端有没有这个字符串」。
//
// ── 为什么要有这个文件 ────────────────────────────────────────────────────
// v88.8 做「死路由清理」时，判定依据是「全仓库没人 import、前端零调用」。
// 这个依据**错了 3 次**，而且错法各不相同：
//
//   1. api/messages.js —— 前端确实不调，但它是 messages 表**唯一**的写入
//      路径（:90 的 INSERT）。tickets.js 用 UNION 并进工单列表、
//      database.js 有 messages→tickets 同步迁移、dispatch.js 把它算进
//      工作量、ticket-updates.js 特判 source_table='messages'。
//      按「没人调」删掉，等于直接废掉留言板。
//
//   2. api/comments.js —— ticket-comments.js 根本没有 DELETE，
//      comments.js:72 是唯一的评论删除路径。
//
//   3. admin/dispatch-suggestion.js —— 前端确实不调，但 tests/platform.test.js
//      有**两条活测试**在打它（v53 就存在，早于本轮重写）：
//      「AI suggestions enforce recusal」和「AI dispatch accepts eligible IDs」。
//      删它就要连真实覆盖一起删。
//
// ── 真正该怎么判 ────────────────────────────────────────────────────────
// 「前端零字面量引用」**不是**死代码的证据。本项目的 admin 路径是
// **数据表拼出来的**：js/app/admin/shared.js:74-156 的 resources 表里
// `path: 'race-tracks'` / `'hotels'` / `'hotel-rooms'` / `'license-req'`
// / `'announcements'` / `'gallery'`，由 resourceList() 拼成
// `/api/admin/` + path。这 6 条在 js/ 里的**字面量引用数是 0**，但全都活着。
//
// 所以判据必须是三条并起来：
//   ① 数据表 path 条目   → js/app/admin/shared.js
//   ② 前端字面量          → js/**/*.js 与根目录 *.html 里的 /api/admin/<name>
//   ③ 测试引用            → tests/ 里的 admin/<name>
// 三条都落空才算孤儿候选；然后还要问「它是不是另一条路由的重复」和
// 「删了有没有别的东西被它喂」。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const walk = (rel, out = []) => {
  for (const name of readdirSync(new URL(rel, ROOT))) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    if (statSync(new URL(rel + name, ROOT)).isDirectory()) walk(rel + name + '/', out);
    else out.push(rel + name);
  }
  return out;
};

const JS_FILES = walk('js/');
const HTML_FILES = readdirSync(new URL('.', ROOT)).filter((f) => f.endsWith('.html'));
const API_FILES = walk('functions/').filter((f) => f.endsWith('.js'));
const TEST_FILES = walk('tests/').filter((f) => f.endsWith('.js') && f !== 'tests/dead-routes.test.js');

// ── ① admin 前端路径表 ────────────────────────────────────────────────────

/**
 * 从 shared.js 的 resources 表里抠出所有 `path: 'xxx'`。
 * 用行内的 path 字面量解析，而不是硬编码一份名单 —— 表变了这里自动跟着变。
 */
function tablePaths() {
  const src = read('js/app/admin/shared.js');
  return [...src.matchAll(/path: '([a-z-]+)'/g)].map((m) => m[1]);
}

// ── ② + ③ 前端字面量与测试引用 ───────────────────────────────────────────

/**
 * 某个 admin 路由名在代码里被引用了几处。
 *
 * 边界用 `admin/N(?![a-z0-9-])` 卡死：没有这个负向断言的话，
 * `license` 会命中 `license-req`、`kart` 会命中 `karting`，
 * 孤儿名单就会被这些子串污染成假阴性（看着有引用、其实没有）。
 */
function referenceCount(name) {
  const re = new RegExp(`admin/${name}(?![a-z0-9-])`, 'g');
  let n = 0;
  for (const rel of [...JS_FILES, ...HTML_FILES, ...API_FILES, ...TEST_FILES]) {
    n += (read(rel).match(re) || []).length;
  }
  return n;
}

// ── 已删除的 4 个孤儿 ─────────────────────────────────────────────────────

/**
 * 这 4 个文件在本轮被判定为死路由并删除。每条都必须写明**为什么**它不是
 * 「暂时没人调、以后要用」—— 判据见文件头。
 *
 * code/ 目录（js/ + functions/ + 根目录 *.html）里不许再出现这些名字：
 * 出现就说明有人又把调用接回去了，而端点已经不在了。tests/ 排除在外，
 * 因为「断言它没回来」这类测试本来就得写出这个名字。
 */
const REMOVED = {
  'functions/api/admin/manage-hotel.js': {
    reason:
      '后台酒店+房型的聚合只读（rooms 全量、不按 hotel_id 过滤）。前端 resources 表里 ' +
      'hotels→path:"hotels"、rooms→path:"hotel-rooms" 两条已经覆盖同样两张表，' +
      '只差排序与 500 条上限；没有任何测试或后端文件引用它',
  },
  'functions/api/admin/manage-track.js': {
    reason:
      '与 admin/race-tracks.js 逐字节等价（都是 resource("race-tracks")）。' +
      'resources 表 tracks→path:"race-tracks"，被调的是后者',
  },
  'functions/api/admin/manage-license-req.js': {
    reason:
      '与 admin/license-req.js 逐字节等价（都是 resource("license-req")）。' +
      'resources 表 requirements→path:"license-req"，被调的是后者',
  },
  'functions/api/admin/messages.js': {
    reason:
      '原站自己标注 "Legacy message-management API, backed by the unified ticket workflow"，' +
      'PATCH 直接委托 ../tickets.js。admin TABS 表里已无 messages 页签，' +
      '留言管理已并入工单中心（js/app/ticket-preview.js 还在处理 m: 前缀 ref）。' +
      '注意：留言板的写入路径是 api/messages.js，与本文件无关，别一起删',
  },
};

test('4 个死路由已删除，且代码里不再有对它们的调用', () => {
  for (const [rel, info] of Object.entries(REMOVED)) {
    assert.equal(existsSync(new URL(rel, ROOT)), false, `${rel} 已删除，别再加回来：${info.reason}`);
    const name = rel.replace('functions/api/admin/', '').replace(/\.js$/, '');
    for (const other of [...JS_FILES, ...HTML_FILES, ...API_FILES]) {
      const re = new RegExp(`admin/${name}(?![a-z0-9-])`);
      assert.equal(
        re.test(read(other)),
        false,
        `${other} 又引用了已删除的 admin/${name} —— 端点已经不在了`
      );
    }
  }
});

// ── 4. 别把活路由当孤儿删了 ───────────────────────────────────────────────

/**
 * dispatch-suggestion 是本轮差点被误删的活路由：前端不调，但 platform.test.js
 * 有两条实打实的测试在打它。这里把「文件存在 + 测试仍在打它」一起钉住。
 */
test('admin/dispatch-suggestion 仍在，且平台测试仍在打它（不是死路由）', () => {
  assert.equal(existsSync(new URL('functions/api/admin/dispatch-suggestion.js', ROOT)), true);
  const platform = read('tests/platform.test.js');
  const hits = (platform.match(/admin\/dispatch-suggestion/g) || []).length;
  assert.ok(hits >= 2, `platform.test.js 里只剩 ${hits} 处 dispatch-suggestion 引用，测试覆盖被删了？`);
});

// ── 5. 反向守门：admin/ 下不该再有新孤儿 ──────────────────────────────────

/**
 * 每一行都要写明理由；没理由的条目直接删掉。
 * 当前应当是**空的** —— 也就是说这个守门不是靠白名单开着的。
 */
const KNOWN_UNREFERENCED = [
  // 例：{ name: 'xxx', reason: '为什么它没人用却不能删' }
];

test('KNOWN_UNREFERENCED 每一条都写明了不能删的理由', () => {
  const noReason = KNOWN_UNREFERENCED.filter((k) => !k.reason || !k.reason.trim()).map((k) => k.name);
  assert.deepEqual(noReason, [], '这些条目没写理由，补上或删掉：\n' + noReason.join('\n'));
});

test('admin/ 下每个路由都至少有一条真实引用（数据表 / 前端字面量 / 测试）', () => {
  const paths = tablePaths();
  assert.ok(paths.length >= 6, `shared.js 的 resources 表只解析出 ${paths.length} 条 path，判据本身可能坏了`);

  const orphans = readdirSync(new URL('functions/api/admin/', ROOT))
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace(/\.js$/, ''))
    // 数据表里点名的算引用（前端就是拿这张表拼 URL 的）
    .filter((name) => !paths.includes(name))
    .filter((name) => referenceCount(name) === 0)
    .filter((name) => !KNOWN_UNREFERENCED.some((k) => k.name === name));

  assert.deepEqual(
    orphans,
    [],
    '以下 admin 路由三条判据全落空，很可能是新长出来的孤儿：\n' +
      orphans.map((o) => `  admin/${o} —— 删之前先按文件头那三条判据确认一遍`).join('\n')
  );
});

test('resources 表里每条 path 都有对应的后端路由文件', () => {
  const missing = tablePaths().filter((p) => !existsSync(new URL(`functions/api/admin/${p}.js`, ROOT)));
  assert.deepEqual(
    missing,
    [],
    'shared.js 的 resources 表点了名却找不到后端文件（改名时两处要一起改）：\n' + missing.join('\n')
  );
});

// ── 6. 判据自检：这套检测器本身必须能抓到东西 ─────────────────────────────

/**
 * 没有这条，上面那条反向守门可能因为正则写坏而**永远绿** ——
 * 假绿比不绿更贵。这里用已知的活路由/孤儿各测一遍。
 */
test('判据自检：活路由必须被判为「有引用」，孤儿必须被判为「没引用」', () => {
  // race-tracks：resources 表里有 path 条目 → 有引用
  assert.ok(tablePaths().includes('race-tracks'), 'race-tracks 应在 resources 表里');
  // license-req 同理；gallery 只有前端字面量 + 测试
  assert.ok(tablePaths().includes('gallery'), 'gallery 应在 resources 表里');
  // 真实存在且被测试覆盖的路由，引用数必须 > 0
  assert.ok(referenceCount('dispatch-suggestion') >= 2, 'dispatch-suggestion 应被 platform.test.js 引用');
  assert.ok(referenceCount('race-tracks') >= 2, 'race-tracks 应有字面量/测试引用');
  // 已删除的名字，引用数必须是 0（否则前一条守门在骗人）
  for (const name of ['manage-hotel', 'manage-track', 'manage-license-req', 'messages']) {
    const re = new RegExp(`admin/${name}(?![a-z0-9-])`);
    let n = 0;
    for (const rel of [...JS_FILES, ...HTML_FILES, ...API_FILES]) {
      if (re.test(read(rel))) n += 1;
    }
    assert.equal(n, 0, `admin/${name} 在代码里还有 ${n} 处引用`);
  }
  // 边界：子串不能互相命中（license ≠ license-req）
  const licenseOnly = read('js/app/admin/shared.js').includes("path: 'license'");
  assert.equal(licenseOnly, false, 'resources 表里不应有 path:"license"（会与 license-req 混淆）');
});
