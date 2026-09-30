import * as o from '../functions/_core/exam-session.oldcheck.js';
import * as n from '../functions/_core/exam-session.js';
const diffs=[];

// 固定 crypto：randomUUID 与 getRandomValues 都要可复现，否则洗牌/UUID 永远对不上
const realCrypto=globalThis.crypto;
let uuid=0, rnd=7;
const stubCrypto={...realCrypto,
  randomUUID:()=>`U${String(++uuid).padStart(4,'0')}`,
  getRandomValues:(arr)=>{arr[0]=rnd;rnd=(rnd*1103515245+12345)>>>0;return arr;}};
Object.defineProperty(globalThis,'crypto',{value:stubCrypto,configurable:true});
function reset(){uuid=0;rnd=7;}

const SOURCES=[{id:'knowledge:1',title:'K',content:'c'},{id:'rules:2',title:'R',content:'c'}];
const R=(f,...a)=>{try{return JSON.stringify(f(...a))??'undefined'}catch(e){return 'E:'+(e.status??'')+':'+e.message}};

// ---- FEEDBACK ----
if(JSON.stringify(o.FEEDBACK)!==JSON.stringify(n.FEEDBACK)) diffs.push('FEEDBACK 不同');
// ---- totals ----
const RES=[[{status:'graded',score:20},{status:'pending_review',score:null},{status:'graded',score:0}],
  [{status:'graded',score:20},{status:'graded',score:20}],[],
  [{status:'pending_review',score:5}],[{status:'graded',score:null}]];
for(const r of RES) if(R(o.totals,r)!==R(n.totals,r)) diffs.push(`totals ${JSON.stringify(r)}`);

// ---- event ----
for(const actor of [{type:'player',id:1,name:'a'},{type:'admin',id:null,name:'b'},{}]) for(const d of [{x:1},{},undefined,null]){
  const a=o.event({prepare:s=>({bind:(...p)=>({sql:s,params:p})})},'s1',actor,'act',d);
  const b=n.event({prepare:s=>({bind:(...p)=>({sql:s,params:p})})},'s1',actor,'act',d);
  if(JSON.stringify([a.sql,a.params])!==JSON.stringify([b.sql,b.params])) diffs.push(`event ${JSON.stringify(actor)} ${JSON.stringify(d)}\n  ${a.params}\n  ${b.params}`);
}

// ---- examSources：三级降级 + 空库 503 ----
function makeDb(tiers){
  const log=[];
  class St{constructor(sql,p=[]){this.sql=sql;this.p=p;}bind(...p){return new St(this.sql,p);}
    all(){log.push([this.sql,this.p]);
      const t=/knowledge_articles/.test(this.sql)?'k':/license_requirements/.test(this.sql)?'r':/exam_questions/.test(this.sql)?'q':'?';
      return Promise.resolve({results:tiers[t]||[]});}}
  return {log,prepare:s=>new St(s)};
}
const T1=[{id:1,revision:2,title:'T',question:'Q',answer:'A',source_kind:'manual'},{id:2,revision:1,title:'T2',question:'Q',answer:'A',source_kind:'manual'}];
const T2=[{id:5,title:'规则',description:'D',requirements:'R'},{id:6,title:'空',description:null,requirements:null}];
const T3=[{id:7,grade:'A',question:'q',options:[],answer:'a',explanation:'e'},{id:8,grade:'A',question:'q',options:[],answer:'a',explanation:'  '}];
const TIERSETS=[{k:T1,r:[],q:[]},{k:[],r:T2,q:[]},{k:[],r:[],q:T3},{k:[],r:[],q:[]},{k:T1,r:T2,q:T3},{k:[],r:[{id:5,title:'x',description:null,requirements:null}],q:[]}];
for(const ts of TIERSETS){
  const da=makeDb(ts),db=makeDb(ts);
  let a,b; try{a=JSON.stringify(await o.examSources(da))}catch(e){a='E:'+e.status+':'+e.message}
  try{b=JSON.stringify(await n.examSources(db))}catch(e){b='E:'+e.status+':'+e.message}
  if(a!==b) diffs.push(`examSources ${JSON.stringify(Object.keys(ts))}\n  old=${a}\n  new=${b}`);
  if(JSON.stringify(da.log)!==JSON.stringify(db.log)) diffs.push('examSources SQL 不同');
}

// ---- validatePaper ----
const mkQ=(type,i,extra={})=>({type,prompt:'题干'+i,source_ids:['knowledge:1'],...extra});
const GOOD=[mkQ('choice',0,{options:['a','b','c'],correct_indexes:[0]}),mkQ('choice',1,{options:['a','b','c'],correct_indexes:[1]}),
  mkQ('multi',2,{options:['a','b','c','d'],correct_indexes:[0,1]}),mkQ('short',3,{rubric:[{criterion:'c1',points:10},{criterion:'c2',points:10}]}),
  mkQ('short',4,{rubric:[{criterion:'c1',points:5},{criterion:'c2',points:7},{criterion:'c3',points:8}]})];
