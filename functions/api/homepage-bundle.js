import {
  endpoint,reply
}
from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
  const entries=[['hotels','hotels'],['rooms','hotel_rooms'],['tracks','race_tracks'],['licenseReqs','license_requirements']];const bundle={
  }
  ;await Promise.all(entries.map(async([key,table])=>bundle[key]=(await c.env.DB.prepare(`SELECT * FROM ${table} ORDER BY sort_order,id`).all()).results));bundle.announcements=(await c.env.DB.prepare('SELECT id,title,content,image_url,created_at,updated_at FROM announcements ORDER BY id DESC LIMIT 5').all()).results;bundle.playerCount=(await c.env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE status='active'").first()).n;return reply({
    bundle
  }
  );
}
);
