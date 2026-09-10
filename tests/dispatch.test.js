import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,dispatch} from './local-d1.mjs';
import {ensureDatabase} from '../functions/_core/database.js';
import {autoDispatch,classification,preferences,experienceScore} from '../functions/_core/dispatch.js';
async function fixture(fn){
 const DB=database();try{await ensureDatabase(DB);
 for(const [id,name,role] of [[1,'super','super'],[2,'wzc','admin'],[3,'SIM_漫画家','admin'],[4,'other','admin']])await DB.prepare('INSERT INTO admins(id,username,role,password_hash,salt) VALUES(?,?,?,\'x\',\'x\')').bind(id,name,role).run();
 await DB.prepare("INSERT INTO players(id,username,email,password_hash,salt,status) VALUES(1,'citizen','test@example.invalid','x','x','active')").run();
 for(const [token,p,a] of [['player',1,null],['super',null,1],['wzc',null,2]])await DB.prepare("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES(?,?,?,'2099-01-01T00:00:00Z')").bind(token,p,a).run();
 const env={DB};const call=async(path,method='GET',body,cookie='super')=>{const r=await dispatch(new Request('https://local.test/api/'+path,{method,headers:{Cookie:'lc_session='+cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);return {http:r.status,...await r.json()};};
 const ticket=async(title='普通咨询',extra={})=>call('tickets','POST',{title,body:title,...extra},'player');
 const pending=async(title='普通咨询')=>{const r=await DB.prepare("INSERT INTO tickets(player_id,title,body,category) VALUES(1,?,?,'service')").bind(title,title).run();return r.meta.last_row_id;};
 await fn({DB,env,call,ticket,pending});
 }finally{DB.close();}
}
test('incoming urgent and complex tickets are automatically assigned to designated accounts with system audit',()=>fixture(async({DB,ticket})=>{
 const urgent=await ticket('紧急：服务器崩溃'),complex=await ticket('复杂的跨部门事项'),both=await ticket('紧急且复杂');
 for(const [t,who] of [[urgent,2],[complex,3],[both,2]]){assert.equal(t.http,201);assert.equal(t.dispatch,undefined);const row=await DB.prepare('SELECT assignee_id,priority FROM tickets WHERE id=?').bind(t.id).first();assert.equal(row.assignee_id,who);const event=await DB.prepare("SELECT * FROM ticket_events WHERE ticket_ref=? AND actor_type='system' AND action='assigned'").bind(String(t.id)).first();assert.equal(JSON.parse(event.details).to,who);assert.ok(JSON.parse(event.details).reason);}
 const events=(await DB.prepare("SELECT * FROM audit_events WHERE action='ticket.auto_assigned'").all()).results;assert.equal(events.length,3);assert.ok(events.every(e=>e.actor_type==='system'&&e.actor_id===null));
}));
test('account matching is exact, unique and supports linked citizen names',()=>{const config={};assert.equal(preferences([{id:1,username:'other',player_username:'WZC'}],config).urgent.id,1);assert.equal(preferences([{id:1,username:'wzc'},{id:2,username:'other',player_username:'wzc'}],config).urgent,null);assert.equal(preferences([{id:1,username:'wzc-copy'}],config).urgent,null);assert.equal(classification({title:'不紧急的普通留言'}).urgent,false);});
test('model classification uses urgency preference even when it recommends another administrator',()=>fixture(async({env,ticket,DB})=>{const original=globalThis.fetch;env.OPENAI_API_KEY='mock-only';try{globalThis.fetch=async()=>Response.json({choices:[{message:{content:'{"admin_id":4,"urgent":true,"complex":true,"reason":"其他建议"}'}}]});const t=await ticket('多人现在无法使用服务器');const row=await DB.prepare('SELECT assignee_id FROM tickets WHERE id=?').bind(t.id).first();assert.equal(row.assignee_id,2);const e=await DB.prepare("SELECT details FROM ticket_events WHERE ticket_ref=? AND actor_type='system' AND action='assigned'").bind(String(t.id)).first();assert.equal(JSON.parse(e.details).source,'ai');}finally{globalThis.fetch=original;}}));
test('invalid model output or failure still assigns using policy and records rules honestly',()=>fixture(async({env,ticket,DB})=>{const original=globalThis.fetch;env.OPENAI_API_KEY='mock-only';try{for(const response of ['{"admin_id":999,"urgent":true}',null]){globalThis.fetch=async()=>{if(response===null)throw new Error('offline');return Response.json({choices:[{message:{content:response}}]});};const t=await ticket('复杂事项');assert.equal(t.dispatch,undefined);const e=await DB.prepare("SELECT details FROM ticket_events WHERE ticket_ref=? AND actor_type='system' AND action='assigned'").bind(String(t.id)).first();assert.equal(JSON.parse(e.details).source,'rules');assert.equal(JSON.parse(e.details).to,3);}}finally{globalThis.fetch=original;}}));
test('automatic complaints enforce recusal and super-only assignment',()=>fixture(async({ticket,DB})=>{
 const report=await ticket('紧急举报',{kind:'admin_complaint',target_admin_id:2});assert.equal((await DB.prepare('SELECT assignee_id FROM tickets WHERE id=?').bind(report.id).first()).assignee_id,1);
 const no=await ticket('投诉唯一超管',{kind:'admin_complaint',target_admin_id:1});assert.equal(no.dispatch,undefined);assert.equal((await DB.prepare('SELECT assignee_id FROM tickets WHERE id=?').bind(no.id).first()).assignee_id,null);
 await DB.prepare('UPDATE admins SET linked_player_id=1 WHERE id=2').run();const self=await ticket('紧急事项');assert.notEqual((await DB.prepare('SELECT assignee_id FROM tickets WHERE id=?').bind(self.id).first()).assignee_id,2);
}));
test('current workload cap prevents overload, including concurrent assignment',()=>fixture(async({DB,pending,env})=>{
 await DB.prepare('UPDATE dispatch_settings SET max_active=1').run();const ids=await Promise.all(Array.from({length:8},()=>pending('紧急事项')));await Promise.all(ids.map(id=>autoDispatch({env},id)));const loads=(await DB.prepare('SELECT assignee_id,COUNT(*) AS n FROM tickets WHERE assignee_id IS NOT NULL GROUP BY assignee_id').all()).results;assert.ok(loads.length);assert.ok(loads.every(a=>a.n<=1));
}));
test('repeated concurrent processing cannot assign or emit the event twice',()=>fixture(async({DB,pending,env})=>{const id=await pending();await Promise.all([autoDispatch({env},id),autoDispatch({env},id)]);assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_ref=? AND actor_type='system' AND action='assigned'").bind(String(id)).first()).n,1);assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE resource_id=? AND action='ticket.auto_assigned'").bind(String(id)).first()).n,1);}));
test('manual changes and policy pause win over an in-flight model request',()=>fixture(async({DB,pending,env,call})=>{
 const original=globalThis.fetch;env.OPENAI_API_KEY='mock-only';try{
 let id=await pending();globalThis.fetch=async()=>{await call('tickets?id='+id,'PATCH',{assignee_id:4});return Response.json({choices:[{message:{content:'{"admin_id":2}'}}]});};assert.equal((await autoDispatch({env},id)).status,'skipped');assert.equal((await DB.prepare('SELECT assignee_id FROM tickets WHERE id=?').bind(id).first()).assignee_id,4);
 id=await pending();globalThis.fetch=async()=>{await call('admin/dispatch-settings','PATCH',{enabled:false});return Response.json({choices:[{message:{content:'{"admin_id":2}'}}]});};assert.ok(['skipped','paused'].includes((await autoDispatch({env},id)).status));assert.equal((await DB.prepare('SELECT assignee_id FROM tickets WHERE id=?').bind(id).first()).assignee_id,null);
 }finally{globalThis.fetch=original;}
}));
test('only super can change assignment policy and read-only policy views create no audit',()=>fixture(async({call,ticket,DB})=>{assert.equal((await call('admin/dispatch-settings','PATCH',{enabled:false},'wzc')).http,403);assert.equal((await call('admin/dispatch-settings','PATCH',{urgent_admin_id:999})).http,404);assert.equal((await call('admin/dispatch-settings','PATCH',{enabled:false})).http,200);assert.equal((await ticket('紧急事项')).dispatch,undefined);const n=async()=>(await DB.prepare('SELECT COUNT(*) AS n FROM audit_events').first()).n;const before=await n();await call('admin/dispatch-settings');assert.equal(await n(),before);}));
test('history changes regular routing after sufficient comparable completed cases; tiny samples do not infer expertise',()=>fixture(async({DB,ticket})=>{
 assert.equal(experienceScore({completed:2,reopened:0,average_hours:1}),0);
 for(let i=0;i<4;i++)await DB.prepare("INSERT INTO tickets(player_id,title,body,category,kind,status,assignee_id,replied_by,created_at,replied_at) VALUES(1,'历史','测试','service','service','resolved',4,4,datetime('now','-1 hour'),datetime('now'))").run();
 const t=await ticket('普通服务事项',{kind:'service'});assert.equal((await DB.prepare('SELECT assignee_id FROM tickets WHERE id=?').bind(t.id).first()).assignee_id,4);
 const e=await DB.prepare("SELECT details FROM ticket_events WHERE ticket_ref=? AND actor_type='system' AND action='assigned'").bind(String(t.id)).first();assert.equal(JSON.parse(e.details).learning.completed,4);
}));
test('legacy messages and business submissions also trigger automatic assignment',()=>fixture(async({call,DB})=>{
 const message=await call('messages','POST',{type:'建议',content:'紧急事项',contact:'local'},'player');assert.equal(message.http,201);assert.equal(message.dispatch,undefined);
 await DB.prepare("INSERT INTO hotels(name) VALUES('本地酒店')").run();await DB.prepare("INSERT INTO hotel_rooms(hotel_id,name,capacity,price_per_night) VALUES(1,'本地房型',2,0)").run();
 const booking=await call('bookings','POST',{room_id:1,in_date:'2099-01-01',out_date:'2099-01-02',persons:1,name:'citizen',contact:'local'},'player');assert.equal(booking.http,201);assert.equal(booking.dispatch,undefined);assert.ok((await DB.prepare("SELECT assignee_id FROM tickets WHERE source_table='bookings' AND source_id=?").bind(booking.id).first()).assignee_id);
}));
test('automatically assigned work earns the same one-time 10 emerald reward after real completion',()=>fixture(async({DB,ticket,call})=>{
 await DB.prepare("INSERT INTO players(id,username,email,password_hash,salt,status,linked_admin_id) VALUES(2,'handler','handler@example.invalid','x','x','active',2)").run();await DB.prepare('UPDATE admins SET linked_player_id=2 WHERE id=2').run();
 const t=await ticket('紧急待办');assert.equal(t.dispatch,undefined);const finished=await call('tickets?id='+t.id,'PATCH',{status:'resolved',admin_reply:'已解决'},'wzc');assert.equal(finished.reward.amount,10);await call('tickets?id='+t.id,'PATCH',{status:'resolved',admin_reply:'已解决'},'wzc');assert.equal((await DB.prepare('SELECT emeralds FROM players WHERE id=2').first()).emeralds,10);
}));
test('deferred automatic dispatch explains its reason once without overwriting manual state',()=>fixture(async({DB,env,pending})=>{
 const id=await pending();await DB.prepare('UPDATE tickets SET target_admin_id=1 WHERE id=?').bind(id).run();await autoDispatch({env},id);await autoDispatch({env},id);const events=(await DB.prepare("SELECT details FROM ticket_events WHERE ticket_ref=? AND action='dispatch_deferred'").bind(String(id)).all()).results;assert.equal(events.length,1);assert.match(JSON.parse(events[0].details).reason,/回避/);
}));
