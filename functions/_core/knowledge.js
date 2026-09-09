import {knowledgeSeed} from '../../shared/knowledge-seed.js';
import {fail} from './request.js';
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function sourceDocument(db,kind,id){
 if(kind==='guide'){const x=knowledgeSeed[id-1];return x?{...x}:null;}
 if(kind==='announcement'){const x=await db.prepare('SELECT title,content FROM announcements WHERE id=?').bind(id).first();return x?{title:x.title,question:x.title,answer:x.content,keywords:'公告',audience:'public'}:null;}
 if(kind==='license'){const x=await db.prepare('SELECT title,description,requirements,exam_type FROM license_requirements WHERE id=? AND is_active=1').bind(id).first();return x?{title:x.title,question:x.title,answer:[x.description,x.requirements].filter(Boolean).join('\n'),keywords:'驾照 考试 '+x.exam_type,audience:'exam'}:null;}
 if(kind==='exam'){const x=await db.prepare('SELECT grade,q_type,question,options,answer,explanation FROM exam_questions WHERE id=?').bind(id).first();return x?{title:x.grade+'级题库 #'+id,question:x.question,answer:JSON.stringify(x),keywords:'驾照 题库 '+x.grade,audience:'exam'}:null;}
 if(kind==='ticket'){const x=await db.prepare("SELECT public_title,public_body,public_reply FROM tickets WHERE id=? AND public_consent=1 AND public_visible=1 AND status IN ('resolved','closed') AND source_table IS NOT 'support'").bind(id).first();return x?.public_reply?{title:x.public_title,question:x.public_body,answer:x.public_reply,keywords:'已审核公开工单',audience:'public'}:null;}
 return null;
}
export async function fresh(db,row){if(row.source_kind==='manual')return true;const doc=await sourceDocument(db,row.source_kind,row.source_id);return !!doc&&await digest(doc)===row.source_hash;}
const ignored=new Set(['请问','可以','什么','如何','怎么','一下','你好','需要','问题','这个']);
export function terms(text){const parts=String(text||'').toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu)||[];return [...new Set(parts.flatMap(s=>/^[a-z0-9]+$/.test(s)?[s]:s.length===1?[]:Array.from({length:s.length-1},(_,i)=>s.slice(i,i+2))).filter(s=>!ignored.has(s)))].slice(0,60);}
export function similarity(query,text){const a=terms(query),b=new Set(terms(text));return a.length?a.filter(t=>b.has(t)).length/a.length:0;}
export async function searchKnowledge(db,query,audiences=['public'],limit=5){
 const tokens=terms(query);if(!tokens.length)return [];
 const clauses=tokens.slice(0,12).map(()=>"(title||' '||question||' '||keywords) LIKE ? ESCAPE '\\'");
 const rows=(await db.prepare(`SELECT * FROM knowledge_articles WHERE status='published' AND audience IN (${audiences.map(()=>'?').join(',')}) AND (${clauses.join(' OR ')}) ORDER BY id DESC LIMIT 300`).bind(...audiences,...tokens.slice(0,12).map(t=>'%'+t.replace(/[\\%_]/g,'\\$&')+'%')).all()).results;
 const ranked=rows.map(r=>({...r,score:similarity(query,r.title+' '+r.question+' '+r.keywords)})).filter(r=>r.score>=0.25).sort((a,b)=>b.score-a.score||a.id-b.id),result=[];
 for(const r of ranked){if(await fresh(db,r))result.push(r);if(result.length===limit)break;}
 return result;
}
export const citation=r=>({id:r.id,title:r.title,revision:r.revision,url:'/knowledge.html?id='+r.id});
export async function knowledgeReply(db,query){const rows=await searchKnowledge(db,query,['public'],2);if(!rows.length)return null;
 return {answer:'找到以下已审核资料，请核对是否适用于你的问题：\n'+rows.map(r=>'《'+r.title+'》\n'+r.answer.slice(0,650)).join('\n\n')+'\n如资料未覆盖你的情况，请转人工核实。',sources:rows.map(citation)};
}
export async function accessibleTicket(db,admin,ref){const row=await db.prepare(`SELECT * FROM ${ref.table} WHERE id=?`).bind(ref.id).first();if(!row)fail(404,'工单不存在');if(row.target_admin_id===admin.id||row.target_player_id&&row.target_player_id===admin.linked_player_id||row.target_admin_id&&admin.role!=='super')fail(403,'该工单需要回避');return row;}
