import * as oldM from './audit-policy.old.js';
import * as newM from '../functions/_core/audit-policy.js';
const diffs=[];
const paths=['/api/login','/api/init','/api/hotel-owner','/api/city-map','/api/nope','/api/admin/messages','/api/uploads','/api/tickets','/api/admin/exam-review','/api/admin/support-chat','/api/admin/circuit'];
const actions=[null,'passkey-login-start','passkey-login-finish','passkey-admin-start','passkey-test-start','admin-enter-password','admin-logout','dm-read','signin-status','admin-dm-ai-suggest','admin-player-create','admin-reset-player-password','player-change-password','passkey-register-x','foo-merge-account','x'];
const methods=['GET','POST','PUT','HEAD','OPTIONS','DELETE'];
for(const p of paths) for(const action of actions) for(const method of methods) for(const extra of ['','&export=1','&save=1']){
  const u=`https://x.test${p}?action=${action??''}${extra}`;
  const req={url:u,method};
  let a,b; try{a=oldM.shouldAudit(req)}catch(e){a='E'} try{b=newM.shouldAudit(req)}catch(e){b='E'}
  if(a!==b) diffs.push(`shouldAudit ${method} ${u}: ${a} != ${b}`);
  const un=`https://x.test${p}${action!==null?'?action='+action:''}${extra}`;
  let c,d; try{c=oldM.auditResource(new URL(un))}catch(e){c='E'} try{d=newM.auditResource(new URL(un))}catch(e){d='E'}
  if(c!==d) diffs.push(`auditResource ${un}: ${c} != ${d}`);
}
for(const p of paths) for(const entity of ['hotels','rooms','bookings','other','']){
  const u=`https://x.test${p}?entity=${entity}`;
  const c=oldM.auditResource(new URL(u)), d=newM.auditResource(new URL(u));
  if(c!==d) diffs.push(`auditResource(entity) ${u}: ${c} != ${d}`);
}
console.log(diffs.length?'DIFFS:\n'+diffs.join('\n'):'AUDIT-POLICY OK: 0 diffs over '+(paths.length*actions.length*methods.length*3)+' shouldAudit cases');
console.log('exports old:',Object.keys(oldM).sort().join(','));
console.log('exports new:',Object.keys(newM).sort().join(','));
