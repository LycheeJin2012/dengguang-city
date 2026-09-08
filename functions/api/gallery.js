import {endpoint,reply} from '../_core/request.js';import {resource} from '../_core/resources.js';
export const onRequestGet=c=>endpoint(async()=>reply({items:(await c.env.DB.prepare('SELECT id,num,title,caption,image_url,sort_order FROM gallery_items WHERE is_active=1 ORDER BY sort_order,id').all()).results}));
export const onRequestPost=resource('gallery');export const onRequestPatch=resource('gallery');export const onRequestDelete=resource('gallery');
