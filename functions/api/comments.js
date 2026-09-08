import {
  endpoint,identity,body,string,integer,reply,fail
}
from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
  const id=integer(new URL(c.request.url).searchParams.get('message_id'));const r=await c.env.DB.prepare('SELECT id,message_id,player_id,author_name,content,created_at FROM message_comments WHERE message_id=? ORDER BY id LIMIT 200').bind(id).all();return reply({
    comments:r.results
  }
  );
}
);
export const onRequestPost=c=>endpoint(async()=>{
  const p=await identity(c),b=await body(c.request),id=integer(b.message_id),content=string(b.content,'评论',2000);if(!await c.env.DB.prepare('SELECT id FROM messages WHERE id=?').bind(id).first())fail(404,'留言不存在');const r=await c.env.DB.prepare('INSERT INTO message_comments(message_id,player_id,author_name,content) VALUES(?,?,?,?)').bind(id,p.id,p.username,content).run();return reply({
    id:r.meta.last_row_id
  }
  ,201);
}
);
export const onRequestDelete=c=>endpoint(async()=>{
  const id=integer(new URL(c.request.url).searchParams.get('id'));let p;try{
    p=await identity(c,'admin');
  }
  catch{
    p=await identity(c);const own=await c.env.DB.prepare('SELECT id FROM message_comments WHERE id=? AND player_id=?').bind(id,p.id).first();if(!own)fail(403,'只能删除自己的评论');
  }
  await c.env.DB.prepare('DELETE FROM message_comments WHERE id=?').bind(id).run();return reply({
    deleted:id
  }
  );
}
);
