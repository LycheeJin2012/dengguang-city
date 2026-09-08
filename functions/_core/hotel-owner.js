import {linkedBusinessEvents} from './ticket-policy.js';
import {validatePublicImage} from './uploads.js';
import {endpoint,identity,body,string,integer,fail,reply} from './request.js';
import {password,username} from './accounts.js';
import {hashPassword} from '../_shared/auth.js';
import {validated,resources} from './resources.js';
export async function hotelOwner(c){return identity(c,'hotel_owner');}
export const owners=c=>endpoint(async()=>{const superAdmin=await identity(c,'super'),u=new URL(c.request.url),db=c.env.DB;if(c.request.method==='GET')return reply({owners:(await db.prepare('SELECT o.id,o.username,o.linked_player_id,o.status,o.created_at,p.username AS player_username,(SELECT COUNT(*) FROM hotels h WHERE h.owner_id=o.id) AS hotel_count FROM hotel_owners o LEFT JOIN players p ON p.id=o.linked_player_id ORDER BY o.id').all()).results});const input=await body(c.request);const values={};
 if(input.username!==undefined)values.username=username(input.username);if(input.status!==undefined){if(!['active','disabled'].includes(input.status))fail(400,'状态无效');values.status=input.status;}
 if(input.linked_player_id!==undefined){values.linked_player_id=input.linked_player_id?integer(input.linked_player_id):null;if(values.linked_player_id&&!await db.prepare("SELECT id FROM players WHERE id=? AND status='active'").bind(values.linked_player_id).first())fail(404,'绑定玩家不存在或未激活');}
 if(c.request.method==='POST'){const {hash,salt}=await hashPassword(password(input.password));if(!values.username)fail(400,'账号必填');const r=await db.prepare('INSERT INTO hotel_owners(username,password_hash,salt,linked_player_id,status,created_by) VALUES(?,?,?,?,?,?)').bind(values.username,hash,salt,values.linked_player_id||null,values.status||'active',superAdmin.id).run();return reply({id:r.meta.last_row_id},201);}
 if(c.request.method!=='PATCH')fail(405,'请停用账户以保留经营记录');const id=integer(u.searchParams.get('id'));if(!await db.prepare('SELECT id FROM hotel_owners WHERE id=?').bind(id).first())fail(404,'酒店老板账户不存在');if(input.new_password){const {hash,salt}=await hashPassword(password(input.new_password));values.password_hash=hash;values.salt=salt;}if(!Object.keys(values).length)fail(400,'没有修改字段');const ops=[db.prepare(`UPDATE hotel_owners SET ${Object.keys(values).map(k=>k+'=?').join(',')} WHERE id=?`).bind(...Object.values(values),id)];if(input.new_password||input.status)ops.push(db.prepare('DELETE FROM sessions WHERE hotel_owner_id=?').bind(id));await db.batch(ops);return reply({id,updated:true});});
