import {endpoint,identity,reply} from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{const player=await identity(c);return reply({rewards:(await c.env.DB.prepare('SELECT ticket_ref,admin_id,amount,paid,paid_at,created_at FROM ticket_rewards WHERE player_id=? ORDER BY created_at DESC').bind(player.id).all()).results});});
