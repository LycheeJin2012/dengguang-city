import {endpoint,identity,reply} from '../../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{await identity(c,'super');const rows=(await c.env.DB.prepare("SELECT f.*,p.username FROM reply_feedback f JOIN players p ON p.id=f.player_id ORDER BY f.updated_at DESC,f.id DESC LIMIT 200").all()).results;return reply({feedback:rows});});
