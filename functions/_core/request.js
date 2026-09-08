import {
  readToken,getSession
}
from '../_shared/session.js';
export class HttpError extends Error{
  constructor(status,message){
    super(message);
    this.status=status;
  }
}
export function fail(status,message){
  throw new HttpError(status,message);
}
export function integer(value,name='id',min=1,max=Number.MAX_SAFE_INTEGER){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)fail(400,`${name} 必须是 ${min}–${max} 范围内的整数`);
  return n;
}
export function string(value,name,max=2000,{
  required=true
}
={
}
){
  if(typeof value!=='string'){
    if(!required&&value==null)return '';
    fail(400,`${name} 必须是文字`);
  }
  const s=value.trim();
  if((required&&!s)||s.length>max)fail(400,`${name} 需填写且不超过 ${max} 字符`);
  return s;
}
export async function body(request){
  const raw=await request.text();
  if(raw.length>2*1024*1024)fail(413,'请求内容过大');
  let data;
  try{
    data=JSON.parse(raw||'{}');
  }
  catch{
    fail(400,'请求不是有效 JSON');
  }
  if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'请求必须是 JSON 对象');
  return data;
}
export async function identity(context,role='player'){
  const {
    env,request
  }
  =context;
  if(!env.DB)fail(503,'数据库尚未连接');
  const s=await getSession(env,readToken(request));
  if(!s)fail(401,'请先登录');
  if(role==='player'){
    if(!s.player_id)fail(401,'需要市民账号');
    const p=await env.DB.prepare("SELECT id,username,email,status,emeralds FROM players WHERE id=? AND status='active'").bind(s.player_id).first();
    if(!p)fail(401,'账号未激活或已停用');
    return p;
  }
  if(!s.admin_id)fail(403,'需要管理员权限');
  const a=await env.DB.prepare('SELECT id,username,role FROM admins WHERE id=?').bind(s.admin_id).first();
  if(!a)fail(401,'管理员账号已失效');
  if(role==='super'&&a.role!=='super')fail(403,'此操作仅限 SUPER 管理员');
  return a;
}
export function reply(data={
}
,status=200){
  return new Response(JSON.stringify({
    ok:true,...data
  }
  ),{
    status,headers:{
      'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
    }
  }
  );
}
export async function endpoint(fn){
  try{
    return await fn();
  }
  catch(e){
    if(e.status)return new Response(JSON.stringify({
      ok:false,error:e.message
    }
    ),{
      status:e.status,headers:{
        'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'
      }
    }
    );
    if(/UNIQUE constraint/i.test(e.message))return new Response(JSON.stringify({
      ok:false,error:'该记录已存在，请勿重复提交'
    }
    ),{
      status:409,headers:{
        'Content-Type':'application/json','Cache-Control':'no-store'
      }
    }
    );
    console.error('[api]',e);
    return new Response(JSON.stringify({
      ok:false,error:'服务处理失败，请稍后重试'
    }
    ),{
      status:500,headers:{
        'Content-Type':'application/json','Cache-Control':'no-store'
      }
    }
    );
  }
}
