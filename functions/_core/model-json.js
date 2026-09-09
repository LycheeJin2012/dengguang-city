import {fail} from './request.js';
export async function modelJson(env,system,input){
 if(!env.OPENAI_API_KEY)fail(503,'尚未配置 AI 模型服务；知识库检索可用，生成题目需要配置模型后再试');
 try{const r=await fetch((env.OPENAI_BASE_URL||'https://api.openai.com/v1').replace(/\/+$/,'')+'/chat/completions',{method:'POST',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.OPENAI_API_KEY},body:JSON.stringify({model:env.OPENAI_MODEL||'gpt-4o-mini',temperature:0.2,max_tokens:3500,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}]})});if(!r.ok)throw new Error('model unavailable');const d=await r.json();const text=d?.choices?.[0]?.message?.content;if(typeof text!=='string'||text.length>20000)throw new Error('bad model output');return JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{fail(502,'AI 暂不可用或返回了无效题目，未保存草稿，请重试');}
}
