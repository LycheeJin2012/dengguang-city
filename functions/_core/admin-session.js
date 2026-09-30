import {identity,fail,reply} from './request.js';
import {getSession,readToken} from '../_shared/session.js';
import {randomToken,verifyPassword} from '../_shared/auth.js';

// 8 小时后过期，与下面 Set-Cookie 的 Max-Age=28800 必须一致。
const COMBINED_TTL_MS=8*3600_000;
const SESSION_COOKIE_MAX_AGE=28800;
const SESSION_COOKIE_ATTRS='Path=/; HttpOnly; Secure; SameSite=Lax';

/**
 * 取「玩家 + 绑定的管理员」这对身份。
 *
 * 绑定必须是双向的：players.linked_admin_id=a.id 且 admins.linked_player_id=p.id。
 * 少一个条件就等于承认单方面指向的绑定，解除绑定后残留的一端仍能提权。
 */
export async function boundAdministrator(c){
 const player=await identity(c);
 const admin=await c.env.DB
  .prepare("SELECT a.* FROM admins a JOIN players p ON p.linked_admin_id=a.id AND a.linked_player_id=p.id WHERE p.id=? AND p.status='active'")
  .bind(player.id)
  .first();
 if(!admin)fail(403,'当前玩家未绑定有效管理员账号');
 return {player,admin};
}

/**
 * 提升为「玩家 + 管理员」合并会话。
 *
 * 用一次 batch 做会话换发：插入新 token 的同时删掉旧 token，中间不存在
 * 「两个 token 同时有效」的窗口。第二条的 `changes()=1` 依赖第一条真的插入，
 * 所以两条必须留在同一个 batch 里、顺序不能换。
 */
export async function elevate(c,player,admin){
 const token=randomToken(24);
 const old=readToken(c.request);
 const expires=new Date(Date.now()+COMBINED_TTL_MS).toISOString();
 const result=await c.env.DB.batch([
  // 插入时重新校验绑定与旧会话仍在，避免用验证期间的陈旧数据换发
  c.env.DB.prepare("INSERT INTO sessions(token,player_id,admin_id,expires_at) SELECT ?,p.id,a.id,? FROM players p JOIN admins a ON p.linked_admin_id=a.id AND a.linked_player_id=p.id WHERE p.id=? AND a.id=? AND p.status='active' AND EXISTS(SELECT 1 FROM sessions WHERE token=? AND player_id=p.id)").bind(token,expires,player.id,admin.id,old),
  c.env.DB.prepare('DELETE FROM sessions WHERE token=? AND changes()=1').bind(old),
 ]);
 // 没插进去说明绑定或旧会话在这期间变了 —— 绝不能退回「只有旧 token」的状态
 if(!result[0].meta.changes)fail(403,'绑定关系或登录状态已变化，请重新验证');
 const r=reply({combined:true});
 r.headers.set('Set-Cookie',`lc_session=${token}; ${SESSION_COOKIE_ATTRS}; Max-Age=${SESSION_COOKIE_MAX_AGE}`);
 return r;
}

/**
 * 管理密码登录入口。
 *
 * 限流指纹是 player+admin 的组合，不含 IP：同一账号换网络也照样被限。
 */
export async function enterWithPassword(c,password){
 const {player,admin}=await boundAdministrator(c);
 const fingerprint='admin-verify:'+player.id+':'+admin.id;
 const attempts=await c.env.DB
  .prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE fingerprint=? AND created_at>datetime('now','-10 minutes')")
  .bind(fingerprint)
  .first();
 if(attempts.n>=10)fail(429,'验证次数过多，请稍后重试');
 // 密码本身不合法也记一次失败，否则可以拿畸形输入绕过计数
 if(typeof password!=='string'||password.length>128||!await verifyPassword(password,admin.password_hash,admin.salt)){
  await c.env.DB.prepare('INSERT INTO auth_attempts(fingerprint) VALUES(?)').bind(fingerprint).run();
  fail(401,'管理密码错误');
 }
 await c.env.DB.prepare('DELETE FROM auth_attempts WHERE fingerprint=?').bind(fingerprint).run();
 return elevate(c,player,admin);
}

/**
 * 退出管理模式。
 *
 * 优先保留玩家身份：管理员登录通常绑着玩家，退到「仍是玩家、但不再是管理员」
 * 比把人踢下线体验好。旧版管理员会话里没有 player_id，才需要反查绑定关系。
 * 找不到可回退的玩家时才销毁会话并清 cookie。
 */
export async function leaveAdministration(c){
 const token=readToken(c.request);
 const session=await getSession(c.env,token);
 if(!session?.admin_id)return reply({admin_logged_out:true});
 let player=session.player_id
  ?await c.env.DB.prepare("SELECT id FROM players WHERE id=? AND status='active'").bind(session.player_id).first()
  :null;
 if(!player&&!session.player_id)player=await c.env.DB
  .prepare("SELECT p.id FROM players p JOIN admins a ON p.linked_admin_id=a.id AND a.linked_player_id=p.id WHERE a.id=? AND p.status='active'")
  .bind(session.admin_id)
  .first();
 const r=reply({admin_logged_out:true,player_retained:!!player});
 if(player)await c.env.DB
  .prepare('UPDATE sessions SET admin_id=NULL,player_id=? WHERE token=? AND admin_id=?')
  .bind(player.id,token,session.admin_id)
  .run();
 else {
  await c.env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
  r.headers.set('Set-Cookie',`lc_session=; ${SESSION_COOKIE_ATTRS}; Max-Age=0`);
 }
 return r;
}