export const ownerPortal=c=>endpoint(async()=>{const owner=await hotelOwner(c),db=c.env.DB,u=new URL(c.request.url);if(c.request.method==='GET'){
 if(u.searchParams.get('history')==='1'){
  const entity=u.searchParams.get('entity'),id=integer(u.searchParams.get('id'));let record;
  if(entity==='hotels')record=await db.prepare('SELECT id FROM hotels WHERE id=? AND owner_id=?').bind(id,owner.id).first();
  else if(entity==='rooms')record=await db.prepare('SELECT r.id FROM hotel_rooms r JOIN hotels h ON h.id=r.hotel_id WHERE r.id=? AND h.owner_id=?').bind(id,owner.id).first();
  else if(entity==='bookings')record=await db.prepare('SELECT b.id FROM bookings b JOIN hotel_rooms r ON CAST(r.id AS TEXT)=b.room_id JOIN hotels h ON h.id=r.hotel_id WHERE b.id=? AND h.owner_id=?').bind(id,owner.id).first();
  if(!record)fail(404,'记录不存在');const resource={hotels:'hotels',rooms:'hotel_rooms',bookings:'bookings'}[entity];
  const events=await db.prepare('SELECT actor_type,actor_id,actor_name,action,created_at,http_status FROM audit_events WHERE resource_type=? AND resource_id=? ORDER BY id DESC LIMIT 100').bind(resource,String(id)).all();return reply({events:events.results});
 }
 const hotels=(await db.prepare('SELECT * FROM hotels WHERE owner_id=? ORDER BY id').bind(owner.id).all()).results;
 const rooms=(await db.prepare('SELECT r.* FROM hotel_rooms r JOIN hotels h ON h.id=r.hotel_id WHERE h.owner_id=? ORDER BY r.id').bind(owner.id).all()).results;
 const bookings=(await db.prepare('SELECT b.*,p.username AS player_username FROM bookings b JOIN hotel_rooms r ON CAST(r.id AS TEXT)=b.room_id JOIN hotels h ON h.id=r.hotel_id LEFT JOIN players p ON p.id=b.player_id WHERE h.owner_id=? ORDER BY b.id DESC LIMIT 500').bind(owner.id).all()).results;
 return reply({owner,hotels,rooms,bookings});}
 const input=await body(c.request),entity=u.searchParams.get('entity'),id=u.searchParams.has('id')?integer(u.searchParams.get('id')):null;
 if(entity==='bookings'){
  if(c.request.method!=='PATCH'||!id)fail(400,'请指定预订');const record=await db.prepare('SELECT b.id FROM bookings b JOIN hotel_rooms r ON CAST(r.id AS TEXT)=b.room_id JOIN hotels h ON h.id=r.hotel_id WHERE b.id=? AND h.owner_id=?').bind(id,owner.id).first();if(!record)fail(404,'预订不存在');if(!['pending','confirmed','completed','cancelled'].includes(input.status))fail(400,'预订状态无效');await db.batch([db.prepare('UPDATE bookings SET status=? WHERE id=?').bind(input.status,id),db.prepare("UPDATE tickets SET status=CASE WHEN assignee_id IS NOT NULL AND status!='resolved' AND ?='resolved' THEN 'in_progress' ELSE ? END,updated_at=datetime('now') WHERE source_table='bookings' AND source_id=?").bind(({pending:'open',confirmed:'in_progress',completed:'resolved',cancelled:'closed'})[input.status],({pending:'open',confirmed:'in_progress',completed:'resolved',cancelled:'closed'})[input.status],id),...await linkedBusinessEvents(c,'bookings',id,input.status)]);return reply({id,updated:true});
 }
 if(!['hotels','rooms'].includes(entity))fail(400,'操作类型无效');const isRoom=entity==='rooms',table=isRoom?'hotel_rooms':'hotels';let current;
 if(id){current=await db.prepare(isRoom?'SELECT r.* FROM hotel_rooms r JOIN hotels h ON h.id=r.hotel_id WHERE r.id=? AND h.owner_id=?':'SELECT * FROM hotels WHERE id=? AND owner_id=?').bind(id,owner.id).first();if(!current)fail(404,'记录不存在');}
 if(!id&&!isRoom)fail(403,'酒店须由超管创建并分配');if(!['POST','PATCH'].includes(c.request.method))fail(405,'请使用停用功能保留历史');
 const allowed={...resources[isRoom?'hotel-rooms':'hotels'].fields};delete allowed.owner_id;const values=validated(allowed,input,!!id);
 const hotelId=isRoom?(values.hotel_id||current?.hotel_id):id;if(isRoom&&!await db.prepare('SELECT id FROM hotels WHERE id=? AND owner_id=?').bind(hotelId,owner.id).first())fail(404,'所属酒店不存在');
 const imageId=values.image_url?await validatePublicImage(c,values.image_url,{...owner,kind:'hotel_owner'}):null;
 if(!Object.keys(values).length)fail(400,'没有修改字段');if(id){const ops=[db.prepare(`UPDATE ${table} SET ${Object.keys(values).map(k=>k+'=?').join(',')},updated_at=datetime('now') WHERE id=?`).bind(...Object.values(values),id)];if(imageId)ops.push(db.prepare('UPDATE media_uploads SET public_access=1 WHERE id=?').bind(imageId));await db.batch(ops);return reply({id});}
 const insert=db.prepare(`INSERT INTO hotel_rooms(${Object.keys(values).join(',')}) VALUES(${Object.keys(values).map(()=>'?').join(',')})`).bind(...Object.values(values));const ops=[insert];if(imageId)ops.push(db.prepare('UPDATE media_uploads SET public_access=1 WHERE id=?').bind(imageId));const r=await db.batch(ops);return reply({id:r[0].meta.last_row_id},201);
});
