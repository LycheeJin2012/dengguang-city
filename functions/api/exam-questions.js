import {
  endpoint,identity,body,string,integer,reply,fail
}
from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
  const u=new URL(c.request.url);if(u.searchParams.get('my')==='1'){
    const p=await identity(c);const rows=await c.env.DB.prepare('SELECT q.id,q.grade,q.question,a.is_correct,a.created_at FROM exam_attempts a JOIN exam_questions q ON q.id=a.question_id WHERE a.player_id=? ORDER BY a.id DESC LIMIT 100').bind(p.id).all();const wrong=new Map();for(const r of rows.results)if(!r.is_correct&&!wrong.has(r.id))wrong.set(r.id,r);return reply({
      attempts:rows.results,wrong_book:[...wrong.values()]
    }
    );
  }
  const grade=u.searchParams.get('grade');if(!['B','A','S'].includes(grade))fail(400,'请选择 B/A/S 等级');const limit=integer(u.searchParams.get('limit')||10,'limit',1,50);const rows=await c.env.DB.prepare(`SELECT id,grade,q_type,question,options FROM exam_questions WHERE grade=? ORDER BY ${u.searchParams.get('random')==='1'?'RANDOM()':'id'} LIMIT ?`).bind(grade,limit).all();return reply({
    questions:rows.results.map(r=>({
      ...r,options:r.options?JSON.parse(r.options):[]
    }
    ))
  }
  );
}
);
export function validateQuestion(b){
  const grade=string(b.grade,'等级',1),q_type=b.q_type||'choice';
  if(!['B','A','S'].includes(grade)||!['choice','multi','judge'].includes(q_type))fail(400,'题目等级或类型无效');
  const question=string(b.question,'题目',2000),answer=string(b.answer,'答案',50);
  let options=b.options||[];
  if(typeof options==='string'){
    try{
      options=JSON.parse(options);
    }
    catch{
      fail(400,'选项必须是 JSON 数组');
    }
  }
  if(q_type!=='judge'&&(!Array.isArray(options)||options.length<2||options.length>26||options.some(x=>typeof x!=='string'||x.length>500)))fail(400,'需提供 2–26 个文字选项');
  if(q_type==='judge'&&!['true','false'].includes(answer))fail(400,'判断题答案需 true/false');
  if(q_type!=='judge'&&(!/^[A-Z,|\s]+$/i.test(answer)||[...answer.toUpperCase().replace(/[,|\s]/g,'')].some(c=>c.charCodeAt(0)-65>=options.length)))fail(400,'答案必须对应选项字母');
  return {
    grade,q_type,question,options:JSON.stringify(options),answer,explanation:string(b.explanation??'','解析',2000,{
      required:false
    }
    )
  }
  ;
}
export const onRequestPost=c=>endpoint(async()=>{
  await identity(c,'admin');const v=validateQuestion(await body(c.request));const r=await c.env.DB.prepare('INSERT INTO exam_questions(grade,q_type,question,options,answer,explanation) VALUES(?,?,?,?,?,?)').bind(...Object.values(v)).run();return reply({
    id:r.meta.last_row_id
  }
  ,201);
}
);
