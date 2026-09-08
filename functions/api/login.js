import {endpoint,body,string,fail,reply} from '../_core/request.js';
import {verifyPassword} from '../_shared/auth.js';
import {readToken,getSession,createSession,destroySession} from '../_shared/session.js';
const cookie=(token,age=28800)=>`lc_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
export const onRequestGet=c=>endpoint(async()=>{
 const session=await getSession(c.env,readToken(c.request));if(!session)fail(401,'请先登录');const db=c.env.DB;
 const admin=session.admin_id?await db.prepare('SELECT id,username,role,linked_player_id FROM admins WHERE id=?').bind(session.admin_id).first():null;
 const player=session.player_id?await db.prepare("SELECT id,username,email,game_id,status,avatar_emoji,bio,linked_admin_id,emeralds,created_at FROM players WHERE id=? AND status='active'").bind(session.player_id).first():null;
 const owner=session.hotel_owner_id?await db.prepare("SELECT id,username,linked_player_id FROM hotel_owners WHERE id=? AND status='active'").bind(session.hotel_owner_id).first():null;
 if(!admin&&!player&&!owner)fail(401,'会话已失效');
 if(player?.linked_admin_id&&!await db.prepare('SELECT id FROM admins WHERE id=? AND linked_player_id=?').bind(player.linked_admin_id,player.id).first())player.linked_admin_id=null;
 const hotelOwner=owner||(player?await db.prepare("SELECT id,username FROM hotel_owners WHERE linked_player_id=? AND status='active'").bind(player.id).first():null);
 return reply({role:admin?.role||(owner?'hotel_owner':'player'),user:admin||player||owner,admin,player,hotel_owner:hotelOwner,combined:!!admin&&!!player});
});
export const onRequestPost=c=>endpoint(async()=>{
 const b=await body(c.request),username=string(b.username,'账号',64),password=b.password;if(typeof password!=='string'||!password||password.length>128)fail(400,'密码无效');
 const ip=c.request.headers.get('CF-Connecting-IP')||'local';const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip+'|'+username)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const count=await c.env.DB.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE fingerprint=? AND created_at>datetime('now','-10 minutes')").bind(key).first();if(count.n>=10)fail(429,'尝试次数过多，请稍后重试');
 const target=['admin','hotel_owner'].includes(b.target)?b.target:'player';
 const player=target==='player'?await c.env.DB.prepare('SELECT * FROM players WHERE username=?').bind(username).first():null;
 const owner=target==='hotel_owner'?await c.env.DB.prepare('SELECT * FROM hotel_owners WHERE username=?').bind(username).first():null;
 const admin=target!=='hotel_owner'&&!player?await c.env.DB.prepare('SELECT * FROM admins WHERE username=?').bind(username).first():null;
 const account=player||admin||owner;
 if(!account||!await verifyPassword(password,account.password_hash,account.salt)){await c.env.DB.prepare('INSERT INTO auth_attempts(fingerprint) VALUES(?)').bind(key).run();fail(401,'账号或密码错误');}
 if(player&&player.status!=='active'||owner&&owner.status!=='active')fail(403,'账号尚未激活或已停用');
 await c.env.DB.prepare('DELETE FROM auth_attempts WHERE fingerprint=?').bind(key).run();const session=await createSession(c.env,player?.id||null,admin?.id||null,owner?.id||null);
 const response=reply({user_id:account.id,role:admin?.role||(owner?'hotel_owner':'player')});response.headers.set('Set-Cookie',cookie(session.token));return response;
});
export const onRequestDelete=c=>endpoint(async()=>{await destroySession(c.env,readToken(c.request));const response=reply({logged_out:true});response.headers.set('Set-Cookie',cookie('',0));return response;});
