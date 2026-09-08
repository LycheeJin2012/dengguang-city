import {identity,fail,reply} from './request.js';
import {getSession,readToken} from '../_shared/session.js';
import {randomToken,verifyPassword} from '../_shared/auth.js';
export async function boundAdministrator(c){
 const player=await identity(c);
 const admin=await c.env.DB.prepare('SELECT a.* FROM admins a JOIN players p ON p.linked_admin_id=a.id AND a.linked_player_id=p.id WHERE p.id=? AND p.status=\'active\'').bind(player.id).first();
 if(!admin)fail(403,'当前玩家未绑定有效管理员账号');return {player,admin};
}
export async function elevate(c,player,admin){
 const token=randomToken(24),old=readToken(c.request),expires=new Date(Date.now()+8*3600_000).toISOString();
 const result=await c.env.DB.batch([
  c.env.DB.prepare("INSERT INTO sessions(token,player_id,admin_id,expires_at) SELECT ?,p.id,a.id,? FROM players p JOIN admins a ON p.linked_admin_id=a.id AND a.linked_player_id=p.id WHERE p.id=? AND a.id=? AND p.status='active' AND EXISTS(SELECT 1 FROM sessions WHERE token=? AND player_id=p.id)").bind(token,expires,player.id,admin.id,old),
  c.env.DB.prepare('DELETE FROM sessions WHERE token=? AND changes()=1').bind(old)
 ]);
 if(!result[0].meta.changes)fail(403,'绑定关系或登录状态已变化，请重新验证');
 const r=reply({combined:true});r.headers.set('Set-Cookie',`lc_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);return r;
}
export async function enterWithPassword(c,password){
 const {player,admin}=await boundAdministrator(c);const fingerprint='admin-verify:'+player.id+':'+admin.id;
 const attempts=await c.env.DB.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE fingerprint=? AND created_at>datetime('now','-10 minutes')").bind(fingerprint).first();if(attempts.n>=10)fail(429,'验证次数过多，请稍后重试');
 if(typeof password!=='string'||password.length>128||!await verifyPassword(password,admin.password_hash,admin.salt)){await c.env.DB.prepare('INSERT INTO auth_attempts(fingerprint) VALUES(?)').bind(fingerprint).run();fail(401,'管理密码错误');}
 await c.env.DB.prepare('DELETE FROM auth_attempts WHERE fingerprint=?').bind(fingerprint).run();return elevate(c,player,admin);
}
export async function leaveAdministration(c){
 const token=readToken(c.request),session=await getSession(c.env,token);if(!session?.admin_id)return reply({admin_logged_out:true});
 let player=session.player_id?await c.env.DB.prepare("SELECT id FROM players WHERE id=? AND status='active'").bind(session.player_id).first():null;
 if(!player&&!session.player_id)player=await c.env.DB.prepare("SELECT p.id FROM players p JOIN admins a ON p.linked_admin_id=a.id AND a.linked_player_id=p.id WHERE a.id=? AND p.status='active'").bind(session.admin_id).first();
 const r=reply({admin_logged_out:true,player_retained:!!player});
 if(player)await c.env.DB.prepare('UPDATE sessions SET admin_id=NULL,player_id=? WHERE token=? AND admin_id=?').bind(player.id,token,session.admin_id).run();
 else {await c.env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();r.headers.set('Set-Cookie','lc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');}
 return r;
}
