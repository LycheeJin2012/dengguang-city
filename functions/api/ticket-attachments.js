import {ticketEvent} from '../_core/ticket-policy.js';
import {endpoint,body,reply,fail} from '../_core/request.js';
import {uploadActor,ticketOwner,validateFiles,ticketFiles} from '../_core/uploads.js';
import {MAX_ATTACHMENTS} from '../../shared/uploads.js';
export const onRequestPost=c=>endpoint(async()=>{
 const input=await body(c.request),reference=String(input.ticket_id);await ticketOwner(c,reference);
 const actor=await uploadActor(c),files=await validateFiles(c,input.attachment_ids,actor);
 const count=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_ref=?').bind(reference).first();
 if(count.n+files.length>MAX_ATTACHMENTS)fail(400,`每个工单最多 ${MAX_ATTACHMENTS} 个附件`);
 if(!files.length)fail(400,'请先选择附件');
 await c.env.DB.batch([...files.map(file=>c.env.DB.prepare('INSERT INTO ticket_attachments(upload_id,ticket_ref) VALUES(?,?)').bind(file.id,reference)),ticketEvent(c.env.DB,reference,{type:actor.kind,id:actor.user.id,name:actor.user.username},'attachments_added',{names:files.map(f=>f.name)})]);
 return reply({attachments:await ticketFiles(c.env.DB,reference)});
});
