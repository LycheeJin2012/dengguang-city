import {basicReply} from '../_shared/ai.js';

// Runs immediately after the creation event in the same transaction. The reply
// table is WITHOUT ROWID, preserving the event ID while the next statement reads it.
//
// 三条语句靠 `WHERE changes()=1` 串成一条链：上一条真的改到行了，下一条才写。
// 所以调用方必须把返回的数组原样塞进同一个 db.batch()，不能拆开执行。
export function firstReplyAfterEvent(db,kind){
 const content=basicReply(kind);
 // last_insert_rowid() 只有在同一连接、紧跟上一次插入时才是那张新工单；
 // 用子查询回读 ticket_ref，比在前端维护一个中间变量可靠。
 const ref='(SELECT ticket_ref FROM ticket_events WHERE id=last_insert_rowid())';
 return [
  db.prepare(`INSERT OR IGNORE INTO ticket_auto_replies(ticket_ref,content) SELECT ${ref},? WHERE changes()=1`).bind(content),
  db.prepare(`INSERT INTO ticket_events(ticket_ref,actor_type,actor_id,actor_name,action,details) SELECT ${ref},'system',NULL,'灯灯','auto_replied',? WHERE changes()=1`).bind(JSON.stringify({reply:content,source:'reviewed_template'})),
  db.prepare(`INSERT INTO audit_events(actor_type,actor_name,action,resource_type,resource_id,http_status,details) SELECT 'system','灯灯','ticket.auto_replied','tickets',${ref},200,? WHERE changes()=1`).bind(JSON.stringify({source:'reviewed_template'})),
 ];
}
