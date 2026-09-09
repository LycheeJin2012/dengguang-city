import {firstReplyAfterEvent} from '../_core/first-reply.js';
import {autoDispatchSafely} from '../_core/dispatch.js';
import {
  endpoint,identity,body,string,reply,fail
}
from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
  const u=new URL(c.request.url);if(u.searchParams.get('public')==='1'){
    const rows=await c.env.DB.prepare('SELECT m.id,m.name,m.type,m.content,m.admin_reply,m.created_at,m.replied_at,(SELECT COUNT(*) FROM message_comments x WHERE x.message_id=m.id) AS comment_count FROM messages m WHERE m.public_visible=1 AND m.public_consent=1 ORDER BY m.id DESC LIMIT 100').all();return reply({
      messages:rows.results
    }
    );
  }
  const p=await identity(c);const r=await c.env.DB.prepare('SELECT * FROM messages WHERE player_id=? ORDER BY id DESC LIMIT 100').bind(p.id).all();return reply({
    messages:r.results
  }
  );
}
);
export const onRequestPost=c=>endpoint(async()=>{
  const p=await identity(c),b=await body(c.request);const content=string(b.content,'留言',2000),contact=string(b.contact,'联系方式',200),type=string(b.type,'类型',20);if(!['建议','投诉','咨询','合作'].includes(type))fail(400,'留言类型无效');const count=await c.env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE player_id=? AND created_at>datetime('now','-1 minute')").bind(p.id).first();if(count.n>=5)fail(429,'留言太频繁，请稍后再试');const r=await c.env.DB.batch([c.env.DB.prepare('INSERT INTO messages(player_id,name,contact,type,content,public_consent,public_visible) VALUES(?,?,?,?,?,?,0)').bind(p.id,p.username,contact,type,content,b.public_consent===true||b.public_consent===1?1:0),c.env.DB.prepare("INSERT INTO tickets(player_id,category,source_table,source_id,title,body,kind,public_consent) VALUES(?,'message','messages',last_insert_rowid(),?,?,'message',?)").bind(p.id,type+' · '+p.username,content,b.public_consent===true||b.public_consent===1?1:0),c.env.DB.prepare("INSERT INTO ticket_events(ticket_ref,actor_type,actor_id,actor_name,action,details) VALUES(CAST(last_insert_rowid() AS TEXT),'player',?,?,'created','{}')").bind(p.id,p.username),...firstReplyAfterEvent(c.env.DB,'message')]);const dispatch=await autoDispatchSafely(c,r[1].meta.last_row_id);return reply({dispatch:{status:dispatch.status},
    id:r[0].meta.last_row_id
  }
  ,201);
}
);
