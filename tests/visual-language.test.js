// 视觉语言的守门测试。
//
// 这个站的设计语言是**真像素风**：亮纸面 + 纯黑硬边 + 实心偏移影 + 0 圆角。
// 这不是审美偏好，是已经反复验证过的结论 —— v88 试过液态玻璃
// （backdrop-filter + 半透明 + 圆角 + 高光），跟周围 3px 硬边完全是两套
// 设计语言，用户要求整体撤回。
//
// 代价是这类风格很容易被「顺手优化」破坏：某天有人觉得加载动画太平，
// 加个渐变微光；或者觉得按钮太方，加个 border-radius。单看都合理，
// 合起来就是全站语言垮掉。
//
// 所以把这几条钉成测试。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'css/source';
const FILES = readdirSync(SRC).filter((f) => f.endsWith('.css')).map((f) => join(SRC, f));

/**
 * 去掉注释，免得注释里提一嘴 backdrop-filter 就报警。
 *
 * 关键：不能直接替换成空串。这个站的注释动辄十几行，`[\s\S]*?` 会把中间的
 * 换行一起吃掉，后面所有行的行号就全错了，报错时定位不到地方。
 * 所以用等量的换行把行数补回去。
 */
const read = (f) =>
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => '\n'.repeat((m.match(/\n/g) || []).length));

/**
 * 扫全部样式源文件。allow(match, line) 返回 true 表示这条命中是合法的、
 * 不计入问题。报错时给出行号，方便定位。
 */
function scan(pattern, allow = () => false) {
  const hits = [];
  for (const f of FILES) {
    read(f).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(pattern)) {
        if (allow(m, line)) continue;
        hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
      }
    });
  }
  return hits;
}

test('没有圆角 —— 像素风要求 0', () => {
  const hits = scan(/border-radius\s*:\s*([^;}]+)/g, (m) => {
    const v = m[1].trim();
    return v === '0' || v === '0px' || v === '0 0' || v.startsWith('0 ');
  });
  assert.deepEqual(hits, [], `出现了圆角：\n${hits.join('\n')}`);
});

test('没有 backdrop-filter —— 液态玻璃方案已整体撤回', () => {
  const hits = scan(/backdrop-filter\s*:/g);
  assert.deepEqual(hits, [], `又混进毛玻璃了：\n${hits.join('\n')}`);
});

/** :root 里的 --token: 值 */
const TOKENS = new Map();
for (const f of FILES) {
  for (const m of read(f).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
    if (!TOKENS.has(m[1])) TOKENS.set(m[1], m[2].trim());
  }
}

/** 把 var(--x) 展开到字面值（最多递归 5 层，防环） */
function resolve(value, depth = 0) {
  if (depth > 5) return value;
  return value.replace(/var\(\s*(--[a-z0-9-]+)\s*\)/g, (_, name) => {
    const v = TOKENS.get(name);
    return v === undefined ? '' : resolve(v, depth + 1);
  });
}

test('没有模糊投影 —— 用实心偏移影代替', () => {
  // box-shadow 的长度序列是 x y [blur] [spread]。第三个数是 0 才没有模糊；
  // 只给两个数（x y）默认 blur 也是 0。所以判据是「第三个长度值非 0」。
  //
  // 第一版这个测试写错了两个地方，都记在下面免得再犯：
  //   · 见到 3 个长度值就报 —— `3px 3px 0` 是实心影，第三个是 0
  //   · 不解析 var() —— 而这个站的阴影几乎全走 --shadow / --shadow-soft
  const hits = [];
  for (const f of FILES) {
    read(f).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
        const value = resolve(m[1].trim());
        if (value === 'none' || !value) continue;
        // 一条声明里可能有多个逗号分隔的阴影，逐个看
        for (const shadow of value.split(',')) {
          const lengths = shadow.match(/-?[\d.]+(?:px|rem|em)/g) || [];
          const blur = lengths.length >= 3 ? parseFloat(lengths[2]) : 0;
          if (blur !== 0) {
            hits.push(`${f}:${i + 1}  blur=${blur}  ${line.trim().slice(0, 90)}`);
          }
        }
      }
    });
  }
  assert.deepEqual(hits, [], `出现了模糊投影：\n${hits.join('\n')}`);
});