const PAPERS=[{questions:GOOD},{questions:null},{questions:[]},{questions:GOOD.slice(0,4)},{questions:[...GOOD,GOOD[0]]},
  {questions:GOOD.map((q,i)=>i===0?{...q,prompt:'题干1'}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,prompt:'参考答案在此'}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,prompt:'答案：x'}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,type:'weird'}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,source_ids:[]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,source_ids:['nope']}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,options:['a','a','b'],correct_indexes:[0]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,options:['a','b'],correct_indexes:[0]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,options:['a','b','c'],correct_indexes:[0,1]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,options:['a','b','c','d'],correct_indexes:[0,1,2,3]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,correct_indexes:[0,0]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,correct_indexes:[9]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,rubric:[{criterion:'c',points:20}]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,rubric:[{criterion:'c',points:10},{criterion:'d',points:5}]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,rubric:[{criterion:'c',points:0},{criterion:'d',points:20}]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,rubric:[{criterion:'c',points:21},{criterion:'d',points:-1}]}:q)},
  {questions:GOOD.map((q,i)=>i===0?{...q,rubric:null}:q)},
  null,undefined,{},'x',
  {questions:GOOD.map((q,i)=>i===0?null:q)},
  {questions:GOOD.map((q,i)=>i===3?mkQ('short',3,{rubric:[{criterion:'c',points:10},{criterion:'d',points:10}]}):mkQ('short',i,{rubric:[{criterion:'c1',points:10},{criterion:'c2',points:10}]}))},
];
let valid=0;
for(const p of PAPERS){
  reset(); const a=R(o.validatePaper,p,SOURCES);
  reset(); const b=R(n.validatePaper,p,SOURCES);
  if(!a.startsWith('E:')) valid++;
  if(a!==b) diffs.push(`validatePaper[${JSON.stringify(p).slice(0,90)}]\n  old=${a.slice(0,300)}\n  new=${b.slice(0,300)}`);
}
if(valid<1) throw new Error('假绿：validatePaper 没有任何一张合法试卷');
console.log('validatePaper 合法张数:',valid,'/',PAPERS.length);

// ---- publicSession / validateAnswers / objectiveResults ----
const PAPER={questions:[{id:'q1',type:'choice',prompt:'p1',options:[{id:'o1',text:'A'},{id:'o2',text:'B'}],max_score:20,correct_option_ids:['o1']},
  {id:'q2',type:'multi',prompt:'p2',options:[{id:'o3',text:'C'},{id:'o4',text:'D'}],max_score:20,correct_option_ids:['o3','o4']},
  {id:'q3',type:'short',prompt:'p3',options:[],max_score:20,rubric:[{criterion:'c',points:20}],correct_option_ids:[]}]};
const ROWS=[{id:1,grade:'A',status:'graded',revision:1,created_at:'c',submitted_at:'s',score:100,known_score:60,pending_count:2,paper:JSON.stringify(PAPER),answers:'{}',results:null},
  {id:2,grade:'B',status:'x',revision:2,created_at:'c',submitted_at:null,score:null,known_score:null,pending_count:0,paper:null,answers:null,results:null},
  {id:3,grade:'B',status:'x',revision:1,created_at:'c',submitted_at:null,score:null,known_score:null,pending_count:0,paper:JSON.stringify(PAPER),answers:'{"q1":["o1"]}',results:JSON.stringify([{question_id:'q1',score:20,status:'graded',grading_source:'ai'},{question_id:'q2',score:0,status:'graded',grading_source:'system',feedback_code:'incorrect'},{question_id:'q3',score:null,status:'pending_review',grading_source:'admin',reviewer_id:5,reviewer_name:'n'},{question_id:'q4',score:1,status:'graded',grading_source:'x',feedback_code:'zzz'}])},
  {id:4,grade:'B',status:'x',revision:1,created_at:'c',submitted_at:null,score:null,known_score:null,pending_count:0,paper:'bad json',answers:'bad',results:'bad'}];
for(const r of ROWS) if(R(o.publicSession,r)!==R(n.publicSession,r)) diffs.push(`publicSession ${r.id}\n  old=${R(o.publicSession,r)}\n  new=${R(n.publicSession,r)}`);
const ANS=[{q1:['o1'],q2:['o3','o4'],q3:'答案'},{q1:[],q2:[],q3:''},{},null,[],'x',{q9:['o1']},{q1:['o1','o2']},{q1:['o1','o1']},{q1:['zz']},{q3:null},{q3:123}];
for(const a of ANS) if(R(o.validateAnswers,PAPER,a)!==R(n.validateAnswers,PAPER,a)) diffs.push(`validateAnswers ${JSON.stringify(a)}`);
const ANSMAP=[{q1:['o1'],q2:['o3','o4'],q3:'答'},{q1:[],q2:[],q3:''},{q1:['o2'],q2:['o3'],q3:undefined}];
for(const a of ANSMAP) if(R(o.objectiveResults,PAPER,a)!==R(n.objectiveResults,PAPER,a)) diffs.push(`objectiveResults ${JSON.stringify(a)}`);

