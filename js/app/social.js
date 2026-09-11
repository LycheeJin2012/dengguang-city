import {renderChat} from './chat-page.js';
import {
  $, $$, api, post, patch, region, tr, esc, text, date, empty, title, field, modal, action, toast, state, login, linkUrl
}
from './core.js';
export async function render(el,page){
  page=page==='messages'?(new URLSearchParams(location.search).get('tab')==='notifications'?'notifications':'dm'):page;
  if(!state.session?.player){
    el.innerHTML=title(page==='dm'?'私信':'通知中心',page==='dm'?'Messages':'Notifications')+`<div class="panel"><p>${tr('请先登录市民账号','Please sign in as a citizen')}</p><button id="sign-in">${tr('登录','Sign in')}</button></div>`;
    $('#sign-in',el).onclick=async()=>{
      await login();
      if(state.session?.player)render(el,page);
    }
    ;
    return;
  }
  el.innerHTML=title('消息','Messages')+`<div class="tabs section" role="tablist" aria-label="消息分类"><button type="button" role="tab" id="message-tab-dm" aria-controls="message-panel-dm" data-message-tab="dm">私信与灯灯</button><button type="button" role="tab" id="message-tab-notifications" aria-controls="message-panel-notifications" data-message-tab="notifications">通知</button></div><section role="tabpanel" id="message-panel-dm" aria-labelledby="message-tab-dm" hidden></section><section role="tabpanel" id="message-panel-notifications" aria-labelledby="message-tab-notifications" hidden></section>`;
  const loaded=new Map();
  async function select(key){
    $$('[data-message-tab]',el).forEach(b=>{const active=b.dataset.messageTab===key;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;$('#message-panel-'+b.dataset.messageTab,el).hidden=!active;});
    const url=new URL(location.href);url.pathname='/messages.html';if(key==='notifications')url.searchParams.set('tab','notifications');else url.searchParams.delete('tab');history.replaceState(null,'',url.pathname+url.search+url.hash);
    if(!loaded.has(key)){const panel=$('#message-panel-'+key,el);const load=region(panel,()=>key,async()=>{await(key==='dm'?messages(panel):notifications(panel));$('.page-heading',panel)?.remove();document.title=tr('消息 · 灯光市','Messages · Light City');});loaded.set(key,load);}
    await loaded.get(key);
  }
  const tabs=$$('[data-message-tab]',el);tabs.forEach((b,i)=>{b.onclick=()=>select(b.dataset.messageTab);b.onkeydown=e=>{const next=e.key==='ArrowRight'?(i+1)%tabs.length:e.key==='ArrowLeft'?(i+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;if(next!==null){e.preventDefault();tabs[next].focus();select(tabs[next].dataset.messageTab);}};});
  await select(page==='notifications'?'notifications':'dm');
}
async function notifications(el){
  let filter='all',all=[];
  el.innerHTML=title('通知中心','Notifications')+`<div class="toolbar"><div class="tabs">${[['all','全部','All'],['unread','未读','Unread'],['message_reply','留言回复','Replies'],['dm','私信','Messages'],['announcement','公告','Announcements']].map(([k,zh,en])=>`<button data-filter="${k}" aria-selected="${k==='all'}">${tr(zh,en)}</button>`).join('')}</div><button id="refresh-notifications">刷新通知</button><button id="read-all">${tr('全部标为已读','Mark all read')}</button></div><p id="unread" class="muted"></p><div id="notifications"></div>`;
  const draw=()=>{
    const list=all.filter(n=>filter==='all'||filter==='unread'&&!n.read_at||n.type===filter);
    $('#unread',el).textContent=all.filter(n=>!n.read_at).length+' '+tr('条未读（当前加载范围）','unread in loaded records');
    $('#notifications',el).innerHTML=list.map(n=>`<article class="panel"><div class="row-head"><h3>${esc(n.title)}</h3>${n.read_at?'':`<span class="badge unread">${tr('未读','Unread')}</span>`}</div><p>${text(n.body)}</p><small>${date(n.created_at)}</small><div class="actions">${linkUrl(n.link)&&new URL(linkUrl(n.link)).origin===location.origin?`<a class="button" href="${esc(linkUrl(n.link))}">${tr('查看','Open')} ↗</a>`:''}${!n.read_at?`<button data-read="${n.id}">${tr('标为已读','Mark read')}</button>`:''}</div></article>`).join('')||empty();
    $$('[data-read]',el).forEach(b=>b.onclick=e=>action(e.currentTarget,async()=>{
      await patch('/api/notifications?id='+b.dataset.read);all.find(n=>n.id===+b.dataset.read).read_at=new Date().toISOString();draw();
    }
    ));
  }
  ;
  $$('[data-filter]',el).forEach(b=>b.onclick=()=>{
    filter=b.dataset.filter;$$('[data-filter]',el).forEach(x=>x.setAttribute('aria-selected',x===b));draw();
  }
  );
  $('#read-all',el).onclick=e=>action(e.currentTarget,async()=>{
    await patch('/api/notifications?action=read-all');all.forEach(n=>n.read_at=n.read_at||new Date().toISOString());draw();
  }
  );
  const load=()=>region($('#notifications',el),()=>api('/api/notifications?my=1&limit=200'),d=>{
    all=d.notifications||[];draw();
  }
  );
  $('#refresh-notifications',el).onclick=load;await load();
}
async function messages(el){await renderChat(el);}