test('阴影确实存在（别为了躲上一个测试把立体感一起删了）', () => {
  // 反向守门：0 圆角 + 3px 硬边的像素风，靠的是实心偏移影撑出层次。
  // 上一条测试如果写得太宽，可能反过来把所有阴影都判成 blur 逼人删掉。
  const withShadow = FILES.filter((f) => /box-shadow\s*:\s*(?!none)/.test(read(f)));
  assert.ok(withShadow.length >= 4, `阴影用得太少，像素风会塌成纯色块：只有 ${withShadow.length} 个文件用`);
});

/** 按括号深度取出 gradient(...) 的参数部分 */
function gradientArgs(src, from) {
  const start = src.indexOf('(', from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return { args: src.slice(start + 1, i), end: i };
    }
  }
  return null;
}

test('没有平滑渐变 —— 只允许硬色标（像素图 / 网格线）', () => {
  // 硬色标像 linear-gradient(#7aa62e 0 35%,#8d633d 35%)：
  // 每个色标后面都带明确位置，边界是硬的。平滑渐变则是相邻色标没有各自的
  // stop 位置，中间靠浏览器插值 —— 那正是 v88 想从加载态里撤掉的东西。
  //
  // 参数提取必须按括号深度取，不能用 `[^)]*`：第一个右括号往往落在
  // `var(--grid)` 里面，截断后色标全丢，会把网格线误判成平滑渐变。
  const hits = [];
  for (const f of FILES) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/\b(linear|radial|conic)-gradient\(/g)) {
      const got = gradientArgs(src, m.index);
      if (!got) continue;
      // 逗号可能在 var() 内部，按深度再切一层
      const stops = [];
      let depth = 0, buf = '';
      for (const c of got.args) {
        if (c === '(') depth++;
        else if (c === ')') depth--;
        if (c === ',' && depth === 0) { stops.push(buf); buf = ''; continue; }
        buf += c;
      }
      stops.push(buf);

      const hard = stops.every((s) => /(^|\s)(-?[\d.]+(?:%|px|rem|em|deg|turn))(\s|$)/.test(s.trim()));
      if (!hard) {
        const line = src.slice(0, m.index).split('\n').length;
        hits.push(`${f}:${line}  ${stops.join(' | ').trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(hits, [], `出现了平滑渐变：\n${hits.join('\n')}`);
});

test('像素字体只用在界面构件上，不铺正文', () => {
  // 16px 下点阵中文笔画会糊成一片，所以正文必须用系统无衬线。
  //
  // 判据写成「挑出属于正文的」而不是「列出允许的」：这个站里点阵字体用在
  // 标题、按钮、徽章、导航项、eyebrow 上是设计决定，范围会随新组件增加；
  // 写允许清单就得不停往里补，漏补一次等于没检查。反过来只盯真正承载
  // 正文的元素，新增组件时也不会误报。
  const BODY_COPY =
    /(^|[\s,{>])(body|html|main|p|li|dd|dt|small|label|\.bubble p|\.card-content|\.prewrap|\.notice|\.muted|input|textarea|select|option)\b/;
  const hits = scan(/font-family\s*:\s*([^;}]+)/g, (m, line) => {
    if (!m[1].includes('--font-pixel')) return true; // 不是点阵字体，放行
    return !BODY_COPY.test(line);                   // 是正文 → 不放行
  });
  assert.deepEqual(hits, [], `正文用上了点阵字体：\n${hits.join('\n')}`);
});

test('正文默认字体是系统无衬线（.prewrap 这类长文本尤其不能上点阵）', () => {
  // 交叉验证：确认 .prewrap / .bubble 这类正文容器确实没被点阵字体覆盖
  const prewrap = FILES.flatMap((f) =>
    read(f).split('\n').map((l, i) => [f, i + 1, l])
  ).filter(([, , l]) => /\.prewrap|\.bubble\b|\.card-content/.test(l));

  const offenders = prewrap.filter(([, , l]) => l.includes('--font-pixel'));
  assert.deepEqual(offenders, [], `正文容器上用了点阵字体：\n${offenders.map((f, n, l) => `${f}:${n} ${l}`).join('\n')}`);
});

test('硬边框统一用纯黑 token，不用随手写的深色', () => {
  // 像素风的关键是「所有边框同一个纯黑」。用十六进制随手写深色会
  // 让边框之间出现色差，整站的硬边就不齐了。
  const hits = scan(/border(?:-[a-z]+)?\s*:\s*[^;}]*?(#[0-9a-fA-F]{3,8})/g, (m, line) => {
    // 允许的是 token 引用；这里抓的是裸十六进制
    return line.includes('var(--');
  });
  assert.deepEqual(hits, [], `边框用了裸十六进制而不是 --line：\n${hits.join('\n')}`);
});

test('颜色一律走 token，没有游离的旧色', () => {
  // v87/v88 换了两轮配色，components.css 里还散着一批 v86 之前的米黄
  // （#e5dec0 / #b9af8b / #c7bea0 / #e5dfb4 …）。它们看着「差不多」，
  // 但改 token 时不会跟着变，久了就是两套配色并存。
  //
  // 允许的例外，都是有意为之的：
  //   · 半透明黑（#0001 #0004 #0006）—— 实心偏移影的浓淡层次
  //   · 弹窗遮罩（#222715a8）—— 跟调色板无关的 scrim
  //   · 草方块的像素图（#7aa62e / #8d633d / #c6dc68 …）—— 画的是 Minecraft 草地
  //   · 地图底纹（#496a2020）和工地棕（#8b4424）
  const ALLOW = [
    /^#000[0-9a-f]{1,2}$/i,   // 半透明黑
    /^#222715a8$/i,          // 弹窗遮罩
    /^#496a2020$/i,          // 地图网格线
    /^#8b4424$/i,            // 工地土色
    /^#7aa62e$|^#8d633d$|^#c6dc68$|^#4b7020$|^#65462f$/i, // 草方块像素
    /^#1d3409$/i,            // hero 标题的硬文字影
  ];
  const problems = [];
  for (const f of FILES) {
    read(f).split('\n').forEach((line, i) => {
      // :root 里的定义本身就是色值，不算游离
      if (/^\s*--[a-z0-9-]+\s*:/.test(line)) return;
      for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        const hex = m[0];
        if (ALLOW.some((r) => r.test(hex))) continue;
        problems.push(`${f}:${i + 1}  ${hex}  ${line.trim().slice(0, 80)}`);
      }
    });
  }
  assert.deepEqual(problems, [], `出现了没走 token 的颜色：\n${problems.join('\n')}`);
});

test('样式源文件都进了构建清单（漏进清单的规则等于没写）', () => {
  const build = readFileSync('scripts/build.mjs', 'utf8');
  const m = build.match(/const styleParts=\[([^\]]+)\]/);
  assert.ok(m, 'build.mjs 里应能找到 styleParts 清单');
  const parts = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  const onDisk = readdirSync(SRC).filter((f) => f.endsWith('.css')).map((f) => f.replace(/\.css$/, '')).sort();
  assert.deepEqual([...parts].sort(), onDisk, 'build.mjs 的 styleParts 和 css/source/ 对不上');
});

test('每个源文件都有内容（空文件说明重构时误删）', () => {
  const empty = FILES.filter((f) => read(f).trim().length === 0);
  assert.deepEqual(empty, [], `这些文件是空的：\n${empty.join('\n')}`);
});
