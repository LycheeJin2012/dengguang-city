import {
  endpoint,body,string,fail,reply
}
from '../_core/request.js';
import {
  isUsername,isEmail
}
from '../_shared/validators.js';
import {
  hashPassword
}
from '../_shared/auth.js';
export const onRequestPost=c=>endpoint(async()=>{
  const b=await body(c.request),username=string(b.username,'游戏 ID',32),email=string(b.email,'邮箱',254).toLowerCase();if(!isUsername(username)||/[<>]/.test(username))fail(400,'游戏 ID 需 2–32 字符，不含 @、尖括号或控制字符');if(!isEmail(email))fail(400,'邮箱格式不正确');if(typeof b.password!=='string'||b.password.length<8||b.password.length>128)fail(400,'密码需 8–128 位');if(await c.env.DB.prepare('SELECT id FROM players WHERE username=? OR email=?').bind(username,email).first())fail(409,'账号或邮箱已注册');const {
    hash,salt
  }
  =await hashPassword(b.password);const r=await c.env.DB.prepare("INSERT INTO players(username,email,password_hash,salt,game_id,status) VALUES(?,?,?,?,?,'pending')").bind(username,email,hash,salt,username).run();return reply({
    user:{
      id:r.meta.last_row_id,username,email,status:'pending'
    }
  }
  ,201);
}
);
