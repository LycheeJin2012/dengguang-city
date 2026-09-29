import {$,post,field,action,toast} from './core.js'
export function attachAiEditor(dialog,{ticketId,targetName,endpoint='/api/admin/ai-draft',context=''}){
 const target=$(`[name=${targetName}]`,dialog),panel=document.createElement('details');panel.className='wide ai-editor';
 panel.innerHTML=`<summary>${'AI 搭把手：起草、改写、列要点'}</summary><p class="muted">${'它只写草稿，不会替你发出去。事实、时间、承诺都要自己核。'}</p>${field('ai-instructions','想让它怎么写','textarea','',{required:false,maxlength:1000})}<div class="actions"><button type="button" data-ai-mode="reply">${'起草回复'}</button><button type="button" data-ai-mode="rewrite">${'改写这段'}</button><button type="button" data-ai-mode="summary">${'列要点'}</button></div>${field('ai-preview','草稿（还没发）','textarea','',{required:false})}<p class="muted" role="status" data-ai-note></p><button type="button" data-ai-apply disabled>${'填进回复框'}</button>`;
 target.closest('label')?.after(panel);if(!panel.isConnected)$('form',dialog).append(panel);
 let snapshot='',generation=0;
 panel.querySelectorAll('[data-ai-mode]').forEach(button=>button.onclick=e=>action(e.currentTarget,async()=>{
  const revision=++generation,current=target.value;panel.querySelector('[data-ai-apply]').disabled=true;
  const r=await post(endpoint,{ticket_id:ticketId,content:context,mode:button.dataset.aiMode,instructions:$('[name=ai-instructions]',panel).value,existing:current});
  if(revision!==generation||!dialog.isConnected)return;snapshot=current;$('[name=ai-preview]',panel).value=r.draft;$('[data-ai-note]',panel).textContent=r.note+(r.sources?.length?' 依据：'+r.sources.map(s=>'知识 #'+s.id+' v'+s.revision+' '+s.title).join('；'):'');$('[data-ai-apply]',panel).disabled=button.dataset.aiMode==='summary';
 }));
 $('[data-ai-apply]',panel).onclick=()=>{if(target.value!==snapshot){toast('你手改过回复框了，重新生成一份再填，别盖掉新写的');return;}target.value=$('[name=ai-preview]',panel).value;toast('填好了，存下才真的发出去');};
}
