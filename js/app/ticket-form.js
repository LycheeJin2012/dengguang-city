import {$,api,post,field,modal,requirePlayer,tr,toast,esc,text,ticketBody,status} from './core.js';
import {attachmentPicker,renderAttachments} from './attachments.js';
import {MAX_ATTACHMENTS} from '../../shared/uploads.js';
export async function createTicket({kind='service',onCreated=()=>{}}={}){
 await requirePlayer();let picker;
 const dialog=modal(tr('提交工单','Create ticket'),field('kind',tr('事项类型','Request type'),'select',kind,{options:[['service',tr('市民服务','Citizen service')],['bug',tr('反馈 Bug','Report a bug')],['report',tr('举报违规','Report misconduct')]]})+field('title',tr('简要标题','Title'),'text','',{maxlength:90})+field('body',tr('详细说明','Description'),'textarea')+`<p class="muted wide">${tr('请说明发生时间、相关位置或账号，以及问题的复现步骤。附件仅供你和管理员查看。','Include when and where it happened, relevant accounts, and steps to reproduce. Attachments are visible only to you and administrators.')}</p>`,{wide:true,label:tr('提交工单','Submit ticket'),submit:async values=>{
  const ids=picker.ids();const result=await post('/api/tickets',{...values,attachment_ids:ids});picker.commit();toast(tr('工单已提交，附件已保存','Ticket submitted with attachments'));
  try{await onCreated(result);}catch(e){toast(e.message,true);}
 }});
 picker=attachmentPicker(dialog);return dialog;
}
export async function viewCitizenTicket(id,{onChanged=()=>{}}={}){
 const data=await api('/api/tickets?my=1&id='+encodeURIComponent(id)),ticket=data.ticket;let picker;
 const remaining=MAX_ATTACHMENTS-(ticket.attachments||[]).length;
 const dialog=modal(ticket.title,`<div class="wide"><p>${status(ticket.status)}</p><div>${ticketBody(ticket.body)}</div>${ticket.admin_reply?`<div class="notice"><b>${tr('管理员回复','Administrator reply')}</b><p>${text(ticket.admin_reply)}</p></div>`:''}${renderAttachments(ticket.attachments)}</div>`,{wide:true,label:tr('补充附件','Add attachments'),submit:remaining>0?async()=>{
  const ids=picker.ids();if(!ids.length)throw new Error(tr('请先选择附件','Select an attachment first'));
  await post('/api/ticket-attachments',{ticket_id:String(ticket.id),attachment_ids:ids});picker.commit();toast(tr('补充材料已保存','Attachments saved'));try{await onChanged();}catch(e){toast(e.message,true);}
 }:null});
 if(remaining>0)picker=attachmentPicker(dialog,{max:remaining,existingBytes:(ticket.attachments||[]).reduce((sum,file)=>sum+file.size,0)});return dialog;
}
