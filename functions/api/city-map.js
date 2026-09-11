import {endpoint,identity,body,string,integer,reply,fail} from '../_core/request.js';
const fields='id,name,category,dimension,x,z,description,construction_status,construction_note,expected_end,updated_at';
export const onRequestGet=c=>endpoint(async()=>{
 const admin=new URL(c.request.url).searchParams.get('manage')==='1';if(admin)await identity(c,'super');
 return reply({places:(await c.env.DB.prepare(`SELECT ${fields}${admin?',published,revision':''} FROM city_places WHERE dimension='overworld' ${admin?'':'AND published=1'} ORDER BY id DESC LIMIT 1000`).all()).results});
});
export const onRequestPost=c=>endpoint(async()=>{
 const a=await identity(c,'super'),b=await body(c.request),db=c.env.DB;
 const id=b.id?integer(b.id):null,revision=id?integer(b.revision):null;
 const name=string(b.name,'地点名称',80),description=string(b.description||'','地点说明',2000,{required:false}),note=string(b.construction_note||'','施工说明',1500,{required:false});
 const category=b.category,dimension=b.dimension??'overworld',state=b.construction_status;
 if(!['hotel','rail','road','park','facility'].includes(category)||dimension!=='overworld'||!['open','planned','construction','closed'].includes(state))fail(400,'地点分类、维度或施工状态无效');
 if(!['string','number'].includes(typeof b.x)||!['string','number'].includes(typeof b.z)||String(b.x).trim()===''||String(b.z).trim()==='')fail(400,'坐标不能为空');
 const x=integer(b.x,'X',-30000000,30000000),z=integer(b.z,'Z',-30000000,30000000);
 const end=string(b.expected_end||'','预计恢复日期',10,{required:false});if(end&&(!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(Date.parse(end))||new Date(end).toISOString().slice(0,10)!==end))fail(400,'预计恢复日期无效');
 if(![0,1,false,true,'0','1'].includes(b.published))fail(400,'发布状态无效');const published=Number(b.published);
 const values=[name,category,dimension,x,z,description,state,note,end,published,a.id];
 const snapshot=JSON.stringify({name,category,dimension,x,z,description,construction_status:state,construction_note:note,expected_end:end,published,revision:id?revision+1:1});
 const record=()=>db.prepare("INSERT INTO audit_events(actor_type,actor_id,actor_name,admin_id,action,resource_type,resource_id,http_status,details) SELECT 'admin',?,?,?,'map.saved','city_places',COALESCE(?,CAST(last_insert_rowid() AS TEXT)),200,? WHERE changes()=1").bind(a.id,a.username,a.id,id?String(id):null,snapshot);
 if(id){const r=(await db.batch([db.prepare("UPDATE city_places SET name=?,category=?,dimension=?,x=?,z=?,description=?,construction_status=?,construction_note=?,expected_end=?,published=?,updated_by=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=?").bind(...values,id,revision),record()]))[0];if(!r.meta.changes)fail(409,'地点已被修改或不存在，请刷新后重试');return reply({id});}
 const r=(await db.batch([db.prepare('INSERT INTO city_places(name,category,dimension,x,z,description,construction_status,construction_note,expected_end,published,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(...values),record()]))[0];return reply({id:r.meta.last_row_id},201);
});
