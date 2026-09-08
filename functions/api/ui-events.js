import {endpoint,body,string,reply,fail} from '../_core/request.js';
import {auditActor,auditStatement} from '../_core/audit.js';
export const onRequestPost=c=>endpoint(async()=>{
 const input=await body(c.request);if(!Array.isArray(input.events)||input.events.length>30)fail(400,'事件格式无效');
 const db=c.audit?.base||c.env.DB,actor=c.audit?.actor||await auditActor(db,c.request);
 const events=input.events.map(e=>{if(!['export'].includes(e.action))fail(400,'事件类型无效');return {action:'ui.'+e.action,resource_type:'ui',resource_id:string(e.element||'page','元素',100),path:string(e.page||'/','页面',200),details:{label:string(e.label||'','操作',120,{required:false})},status:200,request_id:c.audit?.requestId};});
 await db.batch(events.map(e=>auditStatement(db,actor,e)));return reply({recorded:events.length});
});
