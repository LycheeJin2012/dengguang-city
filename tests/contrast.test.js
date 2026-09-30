// 深色底上的文字对比度回归测试。
//
// 起因：页头「市民名」是 <a>，#account 只给 .balance 和直接子 span 反白了颜色，
// 链接漏网后掉回全局链接色，深绿底上几乎读不出来（用户报「玩家名字都看不清」）。
//
// 这里把页头 / 导航条 / hero 这几块深色表面上的文字钉成契约：
//   - 这些选择器必须自己声明 color（不能靠继承碰运气）
//   - 前景 × 背景的 WCAG 对比度必须 ≥ 4.5:1（AA 正文标准）
// 背景取 foundation.css 里 token 的**当前色值**，所以有人把 --green 调深，
// 这条测试会自己变红，不需要手动更新期望值。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'css', 'source');

// ---------- 解析 CSS ----------

const css = readdirSync(SRC)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(SRC, f), 'utf8'))
  .join('\n')
  // 注释必须先剥掉：正则 `([^{}]+)\{` 会把紧挨在规则前的注释
  // 一并吞进「选择器」里，`#account a` 就变成了 `/* v88.6 … */ #account a`，
  // 精确匹配全部落空。替换成空串（不是空格），免得把 `.a/*c*/.b` 变成后代选择器。
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** 抽出 :root 里的 --token: #hex */
const TOKENS = new Map();
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
  if (!TOKENS.has(m[1])) TOKENS.set(m[1], m[2]);
}

/** 拆成 [{selectors:[], body}] */
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
  body: m[2],
}));

/**
 * 合并某选择器的声明。**精确匹配**选择器字符串，不能用子串包含——
 * 否则 `#navigation a[aria-current=page]` 会把 `color:var(--ink)` 串到
 * `#navigation a` 上，算出「白字其实被算成黑字」这种假结论。
 */
function declsExact(selector) {
  const out = {};
  let found = false;
  for (const r of RULES) {
    if (!r.selectors.includes(selector)) continue;
    found = true;
    for (const d of r.body.split(';')) {
      const i = d.indexOf(':');
      if (i === -1) continue;
      out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return found ? out : null;
}

/**
 * 算出「实际生效」的颜色：自己没有 color 就沿选择器往上继承。
 * 本项目 CSS 是平铺的类式写法，逐级砍掉最后一段复合选择器就能近似出父级。
 * 这条继承链正是本次的坑——`#account a` 没有任何 color，
 * 一路继承到 body 的全局链接色，在深绿底上直接糊掉。
 */
function effectiveColor(selector) {
  let cur = selector;
  while (cur) {
    const d = declsExact(cur);
    if (d?.color) return d.color;
    const i = Math.max(cur.lastIndexOf(' '), cur.lastIndexOf('>'));
    if (i <= 0) break;
    cur = cur.slice(0, i).replace(/[>+]+$/, '').trim();
  }
  return null;
}

function resolveColor(value) {
  if (!value) return null;
  const v = value.trim();
  const tok = v.match(/^var\(\s*(--[a-z0-9-]+)/);
  if (tok) return TOKENS.get(tok[1]) ?? null;
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  return null; // rgba()/渐变/关键字一律不参与判定，避免误报
}

// ---------- WCAG 对比度 ----------

function srgbToLin(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---------- 契约 ----------

// selector: 必须自己声明颜色的选择器
// surface:  背景 token 名（从 foundation.css 取当前色值）
const CONTRACT = [
  ['#account a', '--green', '页头市民名（本次修的就是这条）'],
  ['#account .balance', '--green', '页头钻石余额'],
  ['#account>span', '--green', '页头管理员名'],
  ['#header button', '--paper', '页头按钮文字'],
  ['#header .primary', '--gold', '页头主按钮「我是市民」'],
  ['#navigation a', '--green-deep', '导航条常规项'],
  ['#navigation a[aria-current=page]', '--gold', '导航条当前页'],
  ['.welcome-lead h1', '--green', 'hero 主标题'],
  ['.welcome-lead>p', '--green', 'hero 副文案'],
  ['.brand strong', '--green', '页头站名'],
  ['.brand small', '--green', '页头站名副标题'],
  ['.welcome-lead .eyebrow', '--gold', 'hero 徽标'],
];

test('深色表面上的文字都能解析出生效颜色', () => {
  const missing = [];
  for (const [sel, , why] of CONTRACT) {
    const c = effectiveColor(sel);
    if (!c || !resolveColor(c)) {
      missing.push(`${sel}（${why}）沿继承链也拿不到颜色 —— 最终会掉回全局链接色`);
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('深色表面上的文字对比度 ≥ 4.5:1（WCAG AA）', () => {
  const bad = [];
  for (const [sel, surface, why] of CONTRACT) {
    const fg = resolveColor(effectiveColor(sel));
    const bg = resolveColor(`var(${surface})`);
    if (!fg || !bg) {
      bad.push(`${sel}（${why}）色值无法解析：fg=${fg} bg=${bg}`);
      continue;
    }
    const ratio = contrast(fg, bg);
    if (ratio < 4.5) {
      bad.push(`${sel}（${why}）${fg} on ${bg} = ${ratio.toFixed(2)}:1，低于 4.5:1`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('对比度计算本身是对的（拿已知值校准）', () => {
  // 黑底白字是 WCAG 的上限 21:1
  assert.ok(Math.abs(contrast('#ffffff', '#000000') - 21) < 0.01);
  // 同色对比度是 1:1
  assert.ok(Math.abs(contrast('#4a7a24', '#4a7a24') - 1) < 0.001);
  // 白底上的中灰 #767676 是 AA 正好压线 4.54:1
  assert.ok(contrast('#767676', '#ffffff') >= 4.5);
  // #777 差一点没过线，用来确认阈值不是随便定的
  assert.ok(contrast('#777777', '#ffffff') < 4.5);
});
