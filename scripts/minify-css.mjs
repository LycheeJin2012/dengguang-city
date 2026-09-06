#!/usr/bin/env node
/**
 * minify-css.mjs — 纯 Node.js CSS 压缩器（零依赖）
 * 用法: node scripts/minify-css.mjs
 */
import { readFileSync, writeFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC  = resolve(ROOT, 'css/style.css');
const DST  = resolve(ROOT, 'css/style.min.css');

let css = readFileSync(SRC, 'utf8');
const before = css.length;

css = css
  // 删所有 /* ... */
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // 删 // 单行注释（万一有）
  .replace(/\/\/.*$/gm, '')
  // 合并多空行为单空格
  .replace(/[ \t]+/g, ' ')
  // 删换行（变成一行）
  .replace(/\n\s*/g, '\n')
  // 去掉行首尾空格
  .split('\n').map(l => l.trim()).join('\n')
  // 合并跨行空格
  .replace(/[ \t]+/g, ' ')
  // 删 ; 后跟 } 的多余分号
  .replace(/;}/g, '}')
  // 删 : 后空格
  .replace(/\s*:\s*/g, ':')
  // 删 { 后空格
  .replace(/\s*{\s*/g, '{')
  // 删 } 前空格
  .replace(/\s*}\s*/g, '}')
  // 删 , 后空格
  .replace(/,\s*/g, ',')
  // 删 ; 前空格
  .replace(/\s*;/g, ';')
  // 合并多个空格
  .replace(/\s{2,}/g, ' ')
  .trim();

// 恢复关键换行（保持可读性）
css = css
  .replace(/}/g, '}\n')
  .replace(/{/g, '{\n')
  .trim();

const after = css.length;
const pct   = ((1 - after / before) * 100).toFixed(1);

writeFileSync(DST, css, 'utf8');
console.log(`✅ CSS 压缩完成`);
console.log(`   原始: ${(before / 1024).toFixed(1)} KB`);
console.log(`   压缩: ${(after  / 1024).toFixed(1)} KB`);
console.log(`   节省: ${pct}%`);
