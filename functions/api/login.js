import {
  endpoint,body,string,fail,reply
}
from '../_core/request.js';
import {
  verifyPassword
}
from '../_shared/auth.js';
import {
  readToken,getSession,createSession,destroySession
}
from '../_shared/session.js';
const cookie=(token,age=28800)=>`lc_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
export const onRequestGet=c=>endpoint(async()=>{
  const s=await getSession(c.env,readToken(c.request));if(!s)fail(401,'请先登录');const admin=s.admin_id?await c.env.DB.prepare('SELECT id,username,role,linked_player_id FROM admins WHERE id=?').bind(s.admin_id).first():null;const player=s.player_id?await c.env.DB.prepare("SELECT id,username,email,game_id,status,avatar_emoji,bio,linked_admin_id,emeralds,created_at FROM players WHERE id=? AND status='active'").bind(s.player_id).first():null;if(!admin&&!player)fail(401,'会话已失效');return reply({
    role:admin?.role||'player',user:admin||player,admin,player,combined:!!admin&&!!player
  }
  );
}
);
export const onRequestPost=c=>endpoint(async()=>{
  const b=await body(c.request),username=string(b.username,'账号',64),password=b.password;if(typeof password!=='string'||password.length<1||password.length>128)fail(400,'密码无效');const ip=c.request.headers.get('CF-Connecting-IP')||'local';const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip+'|'+username)))).map(x=>x.toString(16).padStart(2,'0')).join(''); const count=await c.env.DB.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE fingerprint=? AND created_at>datetime('now','-10 minutes')").bind(key).first();if(count.n>=10)fail(429,'尝试次数过多，请 10 分钟后重试'); const target=b.target==='admin'?'admin':'player';let p=target==='player'?await c.env.DB.prepare('SELECT * FROM players WHERE username=?').bind(username).first():null;let a=!p?await c.env.DB.prepare('SELECT * FROM admins WHERE username=?').bind(username).first():null;const account=p||a; if(!account||!await verifyPassword(password,account.password_hash,account.salt)){
    await c.env.DB.prepare('INSERT INTO auth_attempts(fingerprint) VALUES(?)').bind(key).run();fail(401,'账号或密码错误');
  }
  if(p&&p.status!=='active')fail(403,p.status==='pending'?'注册申请正在审核':'账号已停用'); await c.env.DB.prepare('DELETE FROM auth_attempts WHERE fingerprint=?').bind(key).run();const s=await createSession(c.env,p?.id||null,a?.id||null);if(p)await c.env.DB.prepare("UPDATE players SET last_login_at=datetime('now') WHERE id=?").bind(p.id).run();const r=reply({
    user_id:account.id,role:a?.role||'player'
  }
  );r.headers.set('Set-Cookie',cookie(s.token));return r;
}
);
export const onRequestDelete=c=>endpoint(async()=>{
  await destroySession(c.env,readToken(c.request));const r=reply({
    logged_out:true
  }
  );r.headers.set('Set-Cookie',cookie('',0));return r;
}
);
