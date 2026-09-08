import {
  endpoint,integer,reply,fail
}
from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
  const u=new URL(c.request.url),type=u.searchParams.get('type')||'messages',limit=integer(u.searchParams.get('limit')||20,'limit',1,100);let sql;if(['messages','bookings'].includes(type))sql=`SELECT p.id AS player_id,p.username,p.avatar_emoji,COUNT(*) AS score FROM ${type} b JOIN players p ON p.id=b.player_id WHERE p.status='active' GROUP BY p.id ORDER BY score DESC,p.id LIMIT ?`;else if(type==='licenses')sql=`SELECT p.id AS player_id,p.username,p.avatar_emoji,COUNT(DISTINCT b.exam_type) AS score,GROUP_CONCAT(DISTINCT b.exam_type) AS grades FROM license_signups b JOIN players p ON p.id=b.player_id WHERE p.status='active' AND (b.status='passed' OR b.result='passed') GROUP BY p.id ORDER BY score DESC,p.id LIMIT ?`;else fail(400,'榜单类型无效');const r=await c.env.DB.prepare(sql).bind(limit).all();return reply({
    type,entries:r.results.map((r,i)=>({
      ...r,rank:i+1
    }
    ))
  }
  );
}
);
