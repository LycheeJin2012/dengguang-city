import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,dispatch} from './local-d1.mjs';
import {ensureDatabase} from '../functions/_core/database.js';
import {CHUNK_SIZE,IMAGE_LIMIT,VIDEO_LIMIT} from '../shared/uploads.js';
import {navigationFor,resolveNavigation} from '../js/app/admin-navigation.js';
const DB=database(),env={DB};const alice='lc_session=media-alice',bob='lc_session=media-bob',admin='lc_session=media-admin',combined='lc_session=media-combined';
before(async()=>{await ensureDatabase(DB);await DB.prepare("INSERT INTO admins(id,username,password_hash,salt,role) VALUES(1,'admin','x','x','super')").run();for(const [id,name] of [[1,'alice'],[2,'bob']])await DB.prepare("INSERT INTO players(id,username,email,password_hash,salt,status) VALUES(?,?,?,'x','x','active')").bind(id,name,name+'@example.invalid').run();for(const [token,p,a] of [['media-alice',1,null],['media-bob',2,null],['media-admin',null,1],['media-combined',1,1]])await DB.prepare("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES(?,?,?,'2099-01-01T00:00:00Z')").bind(token,p,a).run();});
after(()=>DB.close());
async function request(path,method='GET',body,cookie=alice,headers={}){return dispatch(new Request('https://local.test/api/'+path,{method,headers:{...headers,...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env);}
async function json(path,method='GET',body,cookie=alice){const r=await request(path,method,body,cookie);return {status:r.status,...await r.json()};}
const png=size=>{const data=Buffer.alloc(size,47);Buffer.from([137,80,78,71,13,10,26,10]).copy(data);return data;};
async function upload(data,{mime='image/png',purpose='ticket',cookie=alice}={}){
 const start=await json('uploads','POST',{name:'fixture.'+(mime.startsWith('video/')?'mp4':'png'),mime,size:data.length,purpose},cookie);assert.equal(start.status,201);
 for(let i=0;i<start.chunk_count;i++){const r=await json(`uploads?id=${start.id}&part=${i}`,'PUT',{data:data.subarray(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE).toString('base64')},cookie);assert.equal(r.status,200,JSON.stringify(r));}
 const finished=await json('uploads','POST',{action:'finish',id:start.id},cookie);assert.equal(finished.status,200);return finished;
}
let large;
test('grouped primary navigation starts with tickets and dispatch and retains every authorized child',()=>{const all=navigationFor(true);assert.deepEqual(all.slice(0,2).map(g=>g.id),['tickets','dispatch']);assert.equal(all.length,8);assert.equal(new Set(all.flatMap(g=>g.children)).size,18);assert.equal(resolveNavigation('rooms',true).group.id,'hotel-business');assert.equal(resolveNavigation('tracks',false).child,'tickets');assert.ok(!navigationFor(false).flatMap(g=>g.children).includes('admins'));});
test('images larger than 1 MB upload in chunks and download byte-for-byte with range support',async()=>{
 const data=png(2*1024*1024+17);large=await upload(data);
 const r=await request(`uploads?id=${large.id}&download=1`);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),data);
 const ranged=await request(`uploads?id=${large.id}&download=1`,'GET',undefined,alice,{Range:'bytes=262130-262180'});assert.equal(ranged.status,206);assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),data.subarray(262130,262181));
 assert.equal((await request(`uploads?id=${large.id}&download=1`,'GET',undefined,alice,{Range:'bytes=9999999-'})).status,416);
});
test('draft attachments cannot be read by another citizen or anonymously',async()=>{assert.equal((await request(`uploads?id=${large.id}&download=1`,'GET',undefined,bob)).status,404);assert.equal((await request(`uploads?id=${large.id}&download=1`,'GET',undefined,null)).status,404);});
test('incomplete, unsupported, oversized and signature-mismatched uploads are rejected',async()=>{
 assert.equal((await json('uploads','POST',{name:'x.png',mime:'image/png',size:IMAGE_LIMIT+1})).status,400);
 assert.equal((await json('uploads','POST',{name:'x.mp4',mime:'video/mp4',size:VIDEO_LIMIT+1})).status,400);
 assert.equal((await json('uploads','POST',{name:'x.svg',mime:'image/svg+xml',size:10})).status,400);
 const d=await json('uploads','POST',{name:'bad.png',mime:'image/png',size:20});assert.equal((await json('uploads','POST',{action:'finish',id:d.id})).status,409);
 assert.equal((await json(`uploads?id=${d.id}&part=0`,'PUT',{data:Buffer.alloc(20).toString('base64')})).status,400);
 assert.equal((await json('uploads?id='+d.id,'DELETE')).status,200);
});
let ticket;
test('multiple attachments atomically link to the new ticket, remain private and can be viewed by admins',async()=>{
 const second=await upload(png(64));const t=await json('tickets','POST',{kind:'bug',title:'附件测试',body:'本地 SQL 测试',attachment_ids:[large.id,second.id]});assert.equal(t.status,201);ticket=t.id;
 const own=await json(`tickets?my=1&id=${ticket}`);assert.equal(own.ticket.attachments.length,2);assert.equal(own.ticket.attachment_count,2);
 const links=(await DB.prepare('SELECT ticket_ref FROM ticket_attachments ORDER BY upload_id').all()).results;assert.ok(links.every(x=>x.ticket_ref===String(ticket)));
 assert.equal((await request(`uploads?id=${large.id}&download=1`,'GET',undefined,admin)).status,200);
 assert.equal((await request(`uploads?id=${large.id}&download=1`,'GET',undefined,bob)).status,404);
 assert.equal((await json('uploads?id='+large.id,'DELETE')).status,409);
});
test('cross-account attachment injection and duplicate reuse are rejected without creating tickets',async()=>{
 const before=(await DB.prepare('SELECT COUNT(*) AS n FROM tickets').first()).n;
 assert.equal((await json('tickets','POST',{title:'非法',body:'测试',attachment_ids:[large.id]},bob)).status,400);
 assert.equal((await json('tickets','POST',{title:'重复',body:'测试',attachment_ids:[large.id]})).status,409);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM tickets').first()).n,before);
});
test('supplementing evidence preserves ticket content and enforces a five-file limit',async()=>{
 const extras=[];for(let i=0;i<4;i++)extras.push(await upload(png(64)));
 assert.equal((await json('ticket-attachments','POST',{ticket_id:ticket,attachment_ids:extras.slice(0,3).map(x=>x.id)})).status,200);
 assert.equal((await json('ticket-attachments','POST',{ticket_id:ticket,attachment_ids:[extras[3].id]})).status,400);
 assert.equal((await json(`tickets?my=1&id=${ticket}`)).ticket.attachments.length,5);
 assert.equal((await json('ticket-attachments','POST',{ticket_id:ticket,attachment_ids:[extras[3].id]},bob)).status,404);
});
test('CMS images support combined admin sessions and become public only after saving content',async()=>{
 const image=await upload(png(128),{purpose:'public-image',cookie:combined});
 assert.equal((await request(`uploads?id=${image.id}&download=1`,'GET',undefined,null)).status,404);
 const saved=await json('admin/gallery','POST',{num:99,title:'本地图片',image_url:image.url},admin);assert.equal(saved.status,201,JSON.stringify(saved));
 const publicFile=await request(`uploads?id=${image.id}&download=1`,'GET',undefined,null);assert.equal(publicFile.status,200);assert.equal((await publicFile.arrayBuffer()).byteLength,128);
 assert.equal((await json('uploads','POST',{name:'x.png',size:100,mime:'image/png',purpose:'public-image'})).status,403);
});
test('legacy ticket assignment persists and unassigned/mine filters reflect changes',async()=>{
 await DB.prepare("INSERT INTO messages(id,player_id,name,contact,type,content) VALUES(99,1,'alice','test','建议','旧工单派单')").run();
 assert.equal((await json('tickets?id=m:99','PATCH',{assignee_id:1},admin)).status,200);
 const mine=await json('tickets?assignment=mine','GET',undefined,admin);assert.ok(mine.tickets.some(t=>t.id==='m:99'));
 const unassigned=await json('tickets?assignment=unassigned','GET',undefined,admin);assert.ok(!unassigned.tickets.some(t=>t.id==='m:99'));
 assert.equal((await json('tickets?id=m:99','PATCH',{assignee_id:null},admin)).status,200);
 assert.equal((await DB.prepare('SELECT assignee_id FROM messages WHERE id=99').first()).assignee_id,null);
});
test('video uploads are served as authenticated range streams',async()=>{
 const data=Buffer.alloc(3*1024*1024+7,0);Buffer.from('000000186674797069736f6d0000020069736f6d','hex').copy(data);
 const file=await upload(data,{mime:'video/mp4'});const r=await request(`uploads?id=${file.id}&download=1`,'GET',undefined,alice,{Range:'bytes=-1024'});
 assert.equal(r.status,206);assert.equal(r.headers.get('Content-Type'),'video/mp4');assert.deepEqual(Buffer.from(await r.arrayBuffer()),data.subarray(data.length-1024));
});

test('the full 100 MB video boundary uploads and streams without assembling the response in memory',async()=>{
 const {createHash}=await import('node:crypto');
 const data=Buffer.alloc(VIDEO_LIMIT,0);Buffer.from('000000186674797069736f6d0000020069736f6d','hex').copy(data);
 const expected=createHash('sha256').update(data).digest('hex');const file=await upload(data,{mime:'video/mp4'});
 const response=await request(`uploads?id=${file.id}&download=1`);assert.equal(response.status,200);const hash=createHash('sha256'),reader=response.body.getReader();let total=0;
 while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;hash.update(value);}
 assert.equal(total,VIDEO_LIMIT);assert.equal(hash.digest('hex'),expected);assert.equal((await json('uploads?id='+file.id,'DELETE')).status,200);
});
