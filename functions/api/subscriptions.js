import {
  endpoint,identity,body,integer,reply,fail
}
from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
  const p=await identity(c),r=await c.env.DB.prepare('SELECT * FROM subscriptions WHERE player_id=?').bind(p.id).all();return reply({
    subscriptions:r.results
  }
  );
}
);
export const onRequestPost=c=>endpoint(async()=>{
  const p=await identity(c),b=await body(c.request);if(!['announcement','reply','dm'].includes(b.type)||b.channel&&b.channel!=='site')fail(400,'仅支持站内公告、回复、私信订阅');const found=await c.env.DB.prepare('SELECT id FROM subscriptions WHERE player_id=? AND type=? AND target_id IS NULL AND channel=\'site\'').bind(p.id,b.type).first();if(found){
    await c.env.DB.prepare('UPDATE subscriptions SET enabled=1 WHERE id=?').bind(found.id).run();return reply({
      id:found.id
    }
    );
  }
  const r=await c.env.DB.prepare("INSERT INTO subscriptions(player_id,type,channel) VALUES(?,?,'site')").bind(p.id,b.type).run();return reply({
    id:r.meta.last_row_id
  }
  ,201);
}
);
export const onRequestDelete=c=>endpoint(async()=>{
  const p=await identity(c),id=integer(new URL(c.request.url).searchParams.get('id'));const r=await c.env.DB.prepare('UPDATE subscriptions SET enabled=0 WHERE id=? AND player_id=?').bind(id,p.id).run();if(!r.meta.changes)fail(404,'订阅不存在');return reply({
    id,disabled:true
  }
  );
}
);
