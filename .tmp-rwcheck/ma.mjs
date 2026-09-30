import * as o from '../functions/_core/my-affairs.oldcheck.js';
import * as n from '../functions/_core/my-affairs.js';
const diffs=[];

// 按 SQL 里出现的表名返回可控的假行
function makeDb(){
  const log=[];
  const TABLE=(sql)=>/FROM (\w+)/.exec(sql);
  class St{constructor(sql,params=[]){this.sql=sql;this.params=params;}bind(...p){return new St(this.sql,p);}
    all(){
      const m=TABLE(this.sql);
      const t=m?m[1]:'';
      log.push([this.sql,this.params]);
      let results=[];
      if(t==='tickets')results=[{id:'9',title:'T9',status:'open',admin_reply:'r1',replied_at:'2026-03-03',created_at:'2026-03-03 10:00:00'},
        {id:'7',title:'T7',status:'resolved',admin_reply:null,replied_at:null,created_at:'2026-03-03 10:00:00'},
        {id:'5',title:'T5',status:'open',admin_reply:'r5',replied_at:'2026-01-01',created_at:'2026-01-01 09:00:00'}];
      else if(t==='messages')results=[{id:'m:2',title:'M2',status:'in_progress',admin_reply:'x',replied_at:'2026-02-02',created_at:'2026-02-02 08:00:00'}];
      else if(t==='bookings')results=[{id:1,room_name:'大床房',in_date:'2026-12-31',out_date:'2027-01-02',status:'confirmed',created_at:'2026-02-02 07:00:00'},
        {id:2,room_name:null,in_date:'2020-01-01',out_date:'2020-01-02',status:'confirmed',created_at:'2026-02-02 06:00:00'},
        {id:3,room_name:'X',in_date:'2027-01-01',out_date:'2027-01-02',status:'pending',created_at:'2026-02-02 05:00:00'}];
      else if(t==='exam_sessions')results=[{id:1,grade:'A',status:'in_progress',score:55,pending_count:2,created_at:'2026-02-02 04:00:00'},{id:2,grade:'B',status:'needs_review',score:null,pending_count:1,created_at:'2026-02-01 04:00:00'}];
      else if(t==='license_signups')results=[{id:1,exam_type:'written',status:'pending',exam_date:'2026-04-01',created_at:'2026-02-02 03:00:00'}];
      else if(t==='exam_appeals')results=[{id:1,status:'submitted',created_at:'2026-02-02 02:00:00'}];
      else if(t==='support_chats')results=[{status:'active',updated_at:'2026-02-02 01:30:00'}];
      else if(t==='notification_log')results=[{n:7}];
      return Promise.resolve({results});
    }}
  return {log,prepare:sql=>new St(sql)};
}
const [a,b]=await Promise.all([o.myAffairs(makeDb(),1),n.myAffairs(makeDb(),1)]);
const sa=JSON.stringify(a), sb=JSON.stringify(b);
// as_of 是时间戳，两次调用必然不同，先抹掉再比
const strip=s=>s.replace(/"as_of":"[^"]*"/g,'"as_of":"X"');
if(strip(sa)!==strip(sb)) diffs.push('myAffairs 输出不一致:\n  old='+strip(sa)+'\n  new='+strip(sb));
if(JSON.stringify(Object.keys(a))!==JSON.stringify(Object.keys(b))) diffs.push('顶层 key 顺序不同');
if(a.items.length<5) diffs.push('假绿警告：items 太少 '+a.items.length);
console.log('items(新):',b.items.map(i=>i.kind+':'+(i.title||i.id)+' att='+i.attention).join(' | '));
console.log('unread:',a.unread_count,b.unread_count,'| limited:',a.limited,b.limited);
// SQL 也必须逐字一致
const d1=makeDb(),d2=makeDb(); await o.myAffairs(d1,42); await n.myAffairs(d2,42);
if(JSON.stringify(d1.log)!==JSON.stringify(d2.log)) diffs.push('发出的 SQL 不一致');
console.log(diffs.length?'DIFFS:\n'+diffs.join('\n'):'MY-AFFAIRS OK: 0 diffs (含 SQL 逐字比对)');
console.log('exports old:',Object.keys(o).sort().join(','),'| new:',Object.keys(n).sort().join(','));
