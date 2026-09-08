import {
  endpoint,identity,body,string,integer,reply,fail
}
from '../../_core/request.js';
import {
  aiAutoReply,getOrCreateAiBot
}
from '../../_shared/ai.js';
export const onRequestPost=c=>endpoint(async()=>{
  const admin=await identity(c,'super'),b=await body(c.request),a=new URL(c.request.url).searchParams.get('action'),db=c.env.DB; if(a==='admin-dm-conversations'){
    const q=string(b.q??'','搜索',100,{
      required:false
    }
    );const r=await db.prepare(`WITH ranked AS(SELECT d.*,ROW_NUMBER() OVER(PARTITION BY MIN(from_player_id,to_player_id),MAX(from_player_id,to_player_id) ORDER BY id DESC) AS rn FROM direct_messages d) SELECT r.from_player_id,r.to_player_id,r.content AS last_content,r.created_at AS last_at,p.username AS from_username,p2.username AS to_username FROM ranked r JOIN players p ON p.id=r.from_player_id JOIN players p2 ON p2.id=r.to_player_id WHERE rn=1 AND (?='' OR p.username LIKE ? OR p2.username LIKE ?) ORDER BY r.id DESC LIMIT 200`).bind(q,'%'+q+'%','%'+q+'%').all();return reply({
      conversations:r.results
    }
    );
  }
  if(a==='admin-dm-thread'){
    const from=integer(b.from_player_id),to=integer(b.to_player_id);const r=await db.prepare('SELECT * FROM (SELECT * FROM direct_messages WHERE (from_player_id=? AND to_player_id=?) OR (from_player_id=? AND to_player_id=?) ORDER BY id DESC LIMIT 200) ORDER BY id').bind(from,to,to,from).all();return reply({
      messages:r.results
    }
    );
  }
  if(a==='admin-dm-reply'){
    const to=integer(b.to_player_id),content=string(b.content,'回复',2000),bot=await getOrCreateAiBot(c.env);if(!await db.prepare("SELECT id FROM players WHERE id=? AND status='active'").bind(to).first())fail(404,'收件人不存在');const r=await db.batch([db.prepare('INSERT INTO direct_messages(from_player_id,to_player_id,content,replied_by_admin_id) VALUES(?,?,?,?)').bind(bot.id,to,content,admin.id),db.prepare("INSERT INTO notification_log(player_id,type,title,body,link) VALUES(?,'dm','市政客服回复',?,'/dm.html')").bind(to,content)]);return reply({
      id:r[0].meta.last_row_id
    }
    ,201);
  }
  if(a==='admin-dm-ai-suggest'){
    const content=string(b.content||b.context||'请礼貌回复市民的问题','上下文',4000);return reply({
      draft:await aiAutoReply(c.env,content,'dm')
    }
    );
  }
  if(a==='admin-dm-ai-struggle'){
    const bot=await getOrCreateAiBot(c.env);const rows=await db.prepare("SELECT * FROM direct_messages WHERE from_player_id=? AND (content LIKE '%人工%' OR content LIKE '%稍后%') ORDER BY id DESC LIMIT 100").bind(bot.id).all();return reply({
      struggles:rows.results
    }
    );
  }
  if(a==='admin-dm-list')return reply({
    dms:(await db.prepare('SELECT * FROM direct_messages ORDER BY id DESC LIMIT 200').all()).results
  }
  );fail(404,'未知私信管理操作');
}
);
