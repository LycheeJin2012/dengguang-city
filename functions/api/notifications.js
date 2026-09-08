import {
  endpoint,identity,integer,reply,fail
}
from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
  const p=await identity(c),u=new URL(c.request.url),limit=integer(u.searchParams.get('limit')||100,'limit',1,200),unread=u.searchParams.get('unread')==='1';const r=await c.env.DB.prepare(`SELECT * FROM notification_log WHERE player_id=? ${unread?'AND read_at IS NULL':''} ORDER BY id DESC LIMIT ?`).bind(p.id,limit).all();const n=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM notification_log WHERE player_id=? AND read_at IS NULL').bind(p.id).first();return reply({
    notifications:r.results,unread_count:n.n
  }
  );
}
);
export const onRequestPatch=c=>endpoint(async()=>{
  const p=await identity(c),u=new URL(c.request.url);if(u.searchParams.get('action')==='read-all'){
    await c.env.DB.prepare("UPDATE notification_log SET read_at=datetime('now') WHERE player_id=? AND read_at IS NULL").bind(p.id).run();return reply({
      read_all:true
    }
    );
  }
  const id=integer(u.searchParams.get('id'));if(!await c.env.DB.prepare('SELECT id FROM notification_log WHERE id=? AND player_id=?').bind(id,p.id).first())fail(404,'通知不存在');await c.env.DB.prepare("UPDATE notification_log SET read_at=COALESCE(read_at,datetime('now')) WHERE id=? AND player_id=?").bind(id,p.id).run();return reply({
    id,read:true
  }
  );
}
);
