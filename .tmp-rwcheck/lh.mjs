import * as o from '../functions/_core/login-history.oldcheck.js';
import * as n from '../functions/_core/login-history.js';
const diffs=[];

// ---- deviceLabel: 纯函数，逐 UA 比对 ----
const UAS=['','Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
'CriOS/120.0 Mobile/15E148 Safari/604.1','FxiOS/120.0','Edg/120.0 Chrome/120.0','Chrome/120.0','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15','Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0',
'Safari/','Edg','Googlebot/2.1 (+http://www.google.com/bot.html)','curl/8.0','x',null];
for(const ua of UAS){ let a,b; try{a=o.deviceLabel(ua)}catch(e){a='E:'+e.message} try{b=n.deviceLabel(ua)}catch(e){b='E:'+e.message} if(a!==b) diffs.push(`deviceLabel(${ua}): ${a} != ${b}`); }
for(const ua of [undefined]){ let a,b; try{a=o.deviceLabel()}catch(e){a='E:'+e.message} try{b=n.deviceLabel()}catch(e){b='E:'+e.message} if(a!==b) diffs.push(`deviceLabel(): ${a} != ${b}`); }

// ---- recordSuccessfulLogin: 录 SQL + 参数，两版逐字比对 ----
function makeDb(row){
  const log=[];
  class St{constructor(sql,params=[]){this.sql=sql;this.params=params;}bind(...p){return new St(this.sql,p);}
    all(){log.push(['all',this.sql,this.params]);return Promise.resolve({results:row?[row]:[]});}
    run(){log.push(['run',this.sql,this.params]);return Promise.resolve({});}
    first(){log.push(['first',this.sql,this.params]);return Promise.resolve(row||null);}}
  return {log, prepare:sql=>new St(sql), batch:items=>{log.push(['batch',items.map(s=>[s.sql,s.params])]);return Promise.resolve([]);}};
}
function req(url,method='POST',ua='Edg/120 Safari'){return {url,method,headers:{get:(k)=>k==='User-Agent'?ua:null}};}
function res(ok=true,cookie='lc_session=tok123; Path=/; HttpOnly'){return {ok,headers:{get:(k)=>k==='Set-Cookie'?cookie:null}};}

const paths=['/api/login?action=','/api/login?action=x','/api/login','/api/ticket?action=passkey-login-finish','/api/ticket?action=passkey-admin-finish',
'/api/ticket?action=admin-enter-password','/api/ticket?action=admin-logout','/api/ticket?action=passkey-login-start','/api/other'];
const rows=[{player_id:1},{player_id:null},null,undefined];
const cookies=['lc_session=tok123; Path=/','other=1; lc_session=abc; Path=/','','no cookie here'];
let ran=0;
for(const p of paths) for(const method of ['POST','GET']) for(const row of rows) for(const cookie of cookies) for(const ok of [true,false]){
  const da=makeDb(row), db=makeDb(row);
  const r1=req('https://x.test'+p,method), r2=req('https://x.test'+p,method);
  let ea,eb;
  try{await o.recordSuccessfulLogin(da,r1,res(ok,cookie))}catch(e){ea='E:'+e.message}
  try{await n.recordSuccessfulLogin(db,r2,res(ok,cookie))}catch(e){eb='E:'+e.message}
  ran++;
  const sa=JSON.stringify([da.log,ea]), sb=JSON.stringify([db.log,eb]);
  if(sa!==sb) diffs.push(`recordSuccessfulLogin ${method} ${p} row=${JSON.stringify(row)} cookie=${cookie} ok=${ok}\n  old=${sa}\n  new=${sb}`);
}
console.log(diffs.length?'DIFFS:\n'+diffs.slice(0,10).join('\n'):`LOGIN-HISTORY OK: 0 diffs (${UAS.length} UA + ${ran} login paths)`);
console.log('exports old:',Object.keys(o).sort().join(','),'| new:',Object.keys(n).sort().join(','));
