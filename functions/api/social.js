import {smartCustomerReply} from '../_core/customer-answer.js';
import {requestChat,needsHuman,sensitiveChat} from '../_core/chat-support.js';
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
  if(name==='灯灯客服')await getOrCreateAiBot(c.env);
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
    const other=await peer(c,u.searchParams.get('peer'));if(other.id===p.id)fail(400,'不能给自己发私信');const r=await c.env.DB.prepare('SELECT * FROM (SELECT id,from_player_id,to_player_id,content,read_at,created_at,replied_by_admin_id,knowledge_sources,(SELECT helpful FROM reply_feedback WHERE kind=\'dm\' AND target_id=CAST(direct_messages.id AS TEXT) AND player_id=direct_messages.to_player_id) AS helpful,(SELECT username FROM admins WHERE id=direct_messages.replied_by_admin_id) AS reply_author_name FROM direct_messages WHERE (from_player_id=? AND to_player_id=?) OR (from_player_id=? AND to_player_id=?) ORDER BY id DESC LIMIT 200) ORDER BY id').bind(p.id,other.id,other.id,p.id).all();return reply({
      peer:other,messages:r.results
    }
    );
  }
  fail(404,'未知功能');
}
);
export const onRequestPost=c=>endpoint(async()=>{
 if(new URL(c.request.url).searchParams.get('action')!=='dm-send')fail(404,'未知功能');const p=await identity(c),b=await body(c.request),other=await peer(c,b.to_username),content=string(b.content,'消息',2000),db=c.env.DB;if(other.id===p.id)fail(400,'不能给自己发私信');
 const chat=other.username==='灯灯客服'?await db.prepare("SELECT * FROM support_chats WHERE player_id=? AND status IN ('queued','active')").bind(p.id).first():null;
 const ops=[db.prepare('INSERT INTO direct_messages(from_player_id,to_player_id,content) VALUES(?,?,?)').bind(p.id,other.id,content)];
 if(chat){ops.push(db.prepare("UPDATE support_chats SET requires_super=CASE WHEN ?=1 THEN 1 ELSE requires_super END,assigned_admin_id=CASE WHEN ?=1 AND assigned_admin_id IN (SELECT id FROM admins WHERE role!='super') THEN NULL ELSE assigned_admin_id END,status=CASE WHEN ?=1 AND assigned_admin_id IN (SELECT id FROM admins WHERE role!='super') THEN 'queued' ELSE status END,revision=revision+1,updated_at=datetime('now') WHERE id=?").bind(sensitiveChat(content)?1:0,sensitiveChat(content)?1:0,sensitiveChat(content)?1:0,chat.id));}
 else if(other.username!=='灯灯客服')ops.push(db.prepare("INSERT INTO notification_log(player_id,type,title,body,link) SELECT ?,'dm',?,?,? WHERE NOT EXISTS(SELECT 1 FROM subscriptions WHERE player_id=? AND type='dm' AND enabled=0)").bind(other.id,p.username+' 发来了私信',content,'/dm.html?to='+encodeURIComponent(p.username),other.id));
 const saved=await db.batch(ops);let replied=false,human=false,supportError=false;
 if(other.username==='灯灯客服'){
  const active=await db.prepare("SELECT id FROM support_chats WHERE player_id=? AND status IN ('queued','active')").bind(p.id).first();
  if(active)human=true;
  else try{
   const context=(await db.prepare('SELECT from_player_id,content FROM (SELECT id,from_player_id,content FROM direct_messages WHERE ((from_player_id=? AND to_player_id=?) OR (from_player_id=? AND to_player_id=?)) AND id<? ORDER BY id DESC LIMIT 6) ORDER BY id').bind(p.id,other.id,other.id,p.id,saved[0].meta.last_row_id).all()).results.map(m=>({role:m.from_player_id===p.id?'user':'assistant',content:m.content.slice(0,1000)}));
   const explicitHuman=/人工|找.*客服|找.*工作人员/.test(content)&&!/(不要|不用|暂不|不想).{0,5}人工/.test(content);
   const preference=await db.prepare('SELECT auto_handoff FROM support_chats WHERE player_id=?').bind(p.id).first();
   const answer=explicitHuman?null:await smartCustomerReply(c.env,content,context,p);
   if(!answer&&(explicitHuman||needsHuman(content)&&preference?.auto_handoff!==0)){const r=await requestChat(c,p,{reason:content.slice(0,500),mode:'automatic'});human=true;replied=!r.existing;}
   else {
    const draft=answer?.answer||(preference?.auto_handoff===0&&needsHuman(content)?'暂时没有足够的已确认资料回答这个问题。你已结束人工等待，需要时可以手动点击“转人工”。':/^(你好|您好|hi|hello)[!！。,.，\s]*$/i.test(content.trim())?'你好，我是灯灯。请告诉我你想了解什么。':await aiAutoReply(c.env,content,'dm'));
    const r=await db.prepare("INSERT INTO direct_messages(from_player_id,to_player_id,content,knowledge_sources) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM support_chats WHERE player_id=? AND status IN ('queued','active'))").bind(other.id,p.id,'🤖 '+draft,answer?JSON.stringify(answer.sources):null,p.id).run();replied=!!r.meta.changes;
    if(replied)await auditStatement(c.audit?.base||db,{type:'system',id:null,name:'灯灯'},{action:'dm.auto_replied',resource_type:'direct_messages',resource_id:r.meta.last_row_id,status:200,details:{source:answer?.source||'greeting_or_basic_fact',recipient_player_id:p.id}}).run();
   }
  }catch{supportError=true;}
 }
 return reply({id:saved[0].meta.last_row_id,ai_replied:replied,human_support:human,support_error:supportError},201);
});
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
