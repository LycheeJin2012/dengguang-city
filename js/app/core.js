import {canSeeMunicipalLink,canSeeHotelOwnerLink} from './permissions.js';
import {
  parseDate
}
from '../date.js';
export const $ = (s, root=document) => root.querySelector(s);
export const $$ = (s, root=document) => [...root.querySelectorAll(s)];
export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}
[c]));
export const state = {
  session:null, language:'zh-CN'
}
;
try {
  state.language = localStorage.getItem('lc_lang') === 'en' ? 'en' : 'zh-CN';
}
catch {
}
export const tr = (zh,en=zh) => state.language==='en'?en:zh;
export const date = value => {
  const d=parseDate(value);
  return Number.isFinite(+d)?d.toLocaleString(state.language,{
    hour12:false
  }
  ):'—';
}
;
export const text = value => `<span class="prewrap">${esc(value)}</span>`;
export const linkUrl = value => {
  try {
    const u=new URL(value,location.href);
    return /^https?:$/.test(u.protocol)?u.href:'';
  }
  catch{
    return '';
  }
}
;
export const imageUrl = value => {
  // Presentation guard: a missing announcement / room image must not render as
  // /null or /undefined. Empty / blank values short-circuit before linkUrl, so
  // the <img> tag receives no src at all and the page layout stays clean.
  if(value===null||value===undefined)return '';
  const trimmed=String(value).trim();
  if(trimmed==='')return '';
  if(/^data:image\/(png|jpeg|gif|webp);base64,/i.test(trimmed))return trimmed;
  return linkUrl(trimmed);
}
;
export function status(value) {
  const labels={
    pending:['待审核','Pending'],active:['已激活','Active'],rejected:['未通过','Rejected'],approved:['已批准','Approved'],confirmed:['已确认','Confirmed'],completed:['已完成','Completed'],passed:['已通过','Passed'],failed:['未通过','Failed'],open:['待处理','Open'],in_progress:['处理中','In progress'],resolved:['已解决','Resolved'],closed:['已关闭','Closed'],unread:['未读','Unread'],read:['已读','Read'],done:['已办结','Done']
  }
  ;
  return `<span class="badge ${esc(value)}">${esc(labels[value]?tr(...labels[value]):value||'—')}</span>`;
}
export async function api(path,{
  method='GET',body,signal
}
={
}
) {
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),20000);
  const abort=()=>ctrl.abort();
  signal?.addEventListener('abort',abort,{
    once:true
  }
  );
  try {
    const r=await fetch(path,{
      method,credentials:'same-origin',cache:'no-store',signal:ctrl.signal,headers:body===undefined?{
      }
      :{
        'Content-Type':'application/json'
      }
      ,body:body===undefined?undefined:JSON.stringify(body)
    }
    );
    const data=await r.json().catch(()=>null);
    if(!r.ok||!data||data.ok===false){
      const e=new Error(data?.error||tr('服务暂时不可用，请重试','Service unavailable. Please retry.'));
      e.status=r.status;
      throw e;
    }
    return data;
  }
  catch(e){
    if(e.name==='AbortError')throw new Error(tr('请求超时，请重试','Request timed out. Please retry.'));
    throw e;
  }
  finally{
    clearTimeout(timer);
    signal?.removeEventListener('abort',abort);
  }
}
export const post=(p,body={
}
)=>api(p,{
  method:'POST',body
}
);
export const patch=(p,body={
}
)=>api(p,{
  method:'PATCH',body
}
);
export const del=p=>api(p,{
  method:'DELETE'
}
);
export async function session(){
  try{
    state.session=await api('/api/login');
    if(state.session?.admin&&typeof document!=='undefined'&&document.body?.dataset.page!=='admin'){await post('/api/init?action=admin-logout',{});state.session=await api('/api/login');}
  }
  catch(e){
    state.session=null;
    if(e.status!==401)throw e;
  }
  return state.session;
}
export function toast(message,error=false){
  let el=$('#toast');
  if(!el){
    el=document.createElement('div');
    el.id='toast';
    el.setAttribute('role','status');
    document.body.append(el);
  }
  el.textContent=message;
  el.className=error?'toast error':'toast';
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>el.remove(),5000);
}
export const empty=(message=tr('暂无记录','No records yet'))=>`<div class="empty"><span aria-hidden="true">◇</span><p>${esc(message)}</p></div>`;

