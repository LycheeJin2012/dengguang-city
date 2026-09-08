import {endpoint,reply,identity,fail} from '../_core/request.js';
import {resource} from '../_core/resources.js';
export const onRequestGet=c=>endpoint(async()=>{
 const u=new URL(c.request.url),all=u.searchParams.get('all')==='1',cat=u.searchParams.get('cat');
 if(all)await identity(c,'super');if(cat&&!['city','road','kart','nature','announcement'].includes(cat))fail(400,'图集分类无效');
 const where=[],args=[];if(!all)where.push('is_active=1');if(cat){where.push('cat=?');args.push(cat);}if(u.searchParams.get('featured')==='1')where.push('is_featured=1');
 const rows=await c.env.DB.prepare(`SELECT id,num,title,caption,image_url,sort_order,cat,is_featured,is_active AS is_published,title AS label,image_url AS file_url FROM gallery_items ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY sort_order,id LIMIT 200`).bind(...args).all();
 return reply({items:rows.results});
});
export const onRequestPost=resource('gallery');export const onRequestPatch=resource('gallery');export const onRequestDelete=resource('gallery');
