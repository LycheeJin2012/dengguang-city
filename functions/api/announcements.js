import {endpoint,reply} from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>reply({announcements:(await c.env.DB.prepare('SELECT id,title,content,image_url,created_at,updated_at FROM announcements ORDER BY id DESC LIMIT 100').all()).results}));