export async function region(el,load,render){
  if(!el)return;
  const token=Symbol();
  el._load=token;
  el.setAttribute('aria-busy','true');
  el.innerHTML=`<p class="loading" role="status">${tr('正在加载…','Loading…')}</p>`;
  try{
    const d=await load();
    if(el._load!==token||!el.isConnected)return;
    el.innerHTML='';
    await render(d,el);
  }
  catch(e){
    if(el._load!==token||!el.isConnected)return;
    el.innerHTML=`<div class="empty error" role="alert"><p>${esc(e.message)}</p><button type="button" data-retry>${tr('重新加载','Retry')}</button></div>`;
    $('[data-retry]',el).onclick=()=>region(el,load,render);
  }
  finally{
    if(el._load===token)el.removeAttribute('aria-busy');
  }
}
export async function action(button,fn){
  if(button?.disabled)return;
  const original=button?.textContent;
  if(button){
    button.disabled=true;
    button.textContent=tr('处理中…','Working…');
  }
  try{
    await fn();
  }
  catch(e){
    toast(e.message,true);
  }
  finally{
    if(button?.isConnected){
      button.disabled=false;
      button.textContent=original;
    }
  }
}
export function optionLabel(value){
  const labels={
    pending:['待审核','Pending'],active:['已激活','Active'],rejected:['未通过','Rejected'],approved:['已批准','Approved'],confirmed:['已确认','Confirmed'],completed:['已完成','Completed'],cancelled:['已取消','Cancelled'],passed:['已通过','Passed'],failed:['未通过','Failed'],open:['待处理','Open'],in_progress:['处理中','In progress'],resolved:['已解决','Resolved'],closed:['已关闭','Closed'],low:['低','Low'],normal:['普通','Normal'],high:['高','High'],urgent:['紧急','Urgent'],written:['笔试','Written exam'],road:['路考','Road test'],upgrade:['升级考试','Upgrade test'],choice:['单选题','Single choice'],multi:['多选题','Multiple choice'],judge:['判断题','True / false'],admin:['管理员','Administrator'],super:['超级管理员','Super administrator']
  }
  ;
  return labels[value]?tr(...labels[value]):value;
}
export function ticketBody(value){
  let data;
  try{
    data=JSON.parse(value);
  }
  catch{
    return text(value);
  }
  if(!data||Array.isArray(data)||typeof data!=='object')return text(value);
  const labels={
    name:['姓名','Name'],contact:['联系方式','Contact'],room_name:['房型','Room'],in_date:['入住','Check-in'],out_date:['退房','Check-out'],nights:['晚数','Nights'],persons:['入住人数','Guests'],breakfast:['早餐','Breakfast'],session:['场次','Session'],exam_session:['考试场次','Exam session'],exam_type:['考试','Exam'],exam_date:['考试日期','Exam date'],car:['车型','Vehicle'],license:['驾照','License'],note:['备注','Notes']
  }
  ;
  return Object.entries(data).filter(([key,v])=>labels[key]&&v!==null&&v!=='').map(([key,v])=>`<p><b>${tr(...labels[key])}：</b>${text(key==='breakfast'?tr(v?'含':'不含',v?'Included':'Not included'):optionLabel(v))}</p>`).join('')||text(tr('详情请查看对应业务记录','See the related application for details'));
}
export function field(name,label,type='text',value='',opts={
}
) {
  const attrs=`name="${esc(name)}" id="field-${esc(name)}" ${opts.required===false?'':'required'} ${opts.max!==undefined?`max="${opts.max}"`:''} ${opts.min!==undefined?`min="${opts.min}"`:''} ${opts.step?`step="${opts.step}"`:''}`;
  const content=type==='textarea'?`<textarea ${attrs} maxlength="${opts.maxlength||2000}" rows="4">${esc(value)}</textarea>`:type==='select'?`<select ${attrs}>${(opts.options||[]).map(o=>{
    const [v,l]=Array.isArray(o)?o:[o,optionLabel(o)];return `<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(l)}</option>`;
  }
  ).join('')}</select>`:type==='checkbox'?`<input type="checkbox" name="${esc(name)}" id="field-${esc(name)}" ${value?'checked':''}>`:`<input type="${esc(type)}" ${attrs} value="${esc(value)}" maxlength="${opts.maxlength||200}" ${type==='password'?'autocomplete="new-password"':''}>`;
  return `<label class="field ${type==='textarea'?'wide':''} ${type==='checkbox'?'check':''}"><span>${esc(label)}</span>${content}</label>`;
}
export function modal(title,content,{
  submit,label=tr('保存','Save'),wide=false
}
={
}
) {
  $('#modal')?.close();
  $('#modal')?.remove();
  const dialog=document.createElement('dialog');
  dialog.id='modal';
  dialog.className=wide?'modal wide-modal':'modal';
  dialog.innerHTML=`<div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-close aria-label="${tr('关闭','Close')}">✕</button></div><form class="modal-body"><div class="form-grid">${content}</div><p class="form-error" role="alert"></p><div class="actions"><button type="button" data-close>${tr('取消','Cancel')}</button>${submit?`<button class="primary" type="submit">${esc(label)}</button>`:''}</div></form>`;
  const previous=document.activeElement;
  document.body.append(dialog);
  const close=()=>{if(dialog.dataset.saving!=='true')dialog.close();};
  dialog.addEventListener('cancel',event=>{if(dialog.dataset.saving==='true')event.preventDefault();});
  $$('[data-close]',dialog).forEach(b=>b.onclick=close);
  dialog.addEventListener('click',e=>{
    if(e.target===dialog){
      const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();
    }
  }
  );
  dialog.addEventListener('close',()=>{
    dialog.remove();previous?.focus();
  }
  ,{
    once:true
  }
  );
  if(submit)$('form',dialog).onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    const btn=$('[type=submit]',form);
    if(btn.disabled)return;
    const data=Object.fromEntries(new FormData(form));
    $$('input[type=checkbox]:not(:disabled)',form).forEach(c=>data[c.name]=c.checked?1:0);
    $$('input[type=number]:not(:disabled)',form).forEach(c=>data[c.name]=c.value===''?null:Number(c.value));
    const old=btn.textContent;
    btn.disabled=true;
    dialog.dataset.saving='true';
    $$('[data-close]',dialog).forEach(b=>b.disabled=true);
    btn.textContent=tr('保存中…','Saving…');
    $('.form-error',dialog).textContent='';
    try{
      await submit(data,dialog);
      dialog.close();
    }
    catch(err){
      $('.form-error',dialog).textContent=err.message;
    }
    finally{
      dialog.dataset.saving='false';
      $$('[data-close]',dialog).forEach(b=>b.disabled=false);
      if(btn.isConnected){
        btn.disabled=false;
        btn.textContent=old;
      }
    }
  }
  ;
  dialog.showModal();
  $('input:not([type=checkbox]),textarea,select',dialog)?.focus();
  return dialog;
}
export async function requirePlayer(){
  await state.authPending;
  if(!state.session?.player){
    await login();
    await session();
    if(!state.session?.player)throw new Error(tr('请先登录市民账号','Please sign in as a citizen'));
  }
  return state.session.player;
}
export function login(register=false,target='player',options={}){
  return new Promise(resolve=>{
    const dialog=modal(target==='hotel_owner'?tr('酒店老板登录','Hotel owner sign in'):tr(register?'市民注册':'登录灯光市',register?'Join Light City':'Sign in'),field('username',tr('游戏 ID','Game ID'))+(register?field('email',tr('邮箱','Email'),'email'):'')+field('password',tr('密码','Password'),'password')+`<div class="wide actions">${target==='player'&&!options.hideRegistration?`<button type="button" id="auth-switch">${tr(register?'已有账号？登录':'没有账号？注册',register?'Already registered?':'Create account')}</button>`:''}${register||target==='hotel_owner'?'':`<button type="button" id="auth-passkey">${tr('使用通行密钥','Use passkey')}</button>`}</div>`,{
      label:tr(register?'提交注册':'登录',register?'Register':'Sign in'),submit:async d=>{
        await post(register?'/api/register':'/api/login',{
          ...d,target
        }
        );if(register)toast(tr('注册申请已提交，等待审核','Registration submitted for approval'));else {
          await session();renderAccount();toast(tr('登录成功','Signed in'));
        }
      }
    }
    ); $('#auth-switch',dialog)?.addEventListener('click',()=>{
      dialog.close();login(!register);
    });$('#auth-passkey',dialog)?.addEventListener('click',e=>action(e.currentTarget,async()=>{
      const {
        passkeyLogin
      }
      =await import('./security.js');await passkeyLogin(target);await session();renderAccount();dialog.close();
    }
    ));dialog.addEventListener('close',resolve,{
      once:true
    }
    );
  }
  );
}
function navigationMarkup(){
 const links=[['/','首页','Home'],['/hotel.html','酒店','Hotel'],['/map.html','地图','Map'],['/affairs.html','我的事务','My affairs'],['/messages.html','消息','Messages']];
 if(canSeeMunicipalLink(state.session))links.push(['/admin.html','市政后台','Admin']);
 if(canSeeHotelOwnerLink(state.session))links.push(['/hotel-owner.html','我的酒店','My hotel']);
 return links.map(([href,zh,en])=>`<a href="${href}" ${location.pathname===href?'aria-current="page"':''}>${tr(zh,en)}</a>`).join('');
}
export function renderAccount(){
 const navigation=$('#navigation');if(navigation)navigation.innerHTML=navigationMarkup();
  const slot=$('#account');
  if(!slot)return;
  const p=state.session?.player,a=state.session?.admin||state.session?.user;
  slot.innerHTML=state.session?`${p?`<a href="/profile.html">👤 ${esc(p.username)}</a><span class="balance">💎 ${Number(p.emeralds)||0}</span>`:`<span>${esc(a?.username)}</span>`}<button id="logout">${tr('退出','Sign out')}</button>`:`<button id="login" class="primary">${tr('市民登录','Sign in')}</button>`;
  const contact=$('#contact-form');
  if(p&&contact){
    for(const [key,val] of [['name',p.username],['contact',p.email]]){
      const input=$('[name='+key+']',contact);
      if(input&&!input.value)input.value=val||'';
    }
  }
  $('#login')?.addEventListener('click',()=>login());
  $('#logout')?.addEventListener('click',e=>action(e.currentTarget,async()=>{
    await del('/api/login');location.href='/';
  }
  ));
}
export function shell(){
  document.documentElement.lang=state.language;
  document.documentElement.style.colorScheme='light';
  // Wrap layout in `.app-shell` so the page can use a consistent flex column.
  if(!document.body.classList.contains('app-shell'))document.body.classList.add('app-shell');
  // Tag the page role on the body for sub-styling (admin, player, public).
  const role=document.body.dataset.page;
  if(role&&!document.body.classList.contains('page-'+role))document.body.classList.add('page-'+role);
  const header=$('#header');
  header.innerHTML=`<div class="header-inner"><a class="brand" href="/"><span class="grass-block" aria-hidden="true"></span><span><strong>${tr('灯光市人民政府','Light City Hall')}</strong><small>LIGHT CITY · EST. 2023</small></span></a><button id="menu" aria-expanded="false" aria-controls="navigation">☰ ${tr('菜单','Menu')}</button><nav id="navigation" aria-label="${tr('主要导航','Main navigation')}">${navigationMarkup()}</nav><div id="account"></div><button id="language">${state.language==='en'?'中文':'EN'}</button></div>`;
  $('#menu').onclick=()=>{
    const open=$('#navigation').classList.toggle('open');
    $('#menu').setAttribute('aria-expanded',open);
  }
  ;
  $('#language').onclick=()=>{
    try{
      localStorage.setItem('lc_lang',state.language==='en'?'zh-CN':'en');
    }
    catch{
    }
    location.reload();
  }
  ;
  // Sticky-header shadow: only the .is-stuck class toggle. Threshold ≈ 6px so
  // tiny mouse-wheel ticks don’t flicker the class. rAF keeps the cost low.
  let lastStuck=false;
  const onScroll=()=>{
    const stuck=window.scrollY>6;
    if(stuck===lastStuck)return;
    lastStuck=stuck;
    header.classList.toggle('is-stuck',stuck);
  }
  ;
  window.addEventListener('scroll',()=>requestAnimationFrame(onScroll),{passive:true});
  onScroll();
  renderAccount();
  $('#footer').innerHTML=`<div><b>${tr('灯光市 · 由市民共建','Light City · Built by citizens')}</b><p>${tr('Minecraft 城市作品展示，与 Mojang / Microsoft 无关。','A Minecraft city project, not affiliated with Mojang / Microsoft.')}</p></div><a href="/#contact">${tr('联系市政厅','Contact City Hall')} ↗</a>`;
}
export function title(zh,en){
  document.title=tr(zh,en)+' · '+tr('灯光市','Light City');
  return `<div class="page-heading"><div><p class="eyebrow">LIGHT CITY / ${esc(en.toUpperCase())}</p><h1>${esc(tr(zh,en))}</h1></div></div>`;
}
export async function download(name,content,type='text/plain'){
  try{await post('/api/ui-events',{events:[{action:'export',page:location.pathname,element:'download',label:name}]});}catch(e){toast(tr('无法记录导出操作，请重试','Could not record export. Please retry.'),true);return;}
  const url=URL.createObjectURL(new Blob([content],{
    type
  }
  ));
  const a=document.createElement('a');
  a.href=url;
  a.download=name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function csv(name,rows){
  if(!rows.length)return toast(tr('暂无可导出记录','No records to export'));
  const keys=Object.keys(rows[0]);
  const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
  await download(name,'\ufeff'+[keys,...rows.map(r=>keys.map(k=>r[k]))].map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}
