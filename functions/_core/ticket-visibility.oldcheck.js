export function citizenTimeline(events=[]){return events.flatMap(e=>{let d={};try{d=JSON.parse(e.details||'{}');}catch{}const base={id:e.id,created_at:e.created_at,actor_type:'system',actor_name:'工单进度',action:e.action,details:'{}'};
 if(['created','human_requested'].includes(e.action))return [{...base,action:'created'}];
 if(['replied','auto_replied'].includes(e.action))return [{...base,actor_type:e.actor_type,actor_id:e.actor_id,actor_name:e.actor_name,details:JSON.stringify({reply:d.reply||''})}];
 if(['player_followup','player_question'].includes(e.action))return [{...base,actor_type:'player',actor_id:e.actor_id,actor_name:e.actor_name,details:JSON.stringify({reply:d.reply||''})}];
 if(e.action==='status_changed'&&['open','in_progress','resolved','closed'].includes(d.to))return [{...base,details:JSON.stringify({to:d.to})}];
 if(e.action==='reopened')return [{...base,action:'status_changed',details:JSON.stringify({to:'open'})}];
 if(['attachments_added','consent_changed'].includes(e.action))return [base];return [];});}
export function citizenTicket(t){const keys=['id','title','body','kind','category','status','created_at','replied_at','admin_reply','auto_reply','replied_by','reply_author_name','public_consent','public_visible','target_player_id','target_player_name','target_admin_id','attachments','attachment_count','reply_feedback'];const out=Object.fromEntries(keys.filter(k=>t[k]!==undefined).map(k=>[k,t[k]]));out.private_support=t.source_table==='support';if(t.history)out.history=citizenTimeline(t.history);return out;}
