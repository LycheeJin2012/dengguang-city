import {knowledgeSeed} from '../../shared/knowledge-seed.js';
import {fail} from './request.js';

/** 对任意值做稳定摘要：来源内容变了 → 摘要变了 → 派生资料自动判为过期。 */
export async function digest(value){
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');
}

// 每种来源的取数方式各不相同，但都要归一成同一个「可哈希的文档对象」，
// 否则 digest(fresh) 的比较就没有意义了。返回 null = 来源已不存在。
// 签名一律是 (db, id) —— 分发是统一调用的，guide 是唯一不碰 db 的来源。
async function fromGuide(_db,id){
 const seed=knowledgeSeed[id-1];
 return seed?{...seed}:null;
}
async function fromAnnouncement(db,id){
 const row=await db.prepare('SELECT title,content FROM announcements WHERE id=?').bind(id).first();
 return row?{title:row.title,question:row.title,answer:row.content,keywords:'公告',audience:'public'}:null;
}
async function fromLicense(db,id){
 const row=await db.prepare('SELECT title,description,requirements,exam_type FROM license_requirements WHERE id=? AND is_active=1').bind(id).first();
 return row?{
  title:row.title,
  question:row.title,
  answer:[row.description,row.requirements].filter(Boolean).join('\n'),
  keywords:'驾照 考试 '+row.exam_type,
  audience:'exam',
 }:null;
}
async function fromExamQuestion(db,id){
 const row=await db.prepare('SELECT grade,q_type,question,options,answer,explanation FROM exam_questions WHERE id=?').bind(id).first();
 return row?{
  title:row.grade+'级题库 #'+id,
  question:row.question,
  answer:JSON.stringify(row),
  keywords:'驾照 题库 '+row.grade,
  audience:'exam',
 }:null;
}
// 工单来源必须同时满足「玩家同意公开」「已审核可见」「已结案」「不是客服工单」，
// 四条都在 SQL 里 —— 少一条都可能把投诉内容当公开资料发出去。
async function fromTicket(db,id){
 const row=await db.prepare("SELECT public_title,public_body,public_reply FROM tickets WHERE id=? AND public_consent=1 AND public_visible=1 AND status IN ('resolved','closed') AND source_table IS NOT 'support'").bind(id).first();
 return row?.public_reply?{
  title:row.public_title,
  question:row.public_body,
  answer:row.public_reply,
  keywords:'已审核公开工单',
  audience:'public',
 }:null;
}

// 用 Map 而不是对象字面量：kind 来自数据库/请求，Map.get('constructor') 返回
// undefined，对象字面量则会命中 Object.prototype 上的构造函数。
const SOURCE_LOADERS=new Map([
 ['guide',fromGuide],
 ['announcement',fromAnnouncement],
 ['license',fromLicense],
 ['exam',fromExamQuestion],
 ['ticket',fromTicket],
]);

export async function sourceDocument(db,kind,id){
 const load=SOURCE_LOADERS.get(kind);
 return load?load(db,id):null;
}

/** 来源是否仍然「新鲜」：摘要对得上说明来源没被改过。 */
export async function fresh(db,row){
 if(row.source_kind==='manual')return true;
 const doc=await sourceDocument(db,row.source_kind,row.source_id);
 return !!doc&&await digest(doc)===row.source_hash;
}

const ignored=new Set(['请问','可以','什么','如何','怎么','一下','你好','需要','问题','这个']);

/**
 * 中文按二元组（bigram）切、英文数字按整词切。
 *
 * 中文没有空格，只能靠二元组近似词；单字（「的」「了」）噪声太大，直接丢弃。
 * limit 默认 60；similarity 传 Infinity 表示「不限，取全集做比对」。
 */
export function terms(text,limit=60){
 const parts=String(text||'').toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu)||[];
 return [...new Set(parts.flatMap(part=>
  /^[a-z0-9]+$/.test(part)
   ?[part]
   :part.length===1
    ?[]
    :Array.from({length:part.length-1},(_,i)=>part.slice(i,i+2))
 ).filter(term=>!ignored.has(term)))].slice(0,limit);
}

/** 查询词里有多少比例能在目标文本中找到，0–1。 */
export function similarity(query,text){
 const queryTerms=terms(query);
 const targetTerms=new Set(terms(text,Infinity));
 return queryTerms.length?queryTerms.filter(t=>targetTerms.has(t)).length/queryTerms.length:0;
}

// 一个 token 一个 LIKE，命中任意一个就算候选。ESCAPE '\' 让 % _ \ 按字面量比对。
const SEARCH_CLAUSE="(COALESCE(title,'')||' '||COALESCE(question,'')||' '||COALESCE(keywords,'')||' '||COALESCE(answer,'')) LIKE ? ESCAPE '\\'";
const likePattern=token=>'%'+token.replace(/[\\%_]/g,'\\$&')+'%';

export async function searchKnowledge(db,query,audiences=['public'],limit=5){
 const tokens=terms(query).slice(0,30);
 if(!tokens.length)return [];
 // 候选集上限 300 条：SQL 只负责粗筛，真正的排序交给下面的 similarity。
 const rows=(await db.prepare(`SELECT * FROM knowledge_articles WHERE status='published' AND audience IN (${audiences.map(()=>'?').join(',')}) AND (${tokens.map(()=>SEARCH_CLAUSE).join(' OR ')}) ORDER BY id DESC LIMIT 300`).bind(...audiences,...tokens.map(likePattern)).all()).results;
 const ranked=rows
  .map(row=>({...row,score:similarity(query,[row.title,row.question,row.keywords,row.answer].filter(Boolean).join(' '))}))
  .filter(row=>row.score>=0.25)
  .sort((a,b)=>b.score-a.score||a.id-b.id);
 const result=[];
 // 过期来源要跳过，所以不能只取前 limit 条 —— 得边过滤边凑数。
 for(const row of ranked){
  if(await fresh(db,row))result.push(row);
  if(result.length===limit)break;
 }
 return result;
}

export const citation=r=>({id:r.id,title:r.title,revision:r.revision,url:'/knowledge.html?id='+r.id});

/** 检索式答复：只列资料原文，绝不由模型自由发挥。 */
export async function knowledgeReply(db,query){
 const rows=await searchKnowledge(db,query,['public'],2);
 if(!rows.length)return null;
 return {
  answer:'找到以下已审核资料，请核对是否适用于你的问题：\n'+rows.map(r=>'《'+r.title+'》\n'+r.answer.slice(0,650)).join('\n\n')+'\n如资料未覆盖你的情况，请转人工核实。',
  sources:rows.map(citation),
 };
}

/**
 * 取出管理员有权查看的工单。
 *
 * 回避规则：投诉里点名的管理员本人、以及非超管遇到任何投诉，都不给看。
 * 三个条件用 || 串在一起是刻意的 —— 宁可多拒一次，也不能让被投诉方看到自己的投诉。
 */
export async function accessibleTicket(db,admin,ref){
 const row=await db.prepare(`SELECT * FROM ${ref.table} WHERE id=?`).bind(ref.id).first();
 if(!row)fail(404,'工单不存在');
 if(row.target_admin_id===admin.id
  ||row.target_player_id&&row.target_player_id===admin.linked_player_id
  ||row.target_admin_id&&admin.role!=='super')fail(403,'该工单需要回避');
 return row;
}
