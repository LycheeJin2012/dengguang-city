import {
  endpoint,identity,body,integer,reply,fail
}
from '../../_core/request.js';
import {
  validateQuestion
}
from '../exam-questions.js';
export const onRequest=c=>endpoint(async()=>{
  await identity(c,'admin');if(c.request.method==='GET')return reply({
    questions:(await c.env.DB.prepare('SELECT * FROM exam_questions ORDER BY grade,id DESC LIMIT 500').all()).results
  }
  );const id=new URL(c.request.url).searchParams.get('id');if(c.request.method==='POST'||c.request.method==='PATCH'){
    const v=validateQuestion(await body(c.request));if(c.request.method==='POST'){
      const r=await c.env.DB.prepare('INSERT INTO exam_questions(grade,q_type,question,options,answer,explanation) VALUES(?,?,?,?,?,?)').bind(...Object.values(v)).run();return reply({
        id:r.meta.last_row_id
      }
      ,201);
    }
    const r=await c.env.DB.prepare('UPDATE exam_questions SET grade=?,q_type=?,question=?,options=?,answer=?,explanation=? WHERE id=?').bind(...Object.values(v),integer(id)).run();if(!r.meta.changes)fail(404,'题目不存在');return reply({
      updated:true
    }
    );
  }
  fail(405,'请编辑题目以保留练习历史');
}
);
