import {endpoint,identity,body,string,integer,reply,fail} from '../_core/request.js';
import {validId,uploadActor,ownerColumn,ownedBy,fileMetadata,ticketOwner} from '../_core/uploads.js';
import {CHUNK_SIZE,MEDIA_TYPES,fileLimit,matchesSignature,decodeBase64} from '../../shared/uploads.js';

async function owned(c,id){const file=await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(validId(id)).first();if(!file)fail(404,'附件不存在');const actor=file.owner_admin_id?{kind:'admin',user:await identity(c,'admin')}:{kind:'player',user:await identity(c)};if(!ownedBy(file,actor))fail(404,'附件不存在');return {file,actor};}
export const onRequestPost=c=>endpoint(async()=>{
 const input=await body(c.request);
 if(input.action==='finish'){
  const {file}=await owned(c,input.id);if(file.status==='ready')return reply(fileMetadata(file));
  const sum=await c.env.DB.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(byte_size),0) AS size FROM media_chunks WHERE upload_id=?').bind(file.id).first();
  if(sum.n!==file.chunk_count||sum.size!==file.size)fail(409,'上传尚未完成，请重试缺失分块');
  await c.env.DB.prepare("UPDATE media_uploads SET status='ready' WHERE id=?").bind(file.id).run();return reply(fileMetadata(file));
 }
 const actor=input.purpose==='public-image'?{kind:'admin',user:await identity(c,'super')}:await uploadActor(c);
 const purpose=input.purpose||'ticket';if(!['ticket','public-image'].includes(purpose))fail(400,'上传用途无效');
 const mime=string(input.mime,'文件类型',100);if(!MEDIA_TYPES.includes(mime)||purpose==='public-image'&&!mime.startsWith('image/'))fail(400,'请选择支持的图片或视频');
 const size=integer(input.size,'文件大小',1,fileLimit(mime));const name=string(input.name,'文件名',180).replace(/[\x00-\x1f\x7f/\\]/g,'_');
 // Bound unfinished storage; old unlinked uploads expire after a day.
 await c.env.DB.batch([
  c.env.DB.prepare("DELETE FROM media_chunks WHERE upload_id IN (SELECT u.id FROM media_uploads u WHERE u.created_at<datetime('now','-1 day') AND u.public_access=0 AND NOT EXISTS(SELECT 1 FROM ticket_attachments a WHERE a.upload_id=u.id))"),
  c.env.DB.prepare("DELETE FROM media_uploads WHERE created_at<datetime('now','-1 day') AND public_access=0 AND NOT EXISTS(SELECT 1 FROM ticket_attachments a WHERE a.upload_id=media_uploads.id)")
 ]);
 const used=await c.env.DB.prepare(`SELECT COALESCE(SUM(size),0) AS bytes FROM media_uploads u WHERE ${ownerColumn(actor)}=? AND public_access=0 AND NOT EXISTS(SELECT 1 FROM ticket_attachments a WHERE a.upload_id=u.id)`).bind(actor.user.id).first();
 if(used.bytes+size>250*1024*1024)fail(413,'未提交的附件过多，请先提交工单或移除附件');
 const id=crypto.randomUUID(),count=Math.ceil(size/CHUNK_SIZE);
 await c.env.DB.prepare(`INSERT INTO media_uploads(id,${ownerColumn(actor)},name,mime,size,chunk_count,purpose) VALUES(?,?,?,?,?,?,?)`).bind(id,actor.user.id,name,mime,size,count,purpose).run();
 return reply({id,chunk_size:CHUNK_SIZE,chunk_count:count},201);
});
export const onRequestPut=c=>endpoint(async()=>{
 const u=new URL(c.request.url),{file}=await owned(c,u.searchParams.get('id'));if(file.status!=='uploading')fail(409,'附件已经上传完成');
 const index=integer(u.searchParams.get('part'),'分块编号',0,file.chunk_count-1),input=await body(c.request);
 if(typeof input.data!=='string'||input.data.length>Math.ceil(CHUNK_SIZE/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))fail(400,'分块数据无效');
 let bytes;try{bytes=decodeBase64(input.data);}catch{fail(400,'分块编码无效');}
 const expected=Math.min(CHUNK_SIZE,file.size-index*CHUNK_SIZE);if(bytes.length!==expected)fail(400,'分块大小不正确');
 if(index===0&&!matchesSignature(bytes,file.mime))fail(400,'文件内容与图片/视频类型不匹配');
 const saved=await c.env.DB.prepare("INSERT INTO media_chunks(upload_id,part,data,byte_size) SELECT ?,?,?,? FROM media_uploads WHERE id=? AND status='uploading' ON CONFLICT(upload_id,part) DO UPDATE SET data=excluded.data,byte_size=excluded.byte_size").bind(file.id,index,input.data,bytes.length,file.id).run();
 if(!saved.meta.changes)fail(409,'上传已取消或完成');
 return reply({part:index,received:bytes.length});
});
export const onRequestGet=c=>endpoint(async()=>{
 const u=new URL(c.request.url),id=validId(u.searchParams.get('id'));const file=await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(id).first();if(!file)fail(404,'附件不存在');
 const attachment=await c.env.DB.prepare('SELECT ticket_ref FROM ticket_attachments WHERE upload_id=?').bind(id).first();
 if(!file.public_access){let actor;try{actor=file.owner_admin_id?{kind:'admin',user:await identity(c,'admin')}:{kind:'player',user:await identity(c)};}catch(e){if(e.status!==401&&e.status!==403)throw e;}if(!actor||!ownedBy(file,actor)){if(!attachment)fail(404,'附件不存在');await ticketOwner(c,attachment.ticket_ref);}}
 if(u.searchParams.get('download')!=='1'){
  const chunks=await c.env.DB.prepare('SELECT part FROM media_chunks WHERE upload_id=? ORDER BY part').bind(id).all();return reply({...fileMetadata(file),status:file.status,parts:chunks.results.map(x=>x.part),chunk_count:file.chunk_count,chunk_size:CHUNK_SIZE});
 }
 if(file.status!=='ready')fail(409,'附件尚未上传完成');
 let start=0,end=file.size-1;const range=c.request.headers.get('Range');
 if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||!match[1]&&!match[2])return new Response(null,{status:416,headers:{'Content-Range':`bytes */${file.size}`}});
  if(!match[1]){const suffix=Number(match[2]);start=Math.max(0,file.size-suffix);}else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=file.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${file.size}`}});
 }
 let part=Math.floor(start/CHUNK_SIZE);const last=Math.floor(end/CHUNK_SIZE);let buffered=[];
 const stream=new ReadableStream({async pull(controller){try{
   if(part>last){controller.close();return;}
   if(!buffered.length){const r=await c.env.DB.prepare('SELECT part,data FROM media_chunks WHERE upload_id=? AND part>=? AND part<=? ORDER BY part LIMIT 16').bind(id,part,last).all();buffered=r.results;}
   const row=buffered.shift();if(!row||row.part!==part)throw new Error('附件分块缺失');
   const bytes=decodeBase64(row.data),base=part*CHUNK_SIZE;
   controller.enqueue(bytes.slice(Math.max(0,start-base),Math.min(bytes.length,end-base+1)));part++;
 }catch(e){controller.error(e);}},cancel(){buffered=[];}});

 const headers={'Content-Type':file.mime,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':file.public_access?'public, max-age=3600':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':`${u.searchParams.get('save')==='1'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`};
 if(range)headers['Content-Range']=`bytes ${start}-${end}/${file.size}`;
 return new Response(stream,{status:range?206:200,headers});
});
export const onRequestDelete=c=>endpoint(async()=>{
 const {file}=await owned(c,new URL(c.request.url).searchParams.get('id'));if(file.public_access||await c.env.DB.prepare('SELECT upload_id FROM ticket_attachments WHERE upload_id=?').bind(file.id).first())fail(409,'已提交的附件不能从上传草稿中移除');
 await c.env.DB.batch([c.env.DB.prepare('DELETE FROM media_chunks WHERE upload_id=?').bind(file.id),c.env.DB.prepare('DELETE FROM media_uploads WHERE id=?').bind(file.id)]);return reply({deleted:true});
});
