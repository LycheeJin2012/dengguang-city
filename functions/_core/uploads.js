import { identity, integer, fail } from './request.js';
import { MAX_ATTACHMENTS, MAX_TICKET_BYTES } from '../../shared/uploads.js';
export const uploadUrl = id => '/api/uploads?id=' + encodeURIComponent(id) + '&download=1';
export function validId(value) { if(typeof value!=='string'||!/^[-a-zA-Z0-9]{20,64}$/.test(value))fail(400,'附件 ID 无效');return value; }
export async function uploadActor(c) {
  // Prefer the citizen identity in combined sessions, while keeping both owner checks available.
  try { return {kind:'player',user:await identity(c)}; }
  catch(e) { if(e.status!==401&&e.status!==403)throw e;return {kind:'admin',user:await identity(c,'admin')}; }
}
export const ownerColumn = actor => actor.kind==='admin'?'owner_admin_id':'owner_player_id';
export const ownedBy = (upload, actor) => upload[ownerColumn(actor)]===actor.user.id;
export async function ticketOwner(c, reference) {
  const legacy=String(reference).startsWith('m:');const id=integer(legacy?String(reference).slice(2):reference);
  const ticket=await c.env.DB.prepare(`SELECT id,player_id FROM ${legacy?'messages':'tickets'} WHERE id=?`).bind(id).first();
  if(!ticket)fail(404,'工单不存在');
  try { await identity(c,'admin'); }
  catch(e) { if(e.status!==401&&e.status!==403)throw e;const p=await identity(c);if(ticket.player_id!==p.id)fail(404,'工单不存在'); }
  return ticket;
}
export function fileMetadata(file) { return {id:file.id,name:file.name,mime:file.mime,size:file.size,url:uploadUrl(file.id)}; }
export async function ticketFiles(db, reference) {
  const r=await db.prepare("SELECT u.id,u.name,u.mime,u.size FROM media_uploads u JOIN ticket_attachments a ON a.upload_id=u.id WHERE a.ticket_ref=? AND u.status='ready' ORDER BY u.created_at,u.id").bind(String(reference)).all();
  return r.results.map(fileMetadata);
}
export async function validateFiles(c, ids, actor, purpose='ticket') {
  if(ids===undefined)return [];
  if(!Array.isArray(ids)||ids.length>MAX_ATTACHMENTS||new Set(ids).size!==ids.length)fail(400,`每个工单最多 ${MAX_ATTACHMENTS} 个不同附件`);
  const files=[];
  for(const id of ids){validId(id);const file=await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(id).first();
    if(!file||!ownedBy(file,actor)||file.purpose!==purpose||file.status!=='ready')fail(400,'附件尚未上传完成或不属于当前账号');
    if(purpose==='ticket'&&await c.env.DB.prepare('SELECT upload_id FROM ticket_attachments WHERE upload_id=?').bind(id).first())fail(409,'附件已关联其他工单，请重新选择文件');
    files.push(file);
  }
  if(files.reduce((sum,file)=>sum+file.size,0)>MAX_TICKET_BYTES)fail(413,'每个工单的附件合计不能超过 200 MB');
  return files;
}
export function imageUploadId(value) {
  if(typeof value!=='string'||!value.startsWith('/api/uploads?'))return null;
  const url=new URL(value,'https://local.invalid');return validId(url.searchParams.get('id'));
}
export async function validatePublicImage(c, value, admin) {
  const id=imageUploadId(value);if(!id)return null;
  const file=await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(id).first();
  if(!file||file.status!=='ready'||file.purpose!=='public-image'||!file.mime.startsWith('image/'))fail(400,'图片尚未上传完成');
  if(!file.public_access&&file.owner_admin_id!==admin.id)fail(403,'不能使用其他人的未发布图片');return id;
}
