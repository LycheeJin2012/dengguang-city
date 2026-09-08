import {endpoint,identity,reply} from '../../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{await identity(c,'admin');return reply({hotels:(await c.env.DB.prepare('SELECT * FROM hotels ORDER BY id').all()).results,rooms:(await c.env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY id').all()).results});});
