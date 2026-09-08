import {ensureDatabase} from '../_core/database.js';
import {endpoint,fail} from '../_core/request.js';
export async function onRequest(context){return endpoint(async()=>{
 const {request,env}=context;const url=new URL(request.url);
 if(!env.DB)fail(503,'数据库尚未连接，请联系管理员');
 if(!['GET','HEAD','OPTIONS'].includes(request.method)){
  const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)fail(403,'不接受其他网站发起的写入请求');
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'不接受跨站写入请求');
  if(Number(request.headers.get('Content-Length')||0)>2*1024*1024)fail(413,'请求内容过大');
 }
 await ensureDatabase(env.DB);const response=await context.next();const result=new Response(response.body,response);
 if(!['/api/homepage-bundle','/api/announcements','/api/gallery'].includes(url.pathname))result.headers.set('Cache-Control','no-store');
 result.headers.set('X-Content-Type-Options','nosniff');return result;
});}
