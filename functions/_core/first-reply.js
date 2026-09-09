import {basicReply} from '../_shared/ai.js';
// Runs immediately after the creation event in the same transaction. The reply
// table is WITHOUT ROWID, preserving the event ID while the next statement reads it.
export function firstReplyAfterEvent(db,kind){
 const content=basicReply(kind),ref='(SELECT ticket_ref FROM ticket_events WHERE id=last_insert_rowid())';
 return [
  db.prepare(`INSERT OR IGNORE INTO ticket_auto_replies(ticket_ref,content) SELECT ${ref},? WHERE changes()=1`).bind(content),
  db.prepare(`INSERT INTO ticket_events(ticket_ref,actor_type,actor_id,actor_name,action,details) SELECT ${ref},'system',NULL,'灯灯','auto_replied',? WHERE changes()=1`).bind(JSON.stringify({reply:content,source:'reviewed_template'})),
  db.prepare(`INSERT INTO audit_events(actor_type,actor_name,action,resource_type,resource_id,http_status,details) SELECT 'system','灯灯','ticket.auto_replied','tickets',${ref},200,? WHERE changes()=1`).bind(JSON.stringify({source:'reviewed_template'}))
 ];
}
