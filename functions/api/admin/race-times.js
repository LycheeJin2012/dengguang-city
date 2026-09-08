import {
  endpoint,identity,reply
}
from '../../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
  await identity(c,'admin');const rows=await c.env.DB.prepare('SELECT r.*, p.username AS player_username,t.name AS track_name FROM race_times r LEFT JOIN players p ON p.id=r.player_id LEFT JOIN race_tracks t ON t.id=r.track_id ORDER BY r.recorded_at DESC LIMIT 200').all();return reply({
    times:rows.results
  }
  );
}
);
