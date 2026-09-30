import * as o from '../functions/_core/triage.oldcheck.js';
import * as n from '../functions/_core/triage.js';
const diffs=[];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scrub=v=>Array.isArray(v)?v.map(scrub):(typeof v==='string'&&UUID.test(v)?'TOKEN':v);

// 假 db：ticket → previous → batch 记录
function makeDb(ticket,previous){
  const log=[];let step=0;
  class St{constructor(sql,params=[]){this.sql=sql;this.params=params;}bind(...p){return new St(this.sql,p);}
    all(){return Promise.resolve({results:[]});}
    first(){const v=step++===0?ticket:previous;log.push(['first',this.sql,scrub(this.params)]);return Promise.resolve(v??null);}
    run(){return Promise.resolve({});}}
  return {log,prepare:sql=>new St(sql),batch:items=>{log.push(['batch',items.map(s=>[s.sql,scrub(s.params)])]);return Promise.resolve([]);}};
}

const TICKETS=[
  {id:1,title:'普通咨询',body:'请问怎么去银行',priority:'normal'},
  {id:2,name:'无title',content:'服务器崩溃了数据丢失',priority:'low'},
  {id:3,title:'复杂问题',body:'涉及多个系统 需要跨部门协调',priority:'high'},
  {id:4,title:'大面积施工',body:'大面积施工',priority:null},
  {id:5,title:'正在破坏',body:'有人正在破坏建筑',priority:'urgent'},
  {id:6,title:'空',body:null,content:null,priority:'normal'},
  {id:7,title:'有换行',body:'第一行\n第二行',priority:'normal'},
];
const PREVIOUS=[undefined,null,{manual:1},{manual:0,priority:'urgent',complexity:'complex'},{manual:0,priority:'low',complexity:'simple'},{manual:0,priority:'normal'},{manual:0,complexity:'complex'}];
const IDS=['1','2','5','m:1','m:9','1000001'];

// ---- 无模型：纯规则路径 ----
for(const t of TICKETS) for(const prev of PREVIOUS) for(const id of IDS){
  const da=makeDb(t,prev), db=makeDb(t,prev);
  const c1={env:{DB:da},audit:undefined}, c2={env:{DB:db},audit:undefined};
  await o.triageTicket(c1,id); await n.triageTicket(c2,id);
  if(JSON.stringify(da.log)!==JSON.stringify(db.log)) diffs.push(`triage 无模型 t=${JSON.stringify(t)} prev=${JSON.stringify(prev)} id=${id}\n  old=${JSON.stringify(da.log)}\n  new=${JSON.stringify(db.log)}`);
}
// c.audit.base 优先于 c.env.DB
for(const id of IDS){
  const base1=makeDb(TICKETS[0],null), env1=makeDb(TICKETS[0],null);
  await o.triageTicket({env:{DB:env1},audit:{base:base1}},id);
  const base2=makeDb(TICKETS[0],null), env2=makeDb(TICKETS[0],null);
  await n.triageTicket({env:{DB:env2},audit:{base:base2}},id);
  if(JSON.stringify(base1.log)!==JSON.stringify(base2.log)) diffs.push(`audit.base 路径不同 ${id}`);
  if(env1.log.length||env2.log.length) diffs.push('audit.base 存在时不该碰 env.DB');
}

// ---- 有模型：桩掉 fetch，覆盖成功/非2xx/非法JSON/字段非法/超时 ----
const AI_REPLIES=[
  {ok:true,content:'{"priority":"urgent","urgency":"emergency","complexity":"complex","reason":"像是在说服务器炸了"}'},
  {ok:true,content:'```json\n{"priority":"low","urgency":"routine","complexity":"simple","reason":"小事"}\n```'},
  {ok:true,content:'{"priority":"高","urgency":"emergency","complexity":"complex","reason":"x"}'},
  {ok:true,content:'{"priority":"high","urgency":"nope","complexity":"simple","reason":"x"}'},
  {ok:true,content:'{"priority":"high","urgency":"emergency","complexity":"simple","reason":"   "}'},
  {ok:true,content:'not json at all'},
  {ok:true,content:JSON.stringify({priority:'high',urgency:'time_sensitive',complexity:'simple',reason:'R'.repeat(600)})},
  {ok:true,content:JSON.stringify({priority:'high',urgency:'time_sensitive',complexity:'simple',reason:'R',extra:'透传字段'})},
  {ok:false},
  {ok:true,noChoices:true},
  {throw:true},
];
const realFetch=globalThis.fetch;
for(const ai of AI_REPLIES) for(const t of TICKETS) for(const prev of PREVIOUS.slice(0,4)) for(const model of [undefined,'gpt-4o']){
  globalThis.fetch=async()=>{ if(ai.throw) throw new Error('net down');
    const r={ok:ai.ok,json:async()=>ai.noChoices?{}:{choices:[{message:{content:ai.content}}]}};
    return r; };
  const da=makeDb(t,prev), db=makeDb(t,prev);
  await o.triageTicket({env:{DB:da,OPENAI_API_KEY:'k',OPENAI_MODEL:model}},'1');
  await n.triageTicket({env:{DB:db,OPENAI_API_KEY:'k',OPENAI_MODEL:model}},'1');
  if(JSON.stringify(da.log)!==JSON.stringify(db.log)) diffs.push(`triage AI ai=${JSON.stringify(ai).slice(0,70)} t=${JSON.stringify(t)} prev=${JSON.stringify(prev)}\n  old=${JSON.stringify(da.log)}\n  new=${JSON.stringify(db.log)}`);
}
globalThis.fetch=realFetch;

// ---- manualTriage ----
for(const ref of ['1','m:1']) for(const p of ['low','normal','high','urgent','weird']) for(const admin of [{id:1},{id:null}]){
  const da=makeDb(), db=makeDb();
  const a=o.manualTriage(da,ref,p,admin), b=n.manualTriage(db,ref,p,admin);
  if(a.sql!==b.sql||JSON.stringify(scrub(a.params))!==JSON.stringify(scrub(b.params))) diffs.push(`manualTriage ${ref} ${p}\n  old=${a.sql} ${JSON.stringify(a.params)}\n  new=${b.sql} ${JSON.stringify(b.params)}`);
}
// 至少要真的产出 batch（防假绿）：新工单 4 条（分级+回写+事件+审计），旧工单少一条回写
const probe=makeDb(TICKETS[0],null);
await n.triageTicket({env:{DB:probe}},'1');
const batch=probe.log.find(l=>l[0]==='batch');
if(!batch||batch[1].length!==4) throw new Error('假绿：新工单应产出 4 条 batch 语句，实得 '+JSON.stringify(batch&&batch[1].length));
const probeL=makeDb({...TICKETS[0],id:1},null);
await n.triageTicket({env:{DB:probeL}},'m:1');
const batchL=probeL.log.find(l=>l[0]==='batch');
if(!batchL||batchL[1].length!==3) throw new Error('假绿：旧工单应产出 3 条 batch 语句，实得 '+JSON.stringify(batchL&&batchL[1].length));
console.log('新版 batch 语句数: 新工单='+batch[1].length+' 旧工单='+batchL[1].length);
console.log('  新工单:',batch[1].map(s=>s[0].slice(0,30)).join(' / '));
console.log(diffs.length?'DIFFS:\n'+diffs.slice(0,6).join('\n'):'TRIAGE OK: 0 diffs (规则路径 / audit.base / 11 种 AI 响应 / manualTriage)');
console.log('exports old:',Object.keys(o).sort().join(','),'| new:',Object.keys(n).sort().join(','));
