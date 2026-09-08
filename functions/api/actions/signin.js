import {
  endpoint,identity,reply,fail
}
from '../../_core/request.js';
const today=()=>new Intl.DateTimeFormat('sv-SE',{
  timeZone:'Asia/Shanghai'
}
).format(new Date());
async function status(c,p){
  const day=today(),rows=await c.env.DB.prepare('SELECT signin_date,streak,emeralds_earned FROM daily_signin WHERE player_id=? ORDER BY signin_date DESC LIMIT 7').bind(p.id).all();
  const found=rows.results.find(r=>r.signin_date===day),yesterday=new Date(+new Date(day)-86400000).toISOString().slice(0,10);
  const latest=rows.results[0];
  return {
    logged_in:true,today:day,signed_today:!!found,current_streak:latest&&[day,yesterday].includes(latest.signin_date)?latest.streak:0,today_streak:found?.streak||0,today_emeralds:found?.emeralds_earned||0,emeralds:p.emeralds,recent:rows.results
  }
  ;
}
export const onRequestGet=c=>endpoint(async()=>{
  let p;try{
    p=await identity(c);
  }
  catch(e){
    if(e.status===401)return reply({
      logged_in:false,signed_today:false,current_streak:0,recent:[]
    }
    );throw e;
  }
  return reply(await status(c,p));
}
);
export const onRequestPost=c=>endpoint(async()=>{
  if(new URL(c.request.url).searchParams.get('action')==='signin-status')return onRequestGet(c);const p=await identity(c),day=today(),s=await status(c,p);if(s.signed_today)fail(409,'今天已经签到');const streak=s.current_streak+1,reward=(streak-1)%7+1; // D1 batch is atomic. A duplicate day rolls back the balance increment as well.
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO daily_signin(player_id,signin_date,streak,emeralds_earned,reward) VALUES(?,?,?,?,?)').bind(p.id,day,streak,reward,reward),c.env.DB.prepare('UPDATE players SET emeralds=emeralds+? WHERE id=?').bind(reward,p.id)]); return reply({
    signed_today:true,today_streak:streak,today_emeralds:reward,current_streak:streak,emeralds:p.emeralds+reward,message:`签到成功！+${reward} 💎`
  }
  );
}
);
