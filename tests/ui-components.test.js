import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {formField} from '../js/ui/form-field.js';import {tabsMarkup,bindTabs} from '../js/ui/workspace.js';
test('shared form field preserves selected values, limits and escaped content',()=>{assert.match(formField('category','分类','select','road',{options:[['rail','铁路'],['road','道路']]}),/value="road" selected/);const text=formField('body','说明','textarea','<script>bad</script>',{required:false,maxlength:500});assert.match(text,/&lt;script&gt;/);assert.doesNotMatch(text,/<script>/);assert.match(text,/maxlength="500"/);assert.doesNotMatch(text,/\srequired\s/);});
test('shared tabs connect panels and keyboard switching updates the active tab exactly once',()=>{const html=tabsMarkup([{key:'dm',label:'私信'},{key:'notice',label:'通知'}],'dm',{id:'tabs',panelPrefix:'panel-'});assert.match(html,/id="tabs-dm"/);assert.match(html,/aria-controls="panel-dm"/);let selected=[];const buttons=['dm','notice'].map(key=>({dataset:{tabKey:key},attributes:{},setAttribute(k,v){this.attributes[k]=v;},focus(){this.focused=true;}}));bindTabs({querySelectorAll:()=>buttons},key=>selected.push(key));buttons[0].onkeydown({key:'ArrowRight',preventDefault(){}});assert.deepEqual(selected,['notice']);assert.equal(buttons[1].attributes['aria-selected'],'true');assert.equal(buttons[0].tabIndex,-1);buttons[1].onkeydown({key:'Home',preventDefault(){}});assert.deepEqual(selected,['notice','dm']);});
test('the runtime stylesheet is generated solely from the new style modules',()=>{
  const root=new URL('../',import.meta.url);
  // 模块清单从 build.mjs 里读，不在这里写死第二份 ——
  // 之前写成硬编码的 ['foundation',…,'motion']，加 chat.css 时就漂了，
  // 症状是产物比预期多一整段而测试报「+ actual - expected」。
  const build=fs.readFileSync(new URL('scripts/build.mjs',root),'utf8');
  const order=build.match(/const styleParts=\[([^\]]+)\]/);
  assert.ok(order,'build.mjs 里应能找到 styleParts 清单');
  const parts=order[1].split(',').map(s=>s.trim().replace(/^'|'$/g,'')).filter(Boolean);

  // 清单要和磁盘上的源文件一一对应：不能少列，也不能指向不存在的文件
  const onDisk=fs.readdirSync(new URL('css/source/',root)).filter(f=>f.endsWith('.css')).map(f=>f.replace(/\.css$/,'')).sort();
  assert.deepEqual([...parts].sort(),onDisk,'build.mjs 的 styleParts 清单和 css/source/ 里的文件对不上');

  const expected="@import url('./fonts.css');\n\n"+parts.map(n=>fs.readFileSync(new URL('css/source/'+n+'.css',root),'utf8')).join('\n').trimEnd()+'\n';
  assert.equal(fs.readFileSync(new URL('css/style.css',root),'utf8'),expected);
  assert.equal(fs.existsSync(new URL('css/layout.css',root)),false);
});

test('record components escape data titles and column headings',async()=>{const {recordCard}=await import('../js/ui/card.js');const {tableFrame,tableCell}=await import('../js/ui/table.js');assert.doesNotMatch(recordCard({title:'<img src=x onerror=bad>'}),/<img/);const table=tableFrame(['<script>'],`<tr>${tableCell('名称','safe')}</tr>`);assert.match(table,/&lt;script&gt;/);assert.match(table,/cell-label/);assert.doesNotMatch(table,/<script>/);});
