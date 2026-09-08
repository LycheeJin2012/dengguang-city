import {
  endpoint,identity,body,string,integer,fail,reply
}
from '../_core/request.js';
const states=['open','in_progress','resolved','closed'],priorities=['low','normal','high','urgent'];
const union=`SELECT CAST(t.id AS TEXT) AS id,t.player_id,t.category,t.source_table,t.source_id,t.title,t.body,t.status,t.priority,t.assignee_id,t.admin_reply,t.created_at,t.replied_at,t.replied_by,p.username AS player_username FROM tickets t LEFT JOIN players p ON p.id=t.player_id
 UNION ALL SELECT 'm:'||m.id,m.player_id,'message','messages',m.id,m.name,m.content,CASE m.status WHEN 'unread' THEN 'open' WHEN 'read' THEN 'in_progress' ELSE 'resolved' END,'normal',NULL,m.admin_reply,m.created_at,m.replied_at,m.replied_by,p.username FROM messages m LEFT JOIN players p ON p.id=m.player_id WHERE NOT EXISTS(SELECT 1 FROM tickets t WHERE t.source_table='messages' AND t.source_id=m.id)`;
export const onRequestGet=c=>endpoint(async()=>{
  const {
    env,request
  }
  =c,u=new URL(request.url);const mine=u.searchParams.get('my')==='1';const who=await identity(c,mine?'player':'admin');const conditions=[],params=[];if(mine){
    conditions.push('player_id=?');params.push(who.id);
  }
  let raw=u.searchParams.get('id');if(raw){
    if(/^\d+$/.test(raw)&&Number(raw)>=1000000)raw='m:'+(Number(raw)-1000000);conditions.push('id=?');params.push(raw);
  }
  for(const key of ['status','category','priority'])if(u.searchParams.get(key)){
    conditions.push(`${key}=?`);params.push(u.searchParams.get(key));
  }
  const q=u.searchParams.get('q');if(q){
    conditions.push('(title LIKE ? OR body LIKE ?)');params.push('%'+q+'%','%'+q+'%');
  }
  const limit=integer(u.searchParams.get('limit')||200,'limit',1,500);const r=await env.DB.prepare(`SELECT * FROM (${union}) ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY created_at DESC LIMIT ?`).bind(...params,limit).all();if(raw){
    if(!r.results.length)fail(404,'工单不存在');return reply({
      ticket:r.results[0]
    }
    );
  }
  return reply({
    tickets:r.results,limit
  }
  );
}
);
export const onRequestPost=c=>endpoint(async()=>{
  const p=await identity(c),b=await body(c.request);const title=string(b.title,'标题',100),content=string(b.body,'内容',2000);const r=await c.env.DB.prepare("INSERT INTO tickets(player_id,category,title,body) VALUES(?,'service',?,?)").bind(p.id,title,content).run();return reply({
    id:r.meta.last_row_id
  }
  ,201);
}
);
export const onRequestPatch=c=>endpoint(async()=>{
  const admin=await identity(c,'admin'),{
    env,request
  }
  =c;let raw=new URL(request.url).searchParams.get('id')||'';if(/^\d+$/.test(raw)&&+raw>=1000000)raw='m:'+(+raw-1000000);const legacy=raw.startsWith('m:');const id=integer(legacy?raw.slice(2):raw),table=legacy?'messages':'tickets',row=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();if(!row)fail(404,'工单不存在');const b=await body(request),updates={
  }
  ,replyText=b.admin_reply===undefined?undefined:string(b.admin_reply,'回复',2000,{
    required:false
  }
  );if(b.status!==undefined){
    if(!states.includes(b.status))fail(400,'状态无效');updates.status=legacy?({
      open:'unread',in_progress:'read',resolved:'done',closed:'done'
    }
    [b.status]):b.status;
  }
  if(!legacy){
    if(b.priority!==undefined){
      if(!priorities.includes(b.priority))fail(400,'优先级无效');updates.priority=b.priority;
    }
    if(b.assignee_id!==undefined){
      updates.assignee_id=b.assignee_id?integer(b.assignee_id):null;if(updates.assignee_id&&!await env.DB.prepare('SELECT id FROM admins WHERE id=?').bind(updates.assignee_id).first())fail(404,'指派管理员不存在');
    }
  }
  const changedReply=replyText!==undefined&&replyText!==row.admin_reply;if(changedReply){
    updates.admin_reply=replyText;updates.replied_at=new Date().toISOString();updates.replied_by=admin.id;if(!b.status)updates.status=legacy?'done':'resolved';
  }
  if(!Object.keys(updates).length)fail(400,'没有可更新字段');const queries=[env.DB.prepare(`UPDATE ${table} SET ${Object.keys(updates).map(k=>k+'=?').join(',')}${legacy?'':",updated_at=datetime('now')"} WHERE id=?`).bind(...Object.values(updates),id)]; if(!legacy&&row.source_table==='messages'&&row.source_id){
    const mapped={
      open:'unread',in_progress:'read',resolved:'done',closed:'done'
    }
    [updates.status||row.status];queries.push(env.DB.prepare('UPDATE messages SET status=?,admin_reply=?,replied_at=?,replied_by=? WHERE id=?').bind(mapped,replyText??row.admin_reply,updates.replied_at||row.replied_at,admin.id,row.source_id));
  }
  if(!legacy&&['bookings','license_signups','kart_signups','circuit_signups'].includes(row.source_table)&&updates.status){
    const map=row.source_table==='bookings'?{
      open:'pending',in_progress:'confirmed',resolved:'completed',closed:'cancelled'
    }
    :row.source_table==='license_signups'?{
      open:'pending',in_progress:'pending',resolved:'passed',closed:'failed'
    }
    :{
      open:'pending',in_progress:'approved',resolved:'approved',closed:'rejected'
    }
    ;queries.push(env.DB.prepare(`UPDATE ${row.source_table} SET status=? WHERE id=?`).bind(map[updates.status],row.source_id));
  }
  if(changedReply&&replyText&&row.player_id)queries.push(env.DB.prepare("INSERT INTO notification_log(player_id,type,title,body,link) VALUES(?,'message_reply',?,?,?)").bind(row.player_id,'市政厅已回复你的工单',replyText,'/profile.html')); await env.DB.batch(queries);return reply({
    id:raw,updated:true
  }
  );
}
);
