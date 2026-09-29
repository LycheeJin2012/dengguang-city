/**
 * Knowledge public page workspace.
 *
 * v79-6 拆分自 js/app/knowledge-public.js（2 行 minified）。仅修正 import 路径。
 */

import {$,api,field,action,esc,text,region} from '../../core.js'
export async function render(el){el.innerHTML='<h1>灯光市知识库</h1><p>只收录核对过、且原始资料没改过的答案。这里查不到的，交给灯灯转人工，别自己猜。</p><div class="toolbar">'+field('q','想问点啥','text','',{required:false,maxlength:500})+'<button id="knowledge-search">查一查</button></div><div id="knowledge-results"></div><a class="button" href="/dm.html">找灯灯转人工</a>';const load=query=>region($('#knowledge-results',el),()=>api('/api/knowledge?'+query),(d,box)=>box.innerHTML=d.articles.map(a=>`<article class="panel"><h2>#${a.id} ${esc(a.title)}</h2><p>${text(a.question)}</p><p>${text(a.answer)}</p><small>已核对 · v${a.revision}</small></article>`).join('')||'<p class="notice">知识库里还没有核对过的答案，这题得找人工问。</p>');$('#knowledge-search',el).onclick=e=>action(e.currentTarget,()=>load('q='+encodeURIComponent($('[name=q]',el).value)));const id=new URLSearchParams(location.search).get('id');if(id)await load('id='+encodeURIComponent(id));}