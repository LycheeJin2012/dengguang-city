import {endpoint,identity,reply,integer} from '../../_core/request.js';
import {ticketReference} from '../../_core/ticket-policy.js';
import {accessibleTicket,searchKnowledge,similarity,citation} from '../../_core/knowledge.js';
export const onRequestGet=c=>endpoint(async()=>{const a=await identity(c,'admin'),ref=ticketReference(new URL(c.request.url).searchParams.get('id')),db=c.env.DB,t=await accessibleTicket(db,a,ref),conditions=['id!=?'],args=[ref.legacy?-1:ref.id];
 if(a.role!=='super')conditions.push('target_admin_id IS NULL');else{conditions.push('(target_admin_id IS NULL OR target_admin_id!=?)');args.push(a.id);}if(a.linked_player_id){conditions.push('(target_player_id IS NULL OR target_player_id!=?)');args.push(a.linked_player_id);}
 const recent=(await db.prepare(`SELECT id,title,body,status,kind FROM tickets WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 100`).bind(...args).all()).results,query=(t.title||t.name||'')+' '+(t.body||t.content||'');
 const similar=recent.map(r=>({...r,score:similarity(query,r.title+' '+r.body)})).filter(r=>r.score>=0.25).sort((a,b)=>b.score-a.score).slice(0,5).map(r=>({id:r.id,title:r.title,status:r.status,excerpt:r.body.slice(0,160),score:r.score}));
 const knowledge=await searchKnowledge(db,query,['public','staff']);return reply({similar,knowledge:knowledge.map(r=>({...citation(r),answer:r.answer,audience:r.audience})),note:'相似性只按最近 100 条有权查看的工单文字匹配，不代表同一事件或相同责任；不会自动合并、派单或办结。'});
});
