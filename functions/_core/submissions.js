import {autoDispatchSafely} from './dispatch.js';
import {linkedBusinessEvents} from './ticket-policy.js';
import {
  endpoint,identity,body,string,integer,fail,reply
}
from './request.js';
const tables={
  kart:'kart_signups',circuit:'circuit_signups',license:'license_signups',bookings:'bookings'
}
;
const category={
  kart:'kart',circuit:'race',license:'license',bookings:'hotel'
}
;
function date(value,key){
  const s=string(value,key,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(+new Date(s))||new Date(s).toISOString().slice(0,10)!==s)fail(400,`${key} 日期无效`);
  return s;
}
export function submissions(kind){
  return c=>endpoint(async()=>{
    const p=await identity(c),{
      env,request
    }
    =c,table=tables[kind];if(request.method==='GET'){
      const rows=await env.DB.prepare(`SELECT * FROM ${table} WHERE player_id=? ORDER BY id DESC LIMIT 100`).bind(p.id).all();return reply({
        [kind==='bookings'?'bookings':'signups']:rows.results
      }
      );
    }
    if(request.method!=='POST')fail(405,'不支持此方法');const b=await body(request),v={
      player_id:p.id
    }
    ,label=kind==='bookings'?'酒店预订':kind==='license'?'驾照报名':kind==='circuit'?'国际试车':'卡丁车报名'; v.contact=string(b.contact,'联系方式',200);v.note=string(b.note??'','备注',1000,{
      required:false
    }
    );v.name=p.username;let cost=0; if(kind==='bookings'){
      v.room_id=integer(b.room_id,'房型 ID');const r=await env.DB.prepare('SELECT r.*,h.is_active AS hotel_active FROM hotel_rooms r JOIN hotels h ON h.id=r.hotel_id WHERE r.id=?').bind(v.room_id).first();if(!r)fail(404,'房型不存在');if(!r.is_active||!r.hotel_active)fail(400,'房型暂未开放');v.room_name=r.name;v.in_date=date(b.in_date,'入住');v.out_date=date(b.out_date,'退房');v.nights=(new Date(v.out_date)-new Date(v.in_date))/86400000;if(v.nights<1||v.nights>365)fail(400,'入住时长必须为 1–365 晚');const today=new Intl.DateTimeFormat('sv-SE',{
        timeZone:'Asia/Shanghai'
      }
      ).format(new Date());if(v.in_date<today)fail(400,'不能预订过去的日期');v.persons=integer(b.persons??1,'人数',1,Math.min(6,r.capacity));v.breakfast=r.breakfast_included?1:b.breakfast?1:0;
    }
    else if(kind==='license'){
      if(!['written','road','upgrade'].includes(b.exam_type))fail(400,'考试类型无效');v.exam_type=b.exam_type;v.exam_date=b.exam_date?date(b.exam_date,'考试'):null;v.exam_session=string(b.exam_session??'','场次',100,{
        required:false
      }
      ); if(await env.DB.prepare("SELECT id FROM license_signups WHERE player_id=? AND exam_type=? AND status='pending'").bind(p.id,v.exam_type).first())fail(409,'你已有待审核的同类型报名');
    }
    else{
      v.session=string(b.session??'','场次',100,{
        required:false
      }
      );v.car=string(b.car??'','车型',100,{
        required:false
      }
      ); if(kind==='circuit'){
        v.track_id=integer(b.track_id,'赛道');const t=await env.DB.prepare('SELECT * FROM race_tracks WHERE id=? AND is_active=1').bind(v.track_id).first();if(!t)fail(404,'赛道不存在或未开放');if(!['B','A','S'].includes(b.license))fail(400,'驾照等级无效');v.license=b.license;cost=integer(t.trial_price,'试车价格',0);v.emeralds_charged=cost;
      }
    }
    const keys=Object.keys(v),vals=Object.values(v),statements=[];if(kind==='circuit')statements.push(env.DB.prepare('UPDATE players SET emeralds=emeralds-? WHERE id=? AND emeralds>=?').bind(cost,p.id,cost)); statements.push(env.DB.prepare(`INSERT INTO ${table}(${keys.join(',')}) ${kind==='circuit'?'SELECT '+keys.map(()=>'?').join(',')+' WHERE changes()=1':kind==='license'?'SELECT '+keys.map(()=>'?').join(',')+" WHERE NOT EXISTS(SELECT 1 FROM license_signups WHERE player_id=? AND exam_type=? AND status='pending')":'VALUES('+keys.map(()=>'?').join(',')+')'}`).bind(...vals,...(kind==='license'?[p.id,v.exam_type]:[]))); statements.push(env.DB.prepare(`INSERT INTO tickets(player_id,category,source_table,source_id,title,body) SELECT ?,?,?,last_insert_rowid(),?,? WHERE changes()=1`).bind(p.id,category[kind],table,label+(v.room_name?' · '+v.room_name:''),JSON.stringify(v))); const result=await env.DB.batch(statements);if(kind==='circuit'&&!result[0].meta.changes)fail(402,'绿宝石余额不足');const primary=result[kind==='circuit'?1:0];if(!primary.meta.changes)fail(409,'你已有待审核的同类型报名');const dispatch=await autoDispatchSafely(c,result.at(-1).meta.last_row_id);return reply({dispatch:{status:dispatch.status},
      id:primary.meta.last_row_id,nights:v.nights,emeralds_charged:cost,status:'pending'
    }
    ,201);
  }
  );
}
export function adminSubmissions(kind){
  return c=>endpoint(async()=>{
    await identity(c,'admin');const {
      env,request
    }
    =c,table=tables[kind],url=new URL(request.url);if(request.method==='GET'){
      const rows=await env.DB.prepare(`SELECT b.*,p.username AS player_username FROM ${table} b LEFT JOIN players p ON p.id=b.player_id ORDER BY b.id DESC LIMIT 500`).all();return reply({
        [kind==='bookings'?'bookings':'signups']:rows.results
      }
      );
    }
    const id=integer(url.searchParams.get('id'));const row=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();if(!row)fail(404,'记录不存在');if(request.method==='DELETE')fail(409,'请更新状态以保留历史记录');if(request.method!=='PATCH')fail(405,'不支持此方法');const b=await body(request),s=b.status||url.searchParams.get('status');const states=kind==='bookings'?['pending','confirmed','completed','cancelled']:kind==='license'?['pending','passed','failed']:['pending','approved','rejected'];if(!states.includes(s))fail(400,'状态无效');const ticketStatus=s==='pending'?'open':['rejected','failed','cancelled'].includes(s)?'closed':s==='confirmed'||s==='approved'?'in_progress':'resolved'; await env.DB.batch([env.DB.prepare(`UPDATE ${table} SET status=? WHERE id=?`).bind(s,id),env.DB.prepare("UPDATE tickets SET status=CASE WHEN assignee_id IS NOT NULL AND status!='resolved' AND ?='resolved' THEN 'in_progress' ELSE ? END,updated_at=datetime('now') WHERE source_table=? AND source_id=?").bind(ticketStatus,ticketStatus,table,id),...await linkedBusinessEvents(c,table,id,s)]);return reply({
      id,status:s
    }
    );
  }
  );
}
