import * as o from './ticket-visibility.old.js';
import * as n from '../functions/_core/ticket-visibility.js';
const diffs=[];
const mk=(action,extra={})=>({id:Math.floor(Math.random()*1e6),created_at:'2026-01-01 00:00:00',action,actor_type:'admin',actor_id:7,actor_name:'管理员',details:JSON.stringify(extra),...extra.raw});
const cases=[];
const actions=['created','human_requested','replied','auto_replied','player_followup','player_question','status_changed','reopened','attachments_added','consent_changed','assigned','internal_note','escalated','unknown_action'];
for(const a of actions) for(const det of ['{}','{"reply":"好的"}','{"to":"open"}','{"to":"resolved"}','{"to":"secret_state"}','{"to":"in_progress"}','{"to":"closed"}','{"to":"weird"}','not json','{"reply":"x","to":"open"}','','null']) cases.push(mk(a,{raw:{details:det}}));
cases.push(mk('replied',{raw:{details:'bad json'}}),mk('status_changed',{raw:{details:'bad json'}}),{id:1,action:'created'});
for(const list of [cases, cases.slice(0,5), [], null, undefined]){
  for(const fn of ['citizenTimeline']){
    let a,b; try{a=JSON.stringify(o[fn](list))}catch(e){a='E:'+e.message} try{b=JSON.stringify(n[fn](list))}catch(e){b='E:'+e.message}
    if(a!==b) diffs.push(`${fn}: ${a} !== ${b}`);
  }
}
// citizenTicket
const tickets=[
  {id:'t1',title:'x',body:'b',kind:'k',category:'c',status:'open',created_at:'1',replied_at:null,admin_reply:'r',auto_reply:'a',replied_by:'u',reply_author_name:'n',public_consent:1,public_visible:1,target_player_id:2,target_player_name:'p',target_admin_id:null,attachments:'[]',attachment_count:0,reply_feedback:null,source_table:'tickets',history:cases.slice(0,4)},
  {id:'t2',source_table:'support'},
  {id:'t3',source_table:'support',history:[]},
  {},
  {source_table:'tickets',history:null},
  {id:'t4',source_table:'support',history:cases},
];
for(const t of tickets){
  let a,b; try{a=JSON.stringify(o.citizenTicket(t))}catch(e){a='E:'+e.message} try{b=JSON.stringify(n.citizenTicket(t))}catch(e){b='E:'+e.message}
  if(a!==b) diffs.push(`citizenTicket(${t.id}):\n  old=${a}\n  new=${b}`);
  if(!a.startsWith('E:')){
    const ka=Object.keys(JSON.parse(a)), kb=Object.keys(JSON.parse(b));
    if(ka.join()!==kb.join()) diffs.push(`key order ${t.id}: ${ka} vs ${kb}`);
  }
}
console.log(diffs.length?'DIFFS:\n'+diffs.join('\n'):'TICKET-VISIBILITY OK: 0 diffs ('+cases.length+' timeline cases, '+tickets.length+' ticket cases)');
console.log('exports old:',Object.keys(o).sort().join(','),'| new:',Object.keys(n).sort().join(','));
