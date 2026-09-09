function knowledgeLinks(raw){try{const a=JSON.parse(raw||'[]');return Array.isArray(a)?a.filter(x=>Number.isSafeInteger(x.id)&&x.id>0).map(x=>`<a href="/knowledge.html?id=${x.id}">依据：知识 #${x.id} ${esc(x.title)} · v${Number(x.revision)||1}</a>`).join('<br>'):'';}catch{return '';}}
import {viewCitizenTicket} from './ticket-form.js';
import {
  $, $$, api, post, patch, region, tr, esc, text, date, empty, title, field, modal, action, toast, state, login, linkUrl
}
from './core.js';
export async function render(el,page){
  if(page==='leaderboard')return leaderboard(el);
  if(!state.session?.player){
    el.innerHTML=title(page==='dm'?'私信':'通知中心',page==='dm'?'Messages':'Notifications')+`<div class="panel"><p>${tr('请先登录市民账号','Please sign in as a citizen')}</p><button id="sign-in">${tr('登录','Sign in')}</button></div>`;
    $('#sign-in',el).onclick=async()=>{
      await login();
      if(state.session?.player)render(el,page);
    }
    ;
    return;
  }
  return page==='dm'?messages(el):notifications(el);
}
async function leaderboard(el){
  el.innerHTML=title('玩家榜单','Leaderboard')+`<div class="tabs" role="tablist">${[['messages','💬 活跃市民','💬 Active citizens'],['bookings','🏨 常住旅客','🏨 Frequent guests'],['licenses','🚗 驾照等级','🚗 License holders']].map(([k,zh,en])=>`<button role="tab" aria-selected="${k==='messages'}" data-type="${k}">${tr(zh,en)}</button>`).join('')}</div><div class="panel" id="board"></div>`;
  let current='messages';
  const load=()=>region($('#board',el),()=>api('/api/leaderboard?type='+current),(d,box)=>{
    box.innerHTML=(d.entries||[]).map(e=>`<div class="rank"><strong>${e.rank}</strong><a href="/profile.html?u=${encodeURIComponent(e.username)}">${esc(e.avatar_emoji||'👤')} ${esc(e.username)}</a><span>${esc(e.grades||e.score)}</span></div>`).join('')||empty();
  }
  );
  $$('[data-type]',el).forEach(b=>b.onclick=()=>{
    current=b.dataset.type;$$('[data-type]',el).forEach(t=>t.setAttribute('aria-selected',t===b));load();
  }
  );
  await load();
}
async function notifications(el){
  let filter='all',all=[];
  el.innerHTML=title('通知中心','Notifications')+`<div class="toolbar"><div class="tabs">${[['all','全部','All'],['unread','未读','Unread'],['message_reply','留言回复','Replies'],['dm','私信','Messages'],['announcement','公告','Announcements']].map(([k,zh,en])=>`<button data-filter="${k}" aria-selected="${k==='all'}">${tr(zh,en)}</button>`).join('')}</div><button id="read-all">${tr('全部标为已读','Mark all read')}</button></div><p id="unread" class="muted"></p><div id="notifications"></div>`;
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
  await region($('#notifications',el),()=>api('/api/notifications?my=1&limit=200'),d=>{
    all=d.notifications||[];draw();
  }
  );
}
async function messages(el){
  let peer='',threadVersion=0;
  el.innerHTML=title('市民私信','Messages')+`<div class="toolbar"><button id="new-message" class="primary">＋ ${tr('写私信','New message')}</button><button id="ai-message">🤖 ${tr('联系灯灯','Contact DengDeng')}</button><a class="button" href="/knowledge.html">${tr('查阅知识库','Search knowledge')}</a></div><div class="split"><aside class="panel" id="conversations"></aside><section class="panel" id="thread">${empty(tr('选择会话或写一封新私信','Select a conversation or start a new one'))}</section></div>`;
  const loadList=()=>region($('#conversations',el),()=>api('/api/social?action=dm-list'),(d,box)=>{
    box.innerHTML=(d.conversations||[]).map((c,i)=>`<button class="conversation ${c.peer.username===peer?'selected':''}" data-conversation="${i}"><b>${esc(c.peer.username)}</b> ${c.unread?`<span class="badge">${c.unread}</span>`:''}<small>${esc(c.last_content)}</small></button>`).join('')||empty();$$('[data-conversation]',box).forEach(b=>b.onclick=()=>open(d.conversations[+b.dataset.conversation].peer.username));
  }
  );
  async function open(username){
    peer=username;
    const version=++threadVersion;
    await region($('#thread',el),()=>api('/api/social?action=dm-thread&peer='+encodeURIComponent(username)),async(d,box)=>{
      if(version!==threadVersion)return;box.innerHTML=`<div class="row-head"><h2>${esc(d.peer.username)}</h2><a href="/profile.html?u=${encodeURIComponent(d.peer.username)}">${tr('主页','Profile')} ↗</a></div>${d.peer.username==='灯灯客服'?`<div class="notice" id="support-status"></div>`:''}<div class="messages" aria-label="${tr('消息记录','Message history')}">${d.messages.map(m=>`<div class="bubble ${m.from_player_id===state.session.player.id?'mine':''}"><p>${text(m.content)}</p>${knowledgeLinks(m.knowledge_sources)}<small>${m.replied_by_admin_id?esc(tr('管理员','Admin')+' #'+m.replied_by_admin_id+' · '+(m.reply_author_name||''))+' · ':''}${date(m.created_at)}</small></div>`).join('')||empty()}</div><form id="send-form">${field('content',tr('消息内容','Message'),'textarea')}<div class="actions"><button class="primary">${tr('发送','Send')} ↗</button></div></form>`;$('.messages',box).scrollTop=$('.messages',box).scrollHeight;$('#send-form',box).onsubmit=e=>{
        e.preventDefault();const f=e.currentTarget;action($('button',f),async()=>{
          await post('/api/social?action=dm-send',{
            to_username:d.peer.username,content:$('[name=content]',f).value
          }
          );if(version===threadVersion)await open(username);await loadList();
        }
        );
      }
      ;
      if(d.peer.username==='灯灯客服'){
        const result=await api('/api/support');if(version!==threadVersion||!box.isConnected)return;const ticket=result.ticket,pending=ticket&&['open','in_progress'].includes(ticket.status),bar=$('#support-status',box);
        bar.innerHTML=`<p>${pending?tr('已转人工，自动回复已暂停。你可以继续发送补充说明；工作人员回复会显示姓名与编号。','Human support requested; automatic replies are paused. Send follow-up details here. Staff replies show name and ID.'):tr('灯灯只提供基础指引。不确定的问题可交给工作人员核实。','DengDeng provides basic guidance. Staff can verify questions that need more information.')}</p><div class="actions"><button type="button" id="handoff" ${pending?'disabled':''}>${tr(pending?(ticket.replied_at?'人工服务中':'等待人工处理'):'转人工',pending?(ticket.replied_at?'Human support active':'Awaiting staff'):'Request human support')}</button>${ticket?`<button type="button" id="support-ticket">${tr('查看工单与办理记录','View ticket & history')} #${ticket.id}</button>`:''}<button type="button" id="support-refresh">${tr('刷新回复','Refresh replies')}</button></div>`;
        $('#support-refresh',bar).onclick=e=>action(e.currentTarget,()=>open(username));
        if(ticket)$('#support-ticket',bar).onclick=e=>action(e.currentTarget,()=>viewCitizenTicket(ticket.id));
        $('#handoff',bar).onclick=()=>modal(tr('灯灯转人工','Request human support'),`<p class="wide">${tr('确认后，最近 20 条灯灯对话将作为私密工单交给工作人员。不会公开，也不承诺具体接入时间。','The last 20 DengDeng messages will be shared privately with staff. No response time is guaranteed.')}</p>`+field('reason',tr('需要人工帮助的问题','What do you need help with?'),'textarea','',{maxlength:500}),{label:tr('确认转人工','Confirm request'),submit:async v=>{await post('/api/support',v);await open(username);}});
      }
      await patch('/api/social?action=dm-read&peer='+encodeURIComponent(username));await loadList();
    }
    );
  }
  $('#new-message',el).onclick=()=>modal(tr('新私信','New message'),field('username',tr('收件人游戏 ID','Recipient game ID')),{
    label:tr('打开会话','Open conversation'),submit:async d=>{
      await api('/api/social?action=profile&username='+encodeURIComponent(d.username));await open(d.username);
    }
  }
  );
  $('#ai-message',el).onclick=e=>action(e.currentTarget,async()=>{
    const d=await api('/api/ai-bot');await open(d.username);
  }
  );
  await loadList();
  const u=new URLSearchParams(location.search).get('to');
  if(u)await open(u);
}
