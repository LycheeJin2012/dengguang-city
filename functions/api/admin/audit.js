import {endpoint,identity,integer,reply} from '../../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
 await identity(c,'super');const u=new URL(c.request.url);const maximum=(await c.env.DB.prepare('SELECT COALESCE(MAX(id),0) AS n FROM audit_events').first()).n;
 const snapshot=u.searchParams.has('snapshot')?integer(u.searchParams.get('snapshot'),'snapshot',0):maximum;
 const conditions=['id<=?'],args=[snapshot];
 if(u.searchParams.has('cursor')){conditions.push('id<?');args.push(integer(u.searchParams.get('cursor')));}
 for(const field of ['actor_type','resource_type','resource_id','action'])if(u.searchParams.get(field)){conditions.push(field+'=?');args.push(u.searchParams.get(field));}
 if(u.searchParams.get('actor_id')){conditions.push('actor_id=?');args.push(integer(u.searchParams.get('actor_id')));}
 if(u.searchParams.get('from')){conditions.push('created_at>=?');args.push(u.searchParams.get('from'));}
 if(u.searchParams.get('to')){conditions.push("created_at<datetime(?,'+1 day')");args.push(u.searchParams.get('to'));}
 const limit=integer(u.searchParams.get('limit')||100,'limit',1,1000);
 const rows=await c.env.DB.prepare(`SELECT * FROM audit_events WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ?`).bind(...args,limit).all();
 return reply({events:rows.results,snapshot,next_cursor:rows.results.length===limit?rows.results.at(-1).id:null});
});
