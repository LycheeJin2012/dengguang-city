// Only outward-facing fields for a server-authenticated player. Never feed staff notes to AI.
export async function myAffairs(db,playerId){
 const queries=[
 ["SELECT CAST(id AS TEXT) AS id,title,status,admin_reply,replied_at,created_at FROM tickets WHERE player_id=? ORDER BY id DESC LIMIT 40",'tickets'],
 ["SELECT 'm:'||id AS id,name AS title,CASE status WHEN 'unread' THEN 'open' WHEN 'read' THEN 'in_progress' ELSE 'resolved' END AS status,admin_reply,replied_at,created_at FROM messages WHERE player_id=? AND NOT EXISTS(SELECT 1 FROM tickets t WHERE t.source_table='messages' AND t.source_id=messages.id) ORDER BY id DESC LIMIT 20",'messages'],
 ['SELECT id,room_name,in_date,out_date,status,created_at FROM bookings WHERE player_id=? ORDER BY id DESC LIMIT 30','bookings'],
 ['SELECT id,grade,status,score,pending_count,created_at FROM exam_sessions WHERE player_id=? ORDER BY created_at DESC LIMIT 20','exams'],
 ['SELECT id,exam_type,status,exam_date,created_at FROM license_signups WHERE player_id=? ORDER BY id DESC LIMIT 20','licenses'],
 ['SELECT id,status,created_at FROM exam_appeals WHERE player_id=? ORDER BY id DESC LIMIT 20','appeals'],
 ['SELECT status,updated_at FROM support_chats WHERE player_id=?','support'],
 ['SELECT COUNT(*) AS n FROM notification_log WHERE player_id=? AND read_at IS NULL','unread']
 ];
 const values=await Promise.all(queries.map(async([sql,key])=>[key,(await db.prepare(sql).bind(playerId).all()).results]));const data=Object.fromEntries(values);
 const items=[...data.tickets,...data.messages].map(r=>({...r,kind:'ticket',href:'/affairs.html?ticket='+encodeURIComponent(r.id),attention:false}));
 items.push(...data.bookings.map(r=>({...r,kind:'booking',title:r.room_name||'酒店预订',href:'/profile.html',attention:r.status==='confirmed'&&r.in_date>=new Date().toISOString().slice(0,10)})),...data.exams.map(r=>({...r,kind:'exam',title:r.grade+' 类模拟考试',href:'/profile.html#exam',attention:r.status==='in_progress'})),...data.licenses.map(r=>({...r,kind:'license',title:r.exam_type+' 驾照申请',href:'/profile.html',attention:false})),...data.appeals.map(r=>({...r,kind:'appeal',title:'成绩复核申请',href:'/profile.html#exam',attention:false})));
 if(data.support[0])items.push({id:'support',kind:'support',title:'灯灯与人工客服',status:data.support[0].status,created_at:data.support[0].updated_at,href:'/dm.html?to='+encodeURIComponent('灯灯客服'),attention:data.support[0].status==='active'});
 items.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
 return {items,unread_count:data.unread[0].n,as_of:new Date().toISOString(),limited:true};
}
