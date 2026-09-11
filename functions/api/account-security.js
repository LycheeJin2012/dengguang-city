import {endpoint,identity,body,reply,fail} from '../_core/request.js';
import {readToken} from '../_shared/session.js';
export const onRequestGet=c=>endpoint(async()=>{
 const p=await identity(c),token=readToken(c.request),db=c.env.DB;
 const sessions=(await db.prepare("SELECT created_at,expires_at,device_label,CASE WHEN token=? THEN 1 ELSE 0 END AS current FROM sessions WHERE player_id=? AND julianday(expires_at)>julianday('now') ORDER BY created_at DESC LIMIT 100").bind(token,p.id).all()).results;
 const history=(await db.prepare('SELECT id,method,device_label,created_at FROM login_history WHERE player_id=? ORDER BY id DESC LIMIT 50').bind(p.id).all()).results;
 return reply({sessions,history});
});
export const onRequestPost=c=>endpoint(async()=>{const p=await identity(c),b=await body(c.request);if(b.action!=='revoke-others')fail(400,'操作无效');const r=await c.env.DB.prepare('DELETE FROM sessions WHERE player_id=? AND token!=?').bind(p.id,readToken(c.request)).run();return reply({revoked:r.meta.changes});});
