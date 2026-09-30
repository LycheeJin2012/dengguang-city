import * as o from '../functions/_core/ticket-policy.oldcheck.js';
import * as n from '../functions/_core/ticket-policy.js';
const diffs=[];
const R=(f,...a)=>{try{return JSON.stringify(f(...a))??'undefined'}catch(e){return 'E:'+e.status+':'+e.message}};

// 1) ticketReference：纯函数，大量输入
const refs=['1','42','1000000','1000001','1000005','999999','0','-1','2.5','m:1','m:0','m:999999','m:12','m:abc','',' ','abc','1e3','1.0','9007199254740993',null,undefined,'0x10',true,'NaN'];
for(const v of refs){
  const a=R(o.ticketReference,v), b=R(n.ticketReference,v);
  if(a!==b) diffs.push(`ticketReference(${JSON.stringify(v)}): ${a} != ${b}`);
}

// 2) 录 SQL 的假 db
function makeDb(rows){
  const log=[];
  class St{constructor(sql,params=[]){this.sql=sql;this.params=params;}bind(...p){return new St(this.sql,p);}
    all(){log.push(['all',this.sql,this.params]);return Promise.resolve({results:rows||[]});}
    first(){log.push(['first',this.sql,this.params]);return Promise.resolve((rows||[])[0]??null);}
    run(){log.push(['run',this.sql,this.params]);return Promise.resolve({});}}
  return {log,prepare:sql=>new St(sql),batch:items=>{log.push(['batch',items.map(s=>[s.sql,s.params])]);return Promise.resolve([]);}};
}

// 3) resolveTarget
const inputs=[
  {}, {target_admin_id:1}, {target_admin_id:'2'},
  {target_player_id:3}, {target_player_id:'3'},
  {target_player_name:'bob'}, {target_player_name:''}, {target_player_name:'ghost'},
  {target_admin_id:1,target_player_id:3,target_player_name:'bob'},
  {target_player_id:3,target_player_name:'bob'},
];
const rowSets=[[],[{id:3,username:'carol'}],[{id:1,username:'root'}],[{id:9,username:'x'}]];
for(const inp of inputs) for(const rs of rowSets){
  const da=makeDb(rs), db=makeDb(rs);
  let a2,b2;
  o.resolveTarget(da,inp).then(v=>a2=v,e=>a2='E:'+e.status+':'+e.message);
  n.resolveTarget(db,inp).then(v=>b2=v,e=>b2='E:'+e.status+':'+e.message);
  await new Promise(r=>setTimeout(r,5));
  if(JSON.stringify(a2)!==JSON.stringify(b2)) diffs.push(`resolveTarget ${JSON.stringify(inp)} rows=${JSON.stringify(rs)}\n  old=${JSON.stringify(a2)}\n  new=${JSON.stringify(b2)}`);
  if(JSON.stringify(da.log)!==JSON.stringify(db.log)) diffs.push(`resolveTarget SQL 不同 ${JSON.stringify(inp)} rows=${JSON.stringify(rs)}\n  ${JSON.stringify(da.log)}\n  ${JSON.stringify(db.log)}`);
}

// 4) conflicts
const tickets=[{target_admin_id:1,target_player_id:2,player_id:3},{target_admin_id:null,target_player_id:null,player_id:3},{target_admin_id:1,target_player_id:2,player_id:3}];
const admins=[{id:1,linked_player_id:2},{id:1,linked_player_id:null},{id:9,linked_player_id:2},{id:9,linked_player_id:0},{id:null,linked_player_id:2}];
for(const t of tickets) for(const a of admins){
  if(R(o.conflicts,t,a)!==R(n.conflicts,t,a)) diffs.push(`conflicts ${JSON.stringify(t)} ${JSON.stringify(a)}`);
}