// ---- gradeShort：桩 fetch 覆盖各种 AI 返回 ----
const SP={questions:[{id:'s1',type:'short',prompt:'p',rubric:[{criterion:'c1',points:10},{criterion:'c2',points:10}]},{id:'s2',type:'short',prompt:'p',rubric:[{criterion:'c1',points:20}]}]};
const mkRes=()=>[{question_id:'s1',score:null,status:'pending_review',feedback_code:'unclear'},{question_id:'s2',score:null,status:'pending_review',feedback_code:'unclear'}];
const GRADES=[
  '{"grades":[{"question_id":"s1","points":[10,10],"confidence":0.9,"feedback_code":"complete"},{"question_id":"s2","points":[20],"confidence":0.95,"feedback_code":"complete"}]}',
  '{"grades":[{"question_id":"s1","points":[5,5],"confidence":0.9,"feedback_code":"partial"},{"question_id":"s2","points":[0],"confidence":0.9,"feedback_code":"off_topic"}]}',
  '{"grades":[{"question_id":"s1","points":[10,10],"confidence":0.7,"feedback_code":"complete"},{"question_id":"s2","points":[20],"confidence":0.9,"feedback_code":"complete"}]}',
  '{"grades":[{"question_id":"s1","points":[10,10],"confidence":0.9,"feedback_code":"unclear"},{"question_id":"s2","points":[20],"confidence":0.9,"feedback_code":"complete"}]}',
  '{"grades":[{"question_id":"s1","points":[11,10],"confidence":0.9,"feedback_code":"partial"},{"question_id":"s2","points":[20],"confidence":0.9,"feedback_code":"complete"}]}',
  '{"grades":[{"question_id":"s1","points":[10,10],"confidence":0.9,"feedback_code":"partial"},{"question_id":"s2","points":[20],"confidence":0.9,"feedback_code":"complete"}]}',
  '{"grades":[{"question_id":"s1","points":[10,10],"confidence":2,"feedback_code":"complete"},{"question_id":"s2","points":[20],"confidence":0.9,"feedback_code":"complete"}]}',
  '{"grades":[{"question_id":"zz","points":[10,10],"confidence":0.9,"feedback_code":"complete"},{"question_id":"s2","points":[20],"confidence":0.9,"feedback_code":"complete"}]}',
  '{"grades":[{"question_id":"s1","points":[10,10],"confidence":0.9,"feedback_code":"complete"}]}',
  '{"grades":[{"question_id":"s1","points":[10,10],"confidence":0.9,"feedback_code":"complete"},{"question_id":"s1","points":[10,10],"confidence":0.9,"feedback_code":"complete"}]}',
  'not json',
];
const realFetch=globalThis.fetch;
let applied=0;
for(const g of GRADES) for(const mode of ['ok','nonok','throw']){
  globalThis.fetch=async()=>{ if(mode==='throw') throw new Error('net'); 
    return {ok:mode!=='nonok', json:async()=>({choices:[{message:{content:g}}]})}; };
  const a=await o.gradeShort({OPENAI_API_KEY:'k'},SP,{s1:'答',s2:'答'},mkRes());
  const b=await n.gradeShort({OPENAI_API_KEY:'k'},SP,{s1:'答',s2:'答'},mkRes());
  if(JSON.stringify(a)!==JSON.stringify(b)) diffs.push(`gradeShort ${mode} ${g.slice(0,60)}\n  old=${JSON.stringify(a)}\n  new=${JSON.stringify(b)}`);
  if(b.some(r=>r.status==='graded')) applied++;
}
// 未作答的简答不参与评分
const noAns={s1:'',s2:'x'};
const a0=await o.gradeShort({OPENAI_API_KEY:'k'},SP,noAns,mkRes());
const b0=await n.gradeShort({OPENAI_API_KEY:'k'},SP,noAns,mkRes());
if(JSON.stringify(a0)!==JSON.stringify(b0)) diffs.push('gradeShort 未作答分支不同');
globalThis.fetch=realFetch;
if(applied<1) throw new Error('假绿：gradeShort 没有任何一次真正写回成绩');
console.log('gradeShort 实际写回成绩的次数:',applied);

Object.defineProperty(globalThis,'crypto',{value:realCrypto,configurable:true});
console.log(diffs.length?'DIFFS:\n'+diffs.slice(0,8).join('\n'):'EXAM-SESSION OK: 0 diffs (FEEDBACK/totals/event/examSources/validatePaper/publicSession/validateAnswers/objectiveResults/gradeShort)');
console.log('exports old:',Object.keys(o).sort().join(','),'\nexports new:',Object.keys(n).sort().join(','));
