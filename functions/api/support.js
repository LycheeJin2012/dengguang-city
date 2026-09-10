import {endpoint,identity,body,string,reply,fail} from '../_core/request.js';
import {getOrCreateAiBot} from '../_shared/ai.js';
import {firstReplyAfterEvent} from '../_core/first-reply.js';
import {autoDispatchSafely} from '../_core/dispatch.js';
export const onRequestGet=c=>endpoint(async()=>{
 const p=await identity(c);const ticket=await c.env.DB.prepare("SELECT id,status,replied_at,created_at FROM tickets WHERE player_id=? AND source_table='support' ORDER BY id DESC LIMIT 1").bind(p.id).first();return reply({ticket});
});
export const onRequestPost=c=>endpoint(async()=>{
 const p=await identity(c),b=await body(c.request),reason=string(b.reason||'请求工作人员协助','转人工说明',500),db=c.env.DB;
 const bot=await getOrCreateAiBot(c.env);
 const active=await db.prepare("SELECT id,status FROM tickets WHERE player_id=? AND source_table='support' AND status IN ('open','in_progress')").bind(p.id).first();
 if(active)return reply({id:active.id,ticket:active,existing:true});
 const transcript=(await db.prepare('SELECT from_player_id,content FROM (SELECT id,from_player_id,content FROM direct_messages WHERE (from_player_id=? AND to_player_id=?) OR (from_player_id=? AND to_player_id=?) ORDER BY id DESC LIMIT 20) ORDER BY id').bind(p.id,bot.id,bot.id,p.id).all()).results;
 const text=reason+'\n\n最近灯灯对话（市民陈述与自动回复，均需核实）：\n'+transcript.map(m=>(m.from_player_id===p.id?'市民：':'灯灯/客服：')+m.content).join('\n').slice(-14000);
 // Partial unique index prevents duplicate active handoffs, including concurrent requests.
 await db.batch([db.prepare("INSERT OR IGNORE INTO tickets(player_id,category,kind,source_table,source_id,title,body,public_consent,public_visible) VALUES(?,'support','service','support',?,'灯灯客服转人工',?,0,0)").bind(p.id,p.id,text),db.prepare("INSERT INTO ticket_events(ticket_ref,actor_type,actor_id,actor_name,action,details) SELECT CAST(last_insert_rowid() AS TEXT),'player',?,?,'human_requested',? WHERE changes()=1").bind(p.id,p.username,JSON.stringify({reason,transcript_messages:transcript.length})),...firstReplyAfterEvent(db,'support')]);
 const ticket=await db.prepare("SELECT id,status FROM tickets WHERE player_id=? AND source_table='support' AND status IN ('open','in_progress')").bind(p.id).first();
 if(!ticket)fail(409,'请求状态已变化，请重试');
 const dispatch=await autoDispatchSafely(c,ticket.id);
 return reply({id:ticket.id,ticket},201);
});
