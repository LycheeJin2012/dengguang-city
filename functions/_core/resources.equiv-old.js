import {validatePublicImage} from './uploads.js';
import {
  endpoint,identity,body,integer,string,fail,reply
}
from './request.js';
const str=(max=200,required=false)=>({
  type:'text',max,required
}
);
const num=(value=0,min=0,max=1000000)=>({
  type:'number',value,min,max
}
);
const bool={
  type:'number',value:1,min:0,max:1
}
;
export const resources={
  hotels:{
    table:'hotels',key:'hotels',fields:{
      owner_id:{type:'nullable-id'},
      name:str(100,true),address:str(),description:str(2000),image_url:{
        type:'url'
      }
      ,sort_order:num(),is_active:bool
    }
  }
  , 'hotel-rooms':{
    table:'hotel_rooms',key:'rooms',fields:{
      hotel_id:num(null,1),name:str(100,true),capacity:num(2,1,6),beds:str(),breakfast_included:bool,price_per_night:num(),description:str(2000),image_url:{
        type:'url'
      }
      ,sort_order:num(),is_active:bool
    }
  }
  , 'race-tracks':{
    table:'race_tracks',key:'tracks',fields:{
      name:str(100,true),length_km:{
        ...num(),decimal:true
      }
      ,laps:num(1,1),difficulty:str(),description:str(2000),image_url:{
        type:'url'
      }
      ,trial_price:num(),sort_order:num(),is_active:bool
    }
  }
  , 'license-req':{
    table:'license_requirements',key:'requirements',fields:{
      exam_type:{
        type:'enum',values:['B','A','S','written','road','upgrade'],value:'B'
      }
      ,title:str(100,true),description:str(2000),requirements:str(2000),min_age:num(),duration_minutes:num(30,1),sort_order:num(),is_active:bool
    }
  }
  , announcements:{
    table:'announcements',key:'announcements',fields:{
      title:str(80,true),content:str(2000,true),image_url:{
        type:'url'
      }
    }
  }
  , gallery:{
    table:'gallery_items',key:'items',fields:{
      cat:{type:'enum',values:['city','road','kart','nature','announcement'],value:'city'},is_featured:num(0,0,1),
      num:num(1,1),title:str(100,true),caption:str(500),image_url:{
        type:'url',required:true
      }
      ,sort_order:num(),is_active:bool
    }
  }
  ,
}
;
export function validated(fields,data,partial=false){
  const out={
  }
  ;
  for(const [key,rule] of Object.entries(fields)){
    if(partial&&!(key in data))continue;
    let v=data[key]??rule.value;
    if(rule.type==='text')v=string(v??'',key,rule.max,{
      required:rule.required
    }
    );
    if(rule.type==='nullable-id')v=v?integer(v,key):null;
    if(rule.type==='number'){
      if(v==null)fail(400,`${key} 必填`);
      if(rule.decimal){
        v=Number(v);
        if(!Number.isFinite(v)||v<rule.min||v>rule.max)fail(400,`${key} 数值无效`);
      }
      else v=integer(v,key,rule.min,rule.max);
    }
    if(rule.type==='enum'&&!rule.values.includes(v))fail(400,`${key} 选项无效`);
    if(rule.type==='url'){
      v=string(v??'',key,1500000,{
        required:!!rule.required
      }
      );
      if(v&&!/^https?:\/\//i.test(v)&&!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(v)&&!/^\/?assets\/(?!.*\.\.)/.test(v)&&!/^\/api\/uploads\?/.test(v))fail(400,'图片必须是 http(s) URL、本站资源或 PNG/JPEG/WebP/GIF 图片');
    }
    out[key]=v;
  }
  return out;
}
export function resource(name){
  const def=resources[name];
  return context=>endpoint(async()=>{
    const {
      env,request
    }
    =context;const write=request.method!=='GET';const admin=await identity(context,write?'super':'admin');const url=new URL(request.url);const id=url.searchParams.has('id')?integer(url.searchParams.get('id')):null; if(request.method==='GET'){
      const where=[],binds=[];if(id){
        where.push('id=?');binds.push(id);
      }
      if(name==='hotel-rooms'&&url.searchParams.has('hotel_id')){
        where.push('hotel_id=?');binds.push(integer(url.searchParams.get('hotel_id')));
      }
      const rows=await env.DB.prepare(`SELECT * FROM ${def.table}${where.length?' WHERE '+where.join(' AND '):''} ORDER BY ${'sort_order' in def.fields?'sort_order, ':''}id DESC LIMIT 500`).bind(...binds).all();return reply({
        [def.key]:rows.results
      }
      );
    }
    if(!['POST','PATCH','DELETE'].includes(request.method))fail(405,'不支持此请求方式'); if(request.method!=='POST'){
      if(!id)fail(400,'id 必填');if(!await env.DB.prepare(`SELECT id FROM ${def.table} WHERE id=?`).bind(id).first())fail(404,'记录不存在');
    }
    if(request.method==='DELETE'){
      const refs=name==='hotels'?[['hotel_rooms','hotel_id']]:name==='hotel-rooms'?[['bookings','room_id']]:name==='race-tracks'?[['circuit_signups','track_id'],['race_times','track_id']]:[]; for(const [table,col] of refs)if(await env.DB.prepare(`SELECT id FROM ${table} WHERE ${col}=? LIMIT 1`).bind(id).first())fail(409,'此记录已有房型、报名或历史记录，请改为停用以保留历史'); await env.DB.prepare(`DELETE FROM ${def.table} WHERE id=?`).bind(id).run();return reply({
        deleted:id
      }
      );
    }
    const input=await body(request);if(name==='gallery'){if(input.title===undefined&&input.label!==undefined)input.title=input.label;if(input.image_url===undefined&&input.file_url!==undefined)input.image_url=input.file_url;if(input.is_active===undefined&&input.is_published!==undefined)input.is_active=input.is_published?1:0;}
    const values=validated(def.fields,input,request.method==='PATCH');if(!Object.keys(values).length)fail(400,'没有可更新的字段');
    if(values.owner_id&&!await env.DB.prepare("SELECT id FROM hotel_owners WHERE id=? AND status='active'").bind(values.owner_id).first())fail(404,'酒店老板账户不存在或已停用');
    const publicImage=values.image_url?await validatePublicImage(context,values.image_url,admin):null; if(name==='hotel-rooms'&&values.hotel_id&&!await env.DB.prepare('SELECT id FROM hotels WHERE id=?').bind(values.hotel_id).first())fail(404,'酒店不存在'); if(name==='announcements'&&request.method==='POST')values.created_by=admin.id; if(name==='gallery'){
      if('title' in values)values.label=values.title;
      if('image_url' in values)values.file_url=values.image_url;
      if('is_active' in values)values.is_published=values.is_active;
      values.updated_at=new Date().toISOString();
      if(request.method==='POST'){values.created_by=admin.id;values.created_at=values.updated_at;}
    }
    const keys=Object.keys(values),params=Object.values(values);
    if(request.method==='POST'){
      const operations=[env.DB.prepare(`INSERT INTO ${def.table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...params)];
      if(name==='announcements')operations.push(env.DB.prepare("INSERT INTO notification_log(player_id,type,title,body,link) SELECT DISTINCT s.player_id,'announcement',?,?,'/#notice' FROM subscriptions s JOIN players p ON p.id=s.player_id WHERE s.type='announcement' AND s.enabled=1 AND p.status='active'").bind(values.title,values.content.slice(0,500)));
      if(publicImage)operations.push(env.DB.prepare('UPDATE media_uploads SET public_access=1 WHERE id=?').bind(publicImage));
      const results=await env.DB.batch(operations);return reply({id:results[0].meta.last_row_id,created:true},201);
    }
    const updated=name!=='gallery'?", updated_at=datetime('now')":'';
    const operations=[env.DB.prepare(`UPDATE ${def.table} SET ${keys.map(k=>k+'=?').join(',')}${updated} WHERE id=?`).bind(...params,id)];
    if(publicImage)operations.push(env.DB.prepare('UPDATE media_uploads SET public_access=1 WHERE id=?').bind(publicImage));
    await env.DB.batch(operations);return reply({id,updated:true});

  }
  );
}
