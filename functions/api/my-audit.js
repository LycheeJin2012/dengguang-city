import {endpoint,identity,integer,reply} from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
 const p=await identity(c),u=new URL(c.request.url),where=["actor_type='player'",'actor_id=?',"action NOT LIKE 'db.%'","action!='dm-read'"],args=[p.id];
 if(u.searchParams.has('cursor')){where.push('id<?');args.push(integer(u.searchParams.get('cursor')));}
 const rows=(await c.env.DB.prepare(`SELECT id,actor_type,actor_id,actor_name,action,resource_type,resource_id,http_status,created_at FROM audit_events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 100`).bind(...args).all()).results;
 return reply({events:rows,next_cursor:rows.length===100?rows.at(-1).id:null});
});
