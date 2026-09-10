import {
  endpoint,identity,body,string,integer,reply,fail
}
from '../_core/request.js';
const format=ms=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
export const onRequestGet=c=>endpoint(async()=>{
  const u=new URL(c.request.url);if(u.searchParams.get('my')==='1'){
    const p=await identity(c),r=await c.env.DB.prepare('SELECT r.*,t.name AS track_name FROM race_times r LEFT JOIN race_tracks t ON t.id=r.track_id WHERE r.player_id=? ORDER BY r.id DESC LIMIT 100').bind(p.id).all();return reply({
      times:r.results.map(r=>({
        ...r,formatted:format(r.time_ms)
      }
      ))
    }
    );
  }
  fail(410,'排行榜展示已移除，请在个人主页查看自己的成绩');
}
);
export const onRequestPost=c=>endpoint(async()=>{
  const p=await identity(c),b=await body(c.request),track=integer(b.track_id),time=integer(b.time_ms,'圈速',1000,3600000),kart=string(b.kart_name??'','车型',60,{
    required:false
  }
  );if(!['B','A','S'].includes(b.license_grade))fail(400,'驾照等级无效');if(!await c.env.DB.prepare('SELECT id FROM race_tracks WHERE id=? AND is_active=1').bind(track).first())fail(404,'赛道未开放');const r=await c.env.DB.prepare('INSERT INTO race_times(player_id,track_id,time_ms,kart_name,license_grade) VALUES(?,?,?,?,?)').bind(p.id,track,time,kart,b.license_grade).run();return reply({
    id:r.meta.last_row_id,formatted:format(time),verified:0
  }
  ,201);
}
);
export const onRequestPatch=c=>endpoint(async()=>{
  await identity(c,'admin');const u=new URL(c.request.url),id=integer(u.searchParams.get('id')),action=u.searchParams.get('action');if(!['verify','unverify'].includes(action))fail(400,'操作无效');const r=await c.env.DB.prepare('UPDATE race_times SET verified=? WHERE id=?').bind(action==='verify'?1:0,id).run();if(!r.meta.changes)fail(404,'成绩不存在');return reply({
    id,verified:action==='verify'?1:0
  }
  );
}
);
