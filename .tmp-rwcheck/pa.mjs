import * as o from '../functions/_core/personal-assistant.oldcheck.js';
import * as n from '../functions/_core/personal-assistant.js';
const diffs=[];
// as_of 是 ISO 时间戳，两次调用必然差几毫秒；created_at 用空格分隔不受影响
const N=s=>s.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g,'ISO');
function makeDb(){
  const TABLE=(sql)=>/FROM (\w+)/.exec(sql);
  class St{constructor(sql,params=[]){this.sql=sql;this.params=params;}bind(...p){return new St(this.sql,p);}
    all(){
      const t=(TABLE(this.sql)||[])[1]||'';
      let results=[];
      if(t==='tickets')results=[{id:'9',title:'T9',status:'open',admin_reply:'管理员回复内容ABC',replied_at:'2026-03-03',created_at:'2026-03-03 10:00:00'},{id:'5',title:'T5',status:'resolved',admin_reply:null,replied_at:null,created_at:'2026-01-01 09:00:00'}];
      else if(t==='messages')results=[];
      else if(t==='bookings')results=[{id:1,room_name:'大床房',in_date:'2026-12-31',out_date:'2027-01-02',status:'confirmed',created_at:'2026-02-02 07:00:00'}];
      else if(t==='exam_sessions')results=[{id:1,grade:'A',status:'in_progress',score:55,pending_count:2,created_at:'2026-02-02 04:00:00'}];
      else if(t==='license_signups')results=[{id:1,exam_type:'written',status:'pending',exam_date:'2026-04-01',created_at:'2026-02-02 03:00:00'}];
      else if(t==='exam_appeals')results=[{id:1,status:'submitted',created_at:'2026-02-02 02:00:00'}];
      else if(t==='support_chats')results=[{status:'active',updated_at:'2026-02-02 01:30:00'}];
      else if(t==='notification_log')results=[{n:7}];
      return Promise.resolve({results});
    }}
  return {prepare:sql=>new St(sql)};
}
const QUESTIONS=[
  '我的事务','我的近况如何','查看进度','待办提醒','最近事务',
  '我的工单到哪了','我的考试分数','我的成绩复核','我的酒店预订','我的驾照申请',
  '我最近的工单','本人事务','我的余额多少','我的绿宝石','我的未读通知','提醒我一下',
  '我的事务呢', '我的酒店', '我的成绩',
  '你好','酒店多少钱','施工了吗','我的','我是谁','我想订房','1',
];
const PLAYERS=[{id:1,emeralds:1000},{id:2,emeralds:0},{id:3,emeralds:12345}];
for(const q of QUESTIONS) for(const p of [null,...PLAYERS]){
  let a,b;
  try{a=N(JSON.stringify(await o.personalSources(makeDb(),p,q))).replace(/"as_of":\\"[^\\"]*\\"/g,'\"as_of\":\"X\"')}catch(e){a='E:'+e.message}
  try{b=N(JSON.stringify(await n.personalSources(makeDb(),p,q))).replace(/"as_of":\\"[^\\"]*\\"/g,'\"as_of\":\"X\"')}catch(e){b='E:'+e.message}
  if(a!==b) diffs.push(`q=${JSON.stringify(q)} p=${JSON.stringify(p)}\n  old=${a}\n  new=${b}`);
}
// 确认不是假绿：至少有一条真的返回了来源
const hit=await n.personalSources(makeDb(),PLAYERS[0],'我的事务');
if(!hit||!hit.sources||!hit.sources.length) throw new Error('假绿：新版没返回 personal 来源');
if(JSON.parse(hit.sources[0].content).recent.length<1) throw new Error('假绿：recent 为空');
console.log('命中样例 sources:',JSON.stringify(hit.sources[0]).slice(0,220));
console.log('fallback 前 120 字:',hit.fallback.slice(0,120));
console.log(diffs.length?'DIFFS:\n'+diffs.join('\n'):`PERSONAL-ASSISTANT OK: 0 diffs (${QUESTIONS.length*4} 组合)`);
console.log('exports old:',Object.keys(o).sort().join(','),'| new:',Object.keys(n).sort().join(','));
