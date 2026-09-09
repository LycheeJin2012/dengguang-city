import {endpoint,integer,reply,string,fail} from '../_core/request.js';
import {searchKnowledge,fresh,citation} from '../_core/knowledge.js';
export const onRequestGet=c=>endpoint(async()=>{const u=new URL(c.request.url);let rows;
 if(u.searchParams.has('id')){const row=await c.env.DB.prepare("SELECT * FROM knowledge_articles WHERE id=? AND status='published' AND audience='public'").bind(integer(u.searchParams.get('id'))).first();if(!row||!await fresh(c.env.DB,row))fail(404,'资料未发布或来源已更新，请联系人工核实');rows=[row];}
 else rows=await searchKnowledge(c.env.DB,string(u.searchParams.get('q')||'','问题',500,{required:false}));
 return reply({articles:rows.map(r=>({...citation(r),question:r.question,answer:r.answer,updated_at:r.updated_at})),note:'只检索已审核且来源有效的公开资料；未找到时请转人工。'});
});