// 5) assignmentCandidate
for(const t of tickets) for(const a of [{id:1,username:'a',role:'super',linked_player_id:2},{id:1,username:'a',role:'admin',linked_player_id:null},{id:5,username:'b',role:'admin',linked_player_id:null}]) for(const id of ['1','5','9','abc']){
  const da=makeDb([a]), db=makeDb([a]);
  let a2,b2;
  await o.assignmentCandidate(da,t,id).then(v=>a2=v,e=>a2='E:'+e.status+':'+e.message);
  await n.assignmentCandidate(db,t,id).then(v=>b2=v,e=>b2='E:'+e.status+':'+e.message);
  if(JSON.stringify(a2)!==JSON.stringify(b2)) diffs.push(`assignmentCandidate ${JSON.stringify(t)} admin=${a.id}/${a.role} id=${id}: ${JSON.stringify(a2)} != ${JSON.stringify(b2)}`);
  if(JSON.stringify(da.log)!==JSON.stringify(db.log)) diffs.push(`assignmentCandidate SQL 不同`);
}

// 6) ticketEvent / rewardOperations / claimPendingRewards
const da=makeDb(), db=makeDb();
const evA=o.ticketEvent(da,'m:1',{type:'admin',id:1,name:'x'},'act',{k:1});
const evB=n.ticketEvent(db,'m:1',{type:'admin',id:1,name:'x'},'act',{k:1});
if(JSON.stringify([evA.sql,evA.params])!==JSON.stringify([evB.sql,evB.params])) diffs.push('ticketEvent 不同');

for(const admin of [{id:1,linked_player_id:2,username:'wzc',status:'active'},{id:1,linked_player_id:null,username:'wzc',status:undefined},{id:1,linked_player_id:2,username:null,status:null},null,undefined]){
  const da2=makeDb(admin?[admin]:[]), db2=makeDb(admin?[admin]:[]);
  const a=await o.rewardOperations(da2,'m:1',1), b=await n.rewardOperations(db2,'m:1',1);
  if(JSON.stringify(a)!==JSON.stringify(b)) diffs.push(`rewardOperations admin=${JSON.stringify(admin)}\n  old=${JSON.stringify(a)}\n  new=${JSON.stringify(b)}`);
}
const d1=makeDb(),d2=makeDb();
const a=await o.rewardOperations(d1,'m:1',1), b=await n.rewardOperations(d2,'m:1',1);
if(a.operations.length!==3) throw new Error('假绿：rewardOperations 没产出 3 条操作');
if(d1.log.length!==1||d1.log[0][0]!=='first') throw new Error('假绿：rewardOperations 应只查一次管理员，实得 '+JSON.stringify(d1.log));
if(JSON.stringify(d1.log)!==JSON.stringify(d2.log)) throw new Error('rewardOperations 查询不同');

for(const rows of [[{ticket_ref:'m:1'},{ticket_ref:'m:2'}],[{ticket_ref:'m:9'}],[]]){
  const d3=makeDb(rows), d4=makeDb(rows); d3.log.length=0; d4.log.length=0;
  await o.claimPendingRewards(d3,1,2); await n.claimPendingRewards(d4,1,2);
  if(JSON.stringify(d3.log)!==JSON.stringify(d4.log)) diffs.push(`claimPendingRewards 不同 rows=${rows.length}\n  ${JSON.stringify(d3.log)}\n  ${JSON.stringify(d4.log)}`);
}

// 7) linkedBusinessEvents
for(const cAudit of [undefined,{actor:{type:'admin',id:1,name:'n'}},{}]) for(const rows of [[{id:5}],[],[{id:7},{id:8}]]){
  const mk=()=>({env:{DB:makeDb(rows)},audit:cAudit});
  const a=await o.linkedBusinessEvents(mk(),'bookings',5,'confirmed');
  const b=await n.linkedBusinessEvents(mk(),'bookings',5,'confirmed');
  const norm=x=>JSON.stringify(x.map(s=>[s.sql,s.params]));
  if(norm(a)!==norm(b)) diffs.push(`linkedBusinessEvents audit=${JSON.stringify(cAudit)} rows=${rows.length}\n  ${norm(a)}\n  ${norm(b)}`);
}
console.log(diffs.length?'DIFFS:\n'+diffs.slice(0,12).join('\n'):'TICKET-POLICY OK: 0 diffs (refs/resolveTarget/conflicts/assignmentCandidate/ticketEvent/rewardOperations/claimPendingRewards/linkedBusinessEvents)');
console.log('exports old:',Object.keys(o).sort().join(','),'| new:',Object.keys(n).sort().join(','));
