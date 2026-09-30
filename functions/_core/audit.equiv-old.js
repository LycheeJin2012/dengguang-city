import {readToken} from '../_shared/session.js';
const RAW=Symbol('statement'),SQL=Symbol('sql'),ARGS=Symbol('args');
const trackedTables=new Set(['support_chats','support_chat_events','reply_feedback','ticket_triage','exam_appeals','exam_sessions','exam_session_events','knowledge_articles','exam_question_drafts','dispatch_settings','admins','players','messages','direct_messages','message_comments','bookings','kart_signups','circuit_signups','license_signups','tickets','ticket_attachments','ticket_rewards','ticket_events','ticket_comments','hotel_owners','hotels','hotel_rooms','race_tracks','race_times','license_requirements','exam_questions','exam_attempts','announcements','gallery_items','subscriptions','notification_log','passkeys','daily_signin','media_uploads']);
export async function auditActor(db,request,tokenOverride){
 const token=tokenOverride||readToken(request);if(!token)return {type:'anonymous',id:null,name:'访客'};
 const s=await db.prepare('SELECT player_id,admin_id,hotel_owner_id,expires_at FROM sessions WHERE token=?').bind(token).first();
 if(!s||!Number.isFinite(+new Date(s.expires_at))||new Date(s.expires_at)<=new Date())return {type:'anonymous',id:null,name:'访客'};
 const type=s.admin_id?'admin':s.hotel_owner_id?'hotel_owner':'player',id=s.admin_id||s.hotel_owner_id||s.player_id;
 const table={admin:'admins',hotel_owner:'hotel_owners',player:'players'}[type];const p=await db.prepare(`SELECT username FROM ${table} WHERE id=?`).bind(id).first();
 return {type,id,name:p?.username||'已注销账号',player_id:s.player_id,admin_id:s.admin_id,owner_id:s.hotel_owner_id};
}
export function auditStatement(db,actor,event){
 return db.prepare('INSERT INTO audit_events(request_id,actor_type,actor_id,actor_name,player_id,admin_id,owner_id,action,resource_type,resource_id,method,path,http_status,details) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(event.request_id||null,actor.type,actor.id??null,actor.name,actor.player_id??null,actor.admin_id??null,actor.owner_id??null,event.action,event.resource_type||'request',event.resource_id?String(event.resource_id):null,event.method||null,event.path||null,event.status??null,JSON.stringify(event.details||{}));
}
export function auditedDatabase(db,actor,event){
 function mutation(sql){const m=/^\s*(INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?([a-z_]+)/i.exec(sql);return m&&trackedTables.has(m[2])?{operation:m[1].split(/\s/)[0].toLowerCase(),table:m[2]}:null;}
 function log(sql,args=[]){const m=mutation(sql);if(!m)return null;if(m.table==='ticket_events'&&args.length===6){let details={};try{details=JSON.parse(args[5]);}catch{}return auditStatement(db,{type:args[1],id:args[2],name:args[3]},{...event,action:'ticket.'+args[4],resource_type:'tickets',resource_id:args[0],status:200,details});}return auditStatement(db,actor,{...event,action:'db.'+m.operation,resource_type:m.table,resource_id:event.resource_type===m.table?event.resource_id:null,status:200,details:{operation:m.operation}});}
 function wrap(statement,sql,args=[]){return {[RAW]:statement,[SQL]:sql,[ARGS]:args,bind(...values){return wrap(statement.bind(...values),sql,values);},first(...args){return statement.first(...args);},all(...args){return statement.all(...args);},async run(){const audit=log(sql,args);if(!audit)return statement.run();return (await db.batch([statement,audit]))[0];}};}
 return {prepare:sql=>wrap(db.prepare(sql),sql),async batch(statements){const raw=statements.map(s=>s[RAW]||s),logs=statements.map(s=>log(s[SQL]||'',s[ARGS]||[])).filter(Boolean);const results=await db.batch([...raw,...logs]);return results.slice(0,raw.length);}};
}
export const actorLabel=actor=>`${actor.type==='admin'?'管理员':actor.type==='hotel_owner'?'酒店老板':actor.type==='player'?'玩家':'访客'}${actor.id?' #'+actor.id:''} · ${actor.name}`;
