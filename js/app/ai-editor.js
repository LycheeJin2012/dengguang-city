import {$,post,field,tr,action,toast} from './core.js';
export function attachAiEditor(dialog,{ticketId,targetName,endpoint='/api/admin/ai-draft',context=''}){
 const target=$(`[name=${targetName}]`,dialog),panel=document.createElement('details');panel.className='wide ai-editor';
 panel.innerHTML=`<summary>${tr('AI 辅助：起草、修改与摘要','AI assistance: draft, revise & summarize')}</summary><p class="muted">${tr('可填写语气、重点或需要补充的问题。AI 不会代你发送；事实和处理承诺须人工核实。','Specify tone, focus or follow-up questions. Nothing is sent automatically; verify facts and commitments.')}</p>${field('ai-instructions',tr('给 AI 的补充要求','Instructions for AI'),'textarea','',{required:false,maxlength:1000})}<div class="actions"><button type="button" data-ai-mode="reply">${tr('生成回复草稿','Draft reply')}</button><button type="button" data-ai-mode="rewrite">${tr('修改当前回复文字','Revise current reply')}</button><button type="button" data-ai-mode="summary">${tr('整理问题摘要 / 待核实项','Summarize / identify unknowns')}</button></div>${field('ai-preview',tr('AI 草稿预览（未发送）','AI draft preview (not sent)'),'textarea','',{required:false})}<p class="muted" role="status" data-ai-note></p><button type="button" data-ai-apply disabled>${tr('将草稿填入回复框','Use draft in reply')}</button>`;
 target.closest('label')?.after(panel);if(!panel.isConnected)$('form',dialog).append(panel);
 let snapshot='',generation=0;
 panel.querySelectorAll('[data-ai-mode]').forEach(button=>button.onclick=e=>action(e.currentTarget,async()=>{
  const revision=++generation,current=target.value;panel.querySelector('[data-ai-apply]').disabled=true;
  const r=await post(endpoint,{ticket_id:ticketId,content:context,mode:button.dataset.aiMode,instructions:$('[name=ai-instructions]',panel).value,existing:current});
  if(revision!==generation||!dialog.isConnected)return;snapshot=current;$('[name=ai-preview]',panel).value=r.draft;$('[data-ai-note]',panel).textContent=r.note+(r.sources?.length?' 依据：'+r.sources.map(s=>'知识 #'+s.id+' v'+s.revision+' '+s.title).join('；'):'');$('[data-ai-apply]',panel).disabled=button.dataset.aiMode==='summary';
 }));
 $('[data-ai-apply]',panel).onclick=()=>{if(target.value!==snapshot){toast(tr('回复文字已变化，请重新生成以免覆盖新内容','Reply changed; regenerate to avoid overwriting edits'));return;}target.value=$('[name=ai-preview]',panel).value;toast(tr('已填入回复框，仍需保存才会发送','Added to reply. Save to send.'));};
}
