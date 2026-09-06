// v50-N5: i18n 字典完整性自验 (Node 22+ 内置 test runner)
// 运行: node --test js/i18n/core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corePath = join(__dirname, 'core.js');
const coreSrc = readFileSync(corePath, 'utf8');

// 解析 DICT (简单手写解析, 不用 eval)
function parseDict(src) {
  const dict = {};
  const re = /^\s*'([a-z][a-zA-Z0-9._-]+)':\s*\{\s*'zh-CN':\s*'([^']*)',\s*'en':\s*'([^']*)'\s*\}/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    dict[m[1]] = { 'zh-CN': m[2], en: m[3] };
  }
  return dict;
}

const DICT = parseDict(coreSrc);

test('DICT 不为空', () => {
  const keys = Object.keys(DICT);
  assert.ok(keys.length > 0, '字典应该至少有一个 key');
  console.log(`  → 字典有 ${keys.length} 个 key`);
});

test('每个 key 都有 zh-CN + en 双语', () => {
  for (const [key, val] of Object.entries(DICT)) {
    assert.ok(val['zh-CN'] !== undefined, `${key} 缺 zh-CN`);
    assert.ok(val['en'] !== undefined, `${key} 缺 en`);
    assert.notEqual(val['zh-CN'], '', `${key} zh-CN 不能为空字符串`);
    assert.notEqual(val['en'], '', `${key} en 不能为空字符串`);
  }
});

test('所有 data-i18n 引用都有定义', () => {
  // 抓 index.html / hotel.html / profile.html / dm.html / admin-v37.html
  const htmlFiles = ['index.html', 'hotel.html', 'profile.html', 'dm.html', 'admin-v37.html'];
  const usedKeys = new Set();
  for (const f of htmlFiles) {
    const html = readFileSync(join(__dirname, '..', '..', f), 'utf8');
    const re = /data-i18n(?:-title|-placeholder)?="([a-z][a-zA-Z0-9._-]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) usedKeys.add(m[1]);
  }
  for (const k of usedKeys) {
    assert.ok(DICT[k], `HTML 引用了未定义的 key: ${k}`);
  }
  console.log(`  → HTML 静态引用 ${usedKeys.size} 个 key, 全部有定义`);
});

test('所有 JS t(\'...\') 调用都有定义', () => {
  // 递归扫所有 .js 找 t('xxx.yyy') 调用
  const root = join(__dirname, '..', '..');
  const used = new Set();
  const scan = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.git') continue;
        scan(p);
      } else if (name.endsWith('.js')) {
        // 跳过本测试文件 (里面有注释 "t('xxx.yyy')" 会被误匹配)
        if (p === join(__dirname, 'core.test.js')) continue;
        const txt = readFileSync(p, 'utf8');
        const re = /t\(\s*'([a-z]+\.[a-z._-]+)'/g;
        let m;
        while ((m = re.exec(txt)) !== null) used.add(m[1]);
      }
    }
  };
  scan(root);
  // 过滤掉 core.js 注释里的示例 (这些不是真调用)
  used.delete('hero.cta');  // core.js 注释: t('hero.cta') → '查看公告'
  used.delete('key.path'); // core.js 注释: t('key.path')
  for (const k of used) {
    assert.ok(DICT[k], `JS t() 调用了未定义的 key: ${k}`);
  }
  console.log(`  → JS t() 实际调用 ${used.size} 个 key, 全部有定义`);
});

test('DICT 没有重复 key', () => {
  const re = /^\s*'([a-z][a-zA-Z0-9._-]+)':\s*\{/gm;
  const seen = new Map();
  let m;
  while ((m = re.exec(coreSrc)) !== null) {
    const k = m[1];
    if (seen.has(k)) assert.fail(`重复 key: ${k}`);
    seen.set(k, true);
  }
});

test('命名空间一致性 (group 子 key 必须在父 namespace 下)', () => {
  const groups = {};
  for (const k of Object.keys(DICT)) {
    const dot = k.indexOf('.');
    if (dot === -1) continue;
    const ns = k.slice(0, dot);
    groups[ns] = (groups[ns] || 0) + 1;
  }
  // 检查: 至少有 nav.* / admin.* / hotel.* / profile.* / dm.* / page.* / ph.* 之一
  assert.ok(groups.nav >= 5, 'nav.* 应该至少 5 个');
  assert.ok(groups.hotel >= 5, 'hotel.* 应该至少 5 个');
  console.log(`  → 命名空间分布: ${JSON.stringify(groups)}`);
});
