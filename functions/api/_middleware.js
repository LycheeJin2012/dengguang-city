import {shouldAudit,auditResource} from '../_core/audit-policy.js';
import {ensureDatabase,SCHEMA_VERSION} from '../_core/database.js';
import {endpoint,fail} from '../_core/request.js';
import {auditActor,auditStatement,auditedDatabase} from '../_core/audit.js';
export async function onRequest(context){return endpoint(async()=>{
 const {request,env}=context,url=new URL(request.url);if(!env.DB)fail(503,'数据库尚未连接，请联系管理员');
 await ensureDatabase(env.DB);
 const actor=await auditActor(env.DB,request),requestId=crypto.randomUUID();
 const event={request_id:requestId,method:request.method,path:url.pathname,resource_id:url.searchParams.get('id'),resource_type:auditResource(url),details:{}};
 if(!event.resource_id&&shouldAudit(request)&&request.headers.get('Content-Type')?.includes('application/json')){try{const input=await request.clone().json();const id=event.resource_type==='admins'?input.admin_id:event.resource_type==='players'?input.player_id:input.id;if(Number.isSafeInteger(Number(id))&&Number(id)>0)event.resource_id=String(id);}catch{}}
 const base=env.DB;context.audit={actor,requestId,base};
 const tracked=shouldAudit(request);
 context.env={...env,DB:tracked?auditedDatabase(base,actor,event):base};
 let response;
 try{
  if(!['GET','HEAD','OPTIONS'].includes(request.method)){
   const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)fail(403,'不接受其他网站发起的写入请求');
   if(request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'不接受跨站写入请求');
   if(Number(request.headers.get('Content-Length')||0)>2*1024*1024)fail(413,'请求内容过大');
  }
  response=await context.next();
 }catch(error){response=await endpoint(async()=>{throw error;});}
 if(url.pathname!=='/api/ui-events'&&tracked){
  const cookie=response.headers.get('Set-Cookie');let effective=actor;
  if(cookie&&response.ok){const token=/lc_session=([^;]+)/.exec(cookie)?.[1];if(token)effective=await auditActor(base,request,token);}
  const action=url.pathname==='/api/support'?(response.status===201?'support.requested':'support.checked'):url.searchParams.get('export')==='1'?'export':url.searchParams.get('action')||request.method.toLowerCase();
  let resourceId=event.resource_id;
  if(!resourceId&&response.ok&&request.method==='POST'&&response.headers.get('Content-Type')?.includes('application/json')){try{const result=await response.clone().json();resourceId=(url.searchParams.get('action')||'').startsWith('passkey-')?null:result.id||result.user_id||result.user?.id||null;if(url.pathname==='/api/register'&&result.user)effective={type:'applicant',id:result.user.id,name:result.user.username};}catch{}}
  await auditStatement(base,effective,{...event,action,resource_type:event.resource_type,resource_id:resourceId,status:response.status,details:{action:url.searchParams.get('action')||null}}).run();
 }
 const result=new Response(response.body,response);result.headers.set('Cache-Control','no-store');result.headers.set('X-Content-Type-Options','nosniff');result.headers.set('X-Request-Id',requestId);result.headers.set('X-App-Schema-Version',String(SCHEMA_VERSION));return result;
});}
