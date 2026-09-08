import {endpoint,identity,reply,fail} from '../../_core/request.js';
import {ticketReference} from '../../_core/ticket-policy.js';
import {autoDispatchSafely} from '../../_core/dispatch.js';
export const onRequestPost=c=>endpoint(async()=>{
 const admin=await identity(c,'admin'),ref=ticketReference(new URL(c.request.url).searchParams.get('id'));
 const ticket=await c.env.DB.prepare(`SELECT * FROM ${ref.table} WHERE id=?`).bind(ref.id).first();if(!ticket)fail(404,'工单不存在');
 if(ticket.target_admin_id&&admin.role!=='super'||ticket.target_admin_id===admin.id||ticket.target_player_id&&ticket.target_player_id===admin.linked_player_id)fail(403,'请由有权限且无需回避的管理员处理');
 return reply(await autoDispatchSafely(c,ref.ref));
});
