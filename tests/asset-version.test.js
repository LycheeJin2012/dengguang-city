// 静态资源版本号的一致性守门。
//
// 背景：v85 到 v88.6 一路改过来，13 个 HTML 的 `?v=` 一直卡在 84 没动。
// Cloudflare Pages 不接 GitHub 自动构建，本来靠手动部署掩盖了这个问题 ——
// 但只要哪次部署了，浏览器就会拿着 v84 的缓存，用户看到的就是「我明明改了
// 怎么没变」，而且很难联想到是缓存。
//
// 这里钉两件事：
//   1. 所有 HTML 引用资源必须用同一个版本号（不能一部分 84 一部分 89）
//   2. 版本号不能是陈旧值 —— 必须跟上当前进度标记
//      （读 package.json 的 version，v88.6 对应 51.0.0 这类主线版本不好直接
//       映射，所以改成：只要全站统一就不算漂移，另外要求它不是 1 位数、
//       也不是那个著名的 84）
//
// 更彻底的解法是在 build.mjs 里按 git SHA 自动注入，但那样每次构建都会
// 把工作区改脏、还要多提交一次「只改版本号」的 commit。这里选轻量方案：
// 人工 bump + 测试守住不漏。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HTML = readdirSync('.').filter((f) => f.endsWith('.html'));

/** 抽某个文件里所有 ?v= 号 */
const versionsIn = (src) => [...src.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);

/** 递归列出目录下的 .js / .css 相对路径 */
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const rel = join(dir, name);
    if (statSync(rel).isDirectory()) walk(rel, out);
    else if (/\.(js|css)$/.test(name)) out.push(rel);
  }
  return out;
};

test('所有 HTML 页面引用同一份资源版本号', () => {
  const seen = new Map();
  for (const f of HTML) {
    for (const v of versionsIn(readFileSync(f, 'utf8'))) {
      if (!seen.has(v)) seen.set(v, []);
      seen.get(v).push(f);
    }
  }
  assert.ok(seen.size > 0, '应该至少有一处 ?v= 引用');
  assert.equal(
    seen.size,
    1,
    `出现了 ${seen.size} 个不同版本号，会导致部分页面拿到旧缓存：\n` +
      [...seen].map(([v, files]) => `  v${v} → ${files.length} 个页面`).join('\n')
  );
});

test('每个 HTML 页面的 css 和 js 都带版本号（漏一个就是一个不刷新的入口）', () => {
  const missing = [];
  for (const f of HTML) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:href|src)="(\/(?:css|js)\/[^"?]+)(?:\?[^"]*)?"/g)) {
      if (!m[0].includes('?v=')) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('资源版本号不是历史上那个卡住没动的 84', () => {
  const all = new Set(HTML.flatMap((f) => versionsIn(readFileSync(f, 'utf8'))));
  assert.ok(!all.has('84'), '版本号还停在 84 —— 部署后浏览器会吃旧缓存');
});

test('资源版本号能对上当前进度', () => {
  // 本地 v88.8。低于这个数就说明改完 UI 忘了 bump。
  const MIN = 91;
  const all = [...new Set(HTML.flatMap((f) => versionsIn(readFileSync(f, 'utf8'))))].map(Number);
  for (const v of all) {
    assert.ok(v >= MIN, `资源版本号 v${v} 低于当前的 v${MIN}，改完 UI 忘了 bump`);
  }
});

// 上面三条只扫根目录的 *.html（readdirSync('.')），结构上看不见 js/ 里的硬编码。
// v88.6 就漏过一个：js/ui/assistant-window.js 给灯灯浮窗的 Shadow DOM 写死了
// /css/style.css?v=84。Shadow DOM 不继承宿主样式表，只认自己那条 <link>，
// 于是全站都 bump 到 89 了，唯独这个浮窗继续吃旧缓存。
//
// 这条把 js/ 和 css/ 一起扫进来，钉死「全站只有一个版本号」。
test('js/ 和 css/ 里硬编码的 ?v= 也和 HTML 保持同一个版本号', () => {
  const htmlVersions = new Set(HTML.flatMap((f) => versionsIn(readFileSync(f, 'utf8'))));
  assert.equal(htmlVersions.size, 1, '前提：HTML 那边本来就该只有一个版本号');
  const want = [...htmlVersions][0];

  const bad = [];
  for (const rel of [...walk('js'), ...walk('css')]) {
    for (const v of versionsIn(readFileSync(rel, 'utf8'))) {
      if (v !== want) bad.push(`${rel}: ?v=${v}（应为 ${want}）`);
    }
  }
  assert.deepEqual(bad, [], '以下文件里的资源版本号和 HTML 不一致，部署后会吃到旧缓存：\n' + bad.join('\n'));
});
