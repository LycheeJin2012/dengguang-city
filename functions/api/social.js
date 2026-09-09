import {knowledgeReply} from '../_core/knowledge.js';
import {auditStatement} from '../_core/audit.js';
import {
  endpoint,identity,body,string,reply,fail
}
from '../_core/request.js';
import {
  aiAutoReply,getOrCreateAiBot
}
from '../_shared/ai.js';
import {ticketEvent} from '../_core/ticket-policy.js';
async function peer(c,name){
  const r=await c.env.DB.prepare("SELECT id,username,avatar_emoji FROM players WHERE username=? AND status='active'").bind(string(name,'游戏 ID',64)).first();
  if(!r)fail(404,'对方不存在或未激活');
  if(r.username==='灯灯客服')await getOrCreateAiBot(c.env);
  return r;
}
export const onRequestGet=c=>endpoint(async()=>{
  const u=new URL(c.request.url),action=u.searchParams.get('action');if(action==='profile'){
    const p=await c.env.DB.prepare("SELECT id,username,avatar_emoji,bio,created_at FROM players WHERE username=? AND status='active'").bind(string(u.searchParams.get('username'),'游戏 ID',64)).first();if(!p)fail(404,'玩家不存在');const stats=await c.env.DB.prepare('SELECT (SELECT COUNT(*) FROM messages WHERE player_id=?) AS messages,(SELECT COUNT(*) FROM message_comments WHERE player_id=?) AS comments').bind(p.id,p.id).first();return reply({
      profile:p,stats
    }
    );
  }
  const p=await identity(c);if(action==='me')return reply({
    profile:await c.env.DB.prepare('SELECT id,username,email,bio,avatar_emoji,created_at FROM players WHERE id=?').bind(p.id).first()
  }
  ); if(action==='dm-list'){
    const rows=await c.env.DB.prepare(`WITH mine AS (SELECT *,CASE WHEN from_player_id=? THEN to_player_id ELSE from_player_id END AS peer_id FROM direct_messages WHERE from_player_id=? OR to_player_id=?),ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY peer_id ORDER BY id DESC) AS rn,SUM(CASE WHEN to_player_id=? AND read_at IS NULL THEN 1 ELSE 0 END) OVER(PARTITION BY peer_id) AS unread FROM mine) SELECT r.peer_id,r.created_at AS last_at,r.content AS last_content,r.unread,p.username,p.avatar_emoji FROM ranked r LEFT JOIN players p ON p.id=r.peer_id WHERE rn=1 ORDER BY r.id DESC LIMIT 100`).bind(p.id,p.id,p.id,p.id).all();return reply({
      conversations:rows.results.map(r=>({
        ...r,peer:{
          id:r.peer_id,username:r.username,avatar_emoji:r.avatar_emoji
        }
      }
      ))
    }
    );
  }
  if(action==='dm-thread'){
    const other=await peer(c,u.searchParams.get('peer'));if(other.id===p.id)fail(400,'不能给自己发私信');const r=await c.env.DB.prepare('SELECT * FROM (SELECT id,from_player_id,to_player_id,content,read_at,created_at,replied_by_admin_id,knowledge_sources,(SELECT username FROM admins WHERE id=direct_messages.replied_by_admin_id) AS reply_author_name FROM direct_messages WHERE (from_player_id=? AND to_player_id=?) OR (from_player_id=? AND to_player_id=?) ORDER BY id DESC LIMIT 200) ORDER BY id').bind(p.id,other.id,other.id,p.id).all();return reply({
      peer:other,messages:r.results
    }
    );
  }
  fail(404,'未知功能');
}
);
export const onRequestPost=c=>endpoint(async()=>{
  if(new URL(c.request.url).searchParams.get('action')!=='dm-send')fail(404,'未知功能');const p=await identity(c),b=await body(c.request),other=await peer(c,b.to_username),content=string(b.content,'消息',2000);if(other.id===p.id)fail(400,'不能给自己发私信');const pendingSupport=other.username==='灯灯客服'?await c.env.DB.prepare("SELECT id FROM tickets WHERE player_id=? AND source_table='support' AND status IN ('open','in_progress')").bind(p.id).first():null;const queries=[c.env.DB.prepare('INSERT INTO direct_messages(from_player_id,to_player_id,content) VALUES(?,?,?)').bind(p.id,other.id,content),c.env.DB.prepare("INSERT INTO notification_log(player_id,type,title,body,link) SELECT ?,'dm',?,?,? WHERE NOT EXISTS(SELECT 1 FROM subscriptions WHERE player_id=? AND type='dm' AND enabled=0)").bind(other.id,p.username+' 发来了私信',content,'/dm.html?to='+encodeURIComponent(p.username),other.id)];if(pendingSupport)queries.push(ticketEvent(c.env.DB,String(pendingSupport.id),{type:'player',id:p.id,name:p.username},'player_followup',{reply:content}));const r=await c.env.DB.batch(queries);let replied=false; if(other.username==='灯灯客服'){
    try{
      const bot=await getOrCreateAiBot(c.env);if(bot.id===other.id){
        const pending=await c.env.DB.prepare("SELECT id FROM tickets WHERE player_id=? AND source_table='support' AND status IN ('open','in_progress')").bind(p.id).first();
        const grounded=pending?null:await knowledgeReply(c.env.DB,content);const draft=pending?null:grounded?.answer||await aiAutoReply(c.env,content,'dm');if(draft){
          const saved=await c.env.DB.prepare("INSERT INTO direct_messages(from_player_id,to_player_id,content,knowledge_sources) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM tickets WHERE player_id=? AND source_table='support' AND status IN ('open','in_progress'))").bind(other.id,p.id,'🤖 '+draft,grounded?JSON.stringify(grounded.sources):null,p.id).run();replied=!!saved.meta.changes;if(replied)await auditStatement(c.audit?.base||c.env.DB,{type:'system',id:null,name:'灯灯'},{action:'dm.auto_replied',resource_type:'direct_messages',resource_id:saved.meta.last_row_id,status:200,details:{source:grounded?'knowledge_extract':'reviewed_template',knowledge_ids:grounded?.sources.map(s=>s.id)||[],recipient_player_id:p.id}}).run();
        }
      }
    }
    catch(e){
      console.warn('[AI reply]',e.message);
    }
  }
  return reply({
    id:r[0].meta.last_row_id,ai_replied:replied
  }
  ,201);
}
);
export const onRequestPatch=c=>endpoint(async()=>{
  const p=await identity(c),u=new URL(c.request.url),action=u.searchParams.get('action');if(action==='me'){
    const b=await body(c.request),bio=string(b.bio??'','简介',500,{
      required:false
    }
    ),avatar=string(b.avatar_emoji||'👤','头像',32);await c.env.DB.prepare('UPDATE players SET bio=?,avatar_emoji=? WHERE id=?').bind(bio,avatar,p.id).run();return reply({
      updated:true
    }
    );
  }
  if(action==='dm-read'){
    const other=await peer(c,u.searchParams.get('peer'));await c.env.DB.prepare("UPDATE direct_messages SET read_at=datetime('now') WHERE to_player_id=? AND from_player_id=? AND read_at IS NULL").bind(p.id,other.id).run();return reply({
      read:true
    }
    );
  }
  fail(404,'未知功能');
}
);
