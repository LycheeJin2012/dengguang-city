import {enterWithPassword,leaveAdministration} from './admin-session.js';
import {claimPendingRewards} from './ticket-policy.js';
import {
  endpoint,identity,body,string,integer,reply,fail
}
from './request.js';
import {
  hashPassword,verifyPassword
}
from '../_shared/auth.js';
import {
  isUsername,isEmail
}
from '../_shared/validators.js';
import {
  readToken
}
from '../_shared/session.js';
export function password(value){
  if(typeof value!=='string'||value.length<8||value.length>128)fail(400,'密码需 8–128 位');
  return value;
}
export function username(value){
  const name=string(value,'游戏 ID',32);
  if(!isUsername(name)||/[<>]/.test(name))fail(400,'游戏 ID 格式无效');
  return name;
}
export async function changePassword(c,kind){
  const me=await identity(c,kind==='admin'?'admin':'player'),b=await body(c.request),table=kind==='admin'?'admins':'players',column=kind==='admin'?'admin_id':'player_id';
  const row=await c.env.DB.prepare(`SELECT password_hash,salt FROM ${table} WHERE id=?`).bind(me.id).first();
  if(typeof b.old_password!=='string'||!await verifyPassword(b.old_password,row.password_hash,row.salt))fail(401,'原密码错误');
  const {
    hash,salt
  }
  =await hashPassword(password(b.new_password));
  await c.env.DB.batch([c.env.DB.prepare(`UPDATE ${table} SET password_hash=?,salt=? WHERE id=?`).bind(hash,salt,me.id),c.env.DB.prepare(`DELETE FROM sessions WHERE ${column}=? AND token!=?`).bind(me.id,readToken(c.request))]);
  return reply({
    changed:true
  }
  );
}
export const accountAction=c=>endpoint(async()=>{
  const a=new URL(c.request.url).searchParams.get('action');if(a==='admin-logout')return leaveAdministration(c);
  if(a==='player-change-password')return changePassword(c,'player');const b=await body(c.request); if(a==='admin-enter-password')return enterWithPassword(c,b.admin_password);
  await identity(c,'super');const adminId=b.admin_id?integer(b.admin_id):null,playerId=integer(b.player_id);if(a==='admin-reset-player-password'){
    const {
      hash,salt
    }
    =await hashPassword(password(b.new_password));const result=await c.env.DB.batch([c.env.DB.prepare('UPDATE players SET password_hash=?,salt=? WHERE id=?').bind(hash,salt,playerId),c.env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(playerId)]);if(!result[0].meta.changes)fail(404,'市民不存在');return reply({
      updated:true
    }
    );
  }
  if(!['admin-merge-account','admin-unmerge-account'].includes(a)||!adminId)fail(400,'操作无效');const admin=await c.env.DB.prepare('SELECT * FROM admins WHERE id=?').bind(adminId).first(),player=await c.env.DB.prepare('SELECT * FROM players WHERE id=?').bind(playerId).first();if(!admin||!player)fail(404,'账号不存在');const linking=a==='admin-merge-account';if(linking){
    if(player.status!=='active')fail(400,'只能绑定已激活的市民');if(admin.linked_player_id&&admin.linked_player_id!==playerId||player.linked_admin_id&&player.linked_admin_id!==adminId)fail(409,'账号已绑定其他账号，请先解绑');
  }
  else if(admin.linked_player_id!==playerId||player.linked_admin_id!==adminId)fail(409,'账号绑定关系已变化，请刷新'); const queries=[c.env.DB.prepare('UPDATE admins SET linked_player_id=? WHERE id=?').bind(linking?playerId:null,adminId),c.env.DB.prepare('UPDATE players SET linked_admin_id=? WHERE id=?').bind(linking?adminId:null,playerId)]; if(!linking){
    queries.push(c.env.DB.prepare('UPDATE passkeys SET admin_id=NULL WHERE player_id=? AND admin_id=?').bind(playerId,adminId),c.env.DB.prepare('DELETE FROM sessions WHERE player_id=? AND admin_id=?').bind(playerId,adminId));
  }
  await c.env.DB.batch(queries);if(linking)await claimPendingRewards(c.env.DB,adminId,playerId);return reply({
    linked:linking,admin_id:adminId,player_id:playerId
  }
  );
}
);
export const adminAccounts=c=>endpoint(async()=>{
  const {
    env,request
  }
  =c;const me=await identity(c,request.method==='GET'?'admin':'super'),u=new URL(request.url);if(request.method==='GET'){
    return reply({
      admins:(await env.DB.prepare('SELECT a.id,a.username,a.role,a.specialties,a.created_at,a.linked_player_id,p.username AS linked_player_username FROM admins a LEFT JOIN players p ON p.id=a.linked_player_id ORDER BY a.id').all()).results
    }
    );
  }
  const id=request.method==='POST'?null:integer(u.searchParams.get('id'));const row=id?await env.DB.prepare('SELECT * FROM admins WHERE id=?').bind(id).first():null;if(id&&!row)fail(404,'管理员不存在'); if(request.method==='DELETE'){
    if(id===me.id)fail(400,'不能删除自己');if(await env.DB.prepare('SELECT id FROM announcements WHERE created_by=? LIMIT 1').bind(id).first())fail(409,'此管理员有公告记录，请保留账号');await env.DB.batch([env.DB.prepare('UPDATE players SET linked_admin_id=NULL WHERE linked_admin_id=?').bind(id),env.DB.prepare('DELETE FROM sessions WHERE admin_id=?').bind(id),env.DB.prepare('UPDATE passkeys SET admin_id=NULL WHERE admin_id=? AND player_id IS NOT NULL').bind(id),env.DB.prepare('DELETE FROM passkeys WHERE admin_id=?').bind(id),env.DB.prepare('DELETE FROM admins WHERE id=?').bind(id)]);return reply({
      deleted:id
    }
    );
  }
  const b=await body(request),v={
  }
  ;if(b.specialties!==undefined)v.specialties=string(b.specialties,'职责',300,{required:false});if(b.username!==undefined)v.username=username(b.username);if(b.role!==undefined){
    if(!['admin','super'].includes(b.role))fail(400,'角色无效');if(id===me.id&&b.role!=='super')fail(400,'不能降低自己的权限');v.role=b.role;
  }
  if(request.method==='POST'){
    if(!v.username)fail(400,'账号必填');v.role=v.role||'admin';const {
      hash,salt
    }
    =await hashPassword(password(b.password));v.password_hash=hash;v.salt=salt;const r=await env.DB.prepare('INSERT INTO admins(username,role,password_hash,salt,specialties) VALUES(?,?,?,?,?)').bind(v.username,v.role,hash,salt,v.specialties||'').run();return reply({
      id:r.meta.last_row_id
    }
    ,201);
  }
  if(request.method!=='PATCH')fail(405,'方法不支持');if(b.new_password){
    const {
      hash,salt
    }
    =await hashPassword(password(b.new_password));v.password_hash=hash;v.salt=salt;
  }
  if(!Object.keys(v).length)fail(400,'没有修改字段');const queries=[env.DB.prepare(`UPDATE admins SET ${Object.keys(v).map(k=>k+'=?').join(',')} WHERE id=?`).bind(...Object.values(v),id)];if(b.new_password||b.role)queries.push(env.DB.prepare('DELETE FROM sessions WHERE admin_id=? AND token!=?').bind(id,readToken(request)));await env.DB.batch(queries);return reply({
    id,updated:true
  }
  );
}
);
export const players=c=>endpoint(async()=>{
  const {
    env,request
  }
  =c,me=await identity(c,'admin'),u=new URL(request.url);if(request.method==='GET'){
    const conditions=[],args=[];for(const k of ['status'])if(u.searchParams.get(k)){
      conditions.push(k+'=?');args.push(u.searchParams.get(k));
    }
    if(u.searchParams.get('q')){
      conditions.push('(username LIKE ? OR email LIKE ?)');args.push('%'+u.searchParams.get('q')+'%','%'+u.searchParams.get('q')+'%');
    }
    const r=await env.DB.prepare(`SELECT id,username,email,game_id,status,bio,avatar_emoji,emeralds,created_at,linked_admin_id FROM players ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY id DESC LIMIT 500`).bind(...args).all();return reply({
      players:r.results
    }
    );
  }
  if(request.method==='POST'){
    if(me.role!=='super')fail(403,'仅 SUPER 可创建账号');const b=await body(request),name=username(b.username),email=string(b.email,'邮箱',254).toLowerCase();if(!isEmail(email))fail(400,'邮箱无效');const {
      hash,salt
    }
    =await hashPassword(password(b.password));const r=await env.DB.prepare("INSERT INTO players(username,game_id,email,password_hash,salt,status) VALUES(?,?,?,?,?,'active')").bind(name,name,email,hash,salt).run();return reply({
      id:r.meta.last_row_id
    }
    ,201);
  }
  if(request.method!=='PATCH')fail(405,'方法不支持');const id=integer(u.searchParams.get('id')),a=u.searchParams.get('action'),row=await env.DB.prepare('SELECT * FROM players WHERE id=?').bind(id).first();if(!row)fail(404,'市民不存在');if(['approve','reject'].includes(a)){
    if(row.linked_admin_id&&me.role!=='super')fail(403,'只有 SUPER 可停用关联管理员的市民账号');await env.DB.batch([env.DB.prepare('UPDATE players SET status=? WHERE id=?').bind(a==='approve'?'active':'rejected',id),env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(id)]);return reply({
      id
    }
    );
  }
  if(me.role!=='super')fail(403,'仅 SUPER 可操作');const b=await body(request);if(a==='reset'){
    const {
      hash,salt
    }
    =await hashPassword(password(b.new_password));await env.DB.batch([env.DB.prepare('UPDATE players SET password_hash=?,salt=? WHERE id=?').bind(hash,salt,id),env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(id)]);return reply({
      id
    }
    );
  }
  if(a==='rename'){
    const name=username(b.new_username);await env.DB.prepare('UPDATE players SET username=?,game_id=CASE WHEN game_id=? THEN ? ELSE game_id END WHERE id=?').bind(name,row.username,name,id).run();return reply({
      id
    }
    );
  }
  fail(400,'未知操作');
}
);
