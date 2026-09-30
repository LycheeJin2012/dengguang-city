import {identity,integer,fail,reply} from './request.js';
import {boundAdministrator,elevate} from './admin-session.js';
import {readToken} from '../_shared/session.js';
import {randomToken} from '../_shared/auth.js';
import {bytesToB64url,b64urlToBytes} from '../_shared/bytes.js';
import {parseAuthData,verifyClientData,expectedRpIdHash,verifyEs256} from '../_shared/webauthn.js';

const CHALLENGE_TTL_MS=300_000;
const rpIdOf=url=>new URL(url).hostname.replace(/^www\./,'');

/**
 * 会话指纹：SHA-256(当前 session token)。
 *
 * 挑战被这个值绑死，所以同一个 challenge_token 换一条会话就验不过 ——
 * 这是防止「验证请求被别的登录态捡去用」的关键，不能省。
 */
const sessionTag=async request=>bytesToB64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(readToken(request)||''))));

async function subject(c,adminMode){
 return adminMode?boundAdministrator(c):{player:await identity(c),admin:null};
}

/**
 * 可用密钥的 WHERE 片段。
 *
 * 管理员模式下玩家密钥和管理员密钥都算当前账号的；
 * 纯玩家模式只看 player_id —— 否则任何玩家都能验证别人的密钥。
 */
function keyFilter(player,admin){
 return admin
  ?{sql:'(player_id=? OR (admin_id=? AND player_id IS NULL))',args:[player.id,admin.id]}
  :{sql:'player_id=?',args:[player.id]};
}

export async function startVerification(c,input,adminMode=false){
 const {player,admin}=await subject(c,adminMode);
 const filter=keyFilter(player,admin);
 const keyId=input.id?integer(input.id):null;
 const keys=(await c.env.DB
  .prepare(`SELECT id,credential_id,transports FROM passkeys WHERE ${filter.sql}${keyId?' AND id=?':''}`)
  .bind(...filter.args,...(keyId?[keyId]:[]))
  .all()).results;
 if(!keys.length)fail(404,adminMode?'绑定账号没有可用通行密钥，请先在玩家主页添加':'没有可验证的通行密钥');
 const challenge=bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
 const token=randomToken(24);
 const purpose=adminMode?'admin-verify':'key-test';
 // 归属信息与 session 指纹一起存进 player_id 字段（历史字段名，含义是挑战元数据）
 const metadata=JSON.stringify({player_id:player.id,admin_id:admin?.id||null,key_id:keyId,session_tag:await sessionTag(c.request)});
 await c.env.DB
  .prepare('INSERT INTO webauthn_challenges(token,challenge,purpose,player_id,expires_at) VALUES(?,?,?,?,?)')
  .bind(token,challenge,purpose,metadata,new Date(Date.now()+CHALLENGE_TTL_MS).toISOString())
  .run();
 return reply({
  challenge_token:token,
  publicKey:{
   challenge,
   rpId:rpIdOf(c.request.url),
   userVerification:'required',
   timeout:60000,
   allowCredentials:keys.map(credentialDescriptor),
  },
 });
}

/** transports 是客户端上报的 JSON，坏了就当没有，不能让整个验证失败。 */
function credentialDescriptor(key){
 let transports=[];
 try{transports=JSON.parse(key.transports||'[]');}catch{}
 return {type:'public-key',id:key.credential_id,transports:Array.isArray(transports)?transports:[]};
}

export async function finishVerification(c,input,adminMode=false){
 const {player,admin}=await subject(c,adminMode);
 const purpose=adminMode?'admin-verify':'key-test';
 if(!input.challenge_token||!input.credential?.response)fail(400,'缺少验证数据');
 const challenge=await c.env.DB
  .prepare('SELECT * FROM webauthn_challenges WHERE token=? AND purpose=?')
  .bind(input.challenge_token,purpose)
  .first();
 if(!challenge)fail(400,'验证请求已失效，请重试');
 const metadata=JSON.parse(challenge.player_id);
 // 三项全对才算同一个请求：账号、管理员身份、会话
 if(metadata.player_id!==player.id
  ||metadata.admin_id!==(admin?.id||null)
  ||metadata.session_tag!==await sessionTag(c.request))fail(403,'验证请求不属于当前账号或登录状态');
 // 一次性：先消费再验签，保证同一个 token 永远只能成功一次
 const consumed=await c.env.DB
  .prepare('DELETE FROM webauthn_challenges WHERE token=? AND purpose=?')
  .bind(input.challenge_token,purpose)
  .run();
 if(!consumed.meta.changes)fail(400,'验证请求已使用');
 if(!Number.isFinite(+new Date(challenge.expires_at))||new Date(challenge.expires_at)<=new Date())fail(400,'验证请求已过期');
 const filter=keyFilter(player,admin);
 const cred=input.credential;
 const pk=await c.env.DB
  .prepare(`SELECT * FROM passkeys WHERE credential_id=? AND ${filter.sql}`)
  .bind(cred.id,...filter.args)
  .first();
 if(!pk||metadata.key_id&&pk.id!==metadata.key_id)fail(403,'请选择当前账号对应的通行密钥');
 try{
  // rawId 与 id 不一致是典型的混淆攻击信号
  if(cred.type!=='public-key'||cred.rawId&&cred.rawId!==cred.id)throw new Error('credential 类型或编号无效');
  const clientData=b64urlToBytes(cred.response.clientDataJSON);
  const authData=b64urlToBytes(cred.response.authenticatorData);
  const signature=b64urlToBytes(cred.response.signature);
  const url=new URL(c.request.url);
  const client=verifyClientData(clientData,challenge.challenge,{type:'webauthn.get',origin:url.origin});
  if(client.crossOrigin===true)throw new Error('不接受跨站验证');
  const parsed=parseAuthData(authData);
  const rpHash=await expectedRpIdHash(rpIdOf(url));
  // flags：bit0=UP（用户在场）bit2=UV（用户已验证），两个都要
  if(bytesToB64url(parsed.rpIdHash)!==bytesToB64url(rpHash)||!(parsed.flags&1)||!(parsed.flags&4))throw new Error('请在正确网站完成设备身份验证');
  if(!await verifyEs256(null,null,JSON.parse(pk.public_key_jwk),signature,authData,clientData))throw new Error('签名验证失败');
  // 计数器不前进 = 可能被克隆的密钥
  if(parsed.signCount>0&&pk.sign_count>0&&parsed.signCount<=pk.sign_count)throw new Error('密钥计数异常，请重新验证或使用密码');
  // 条件更新：并发验证时只有第一个能改成，第二个 changes=0 → 409
  const result=await c.env.DB
   .prepare("UPDATE passkeys SET sign_count=?,last_used_at=datetime('now') WHERE id=? AND sign_count=?")
   .bind(parsed.signCount,pk.id,pk.sign_count)
   .run();
  if(!result.meta.changes)fail(409,'密钥状态已变化，请重新验证');
 }catch(e){
  // 带 status 的是业务错误（409 竞争），原样上抛；其余一律降级成 400
  if(e.status)throw e;
  fail(400,e.message||'通行密钥验证失败');
 }
 if(adminMode)return elevate(c,player,admin);
 return reply({verified:true,id:pk.id,name:pk.name});
}
