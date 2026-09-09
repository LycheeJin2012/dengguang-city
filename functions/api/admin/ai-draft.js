import {searchKnowledge,citation} from '../../_core/knowledge.js';
import {endpoint,identity,body,string,fail,reply} from '../../_core/request.js';
import {ticketReference} from '../../_core/ticket-policy.js';
import {aiDraft} from '../../_shared/ai.js';
import {auditStatement} from '../../_core/audit.js';
export const onRequestPost=c=>endpoint(async()=>{
 const admin=await identity(c,'admin'),b=await body(c.request),mode=b.mode||'reply';
 if(!['reply','rewrite','summary'].includes(mode))fail(400,'草稿类型无效');
 const ref=ticketReference(b.ticket_id),t=await c.env.DB.prepare(`SELECT * FROM ${ref.table} WHERE id=?`).bind(ref.id).first();
 if(!t)fail(404,'工单不存在');
 if(t.target_admin_id===admin.id||t.target_player_id&&t.target_player_id===admin.linked_player_id||t.target_admin_id&&admin.role!=='super')fail(403,'该工单需要回避，请由有权限的其他管理员处理');
 const instructions=string(b.instructions||'','补充要求',1000,{required:false}),existing=string(b.existing||'','已有文字',2000,{required:false});
 if(mode==='rewrite'&&!existing)fail(400,'请先填写要修改的文字');
 const references=await searchKnowledge(c.env.DB,(t.title||'')+' '+(t.body||t.content||''),['public','staff']);
 const history=(await c.env.DB.prepare('SELECT actor_name,action,details,created_at FROM ticket_events WHERE ticket_ref=? ORDER BY id DESC LIMIT 12').bind(ref.ref).all()).results;
 const result=await aiDraft(c.env,{message:String(t.body||t.content||'').slice(0,4000),instructions,existing,mode,references:[...references.map(r=>({id:r.id,title:r.title,content:r.answer})),{type:'本单办理记录，不能作为其他工单事实',events:history}]});
 await auditStatement(c.audit?.base||c.env.DB,{type:'admin',id:admin.id,name:admin.username},{action:'ai.draft_created',resource_type:'tickets',resource_id:ref.ref,status:200,details:{mode,source:result.source,instructions,existing_length:existing.length,sent:false}}).run();
 return reply({...result,sources:references.map(citation)});
});
