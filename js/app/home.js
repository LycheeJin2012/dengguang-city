import {createTicket} from './ticket-form.js';
import {
  $, $$, api, post, del, region, tr, esc, text, empty, field, modal, requirePlayer, imageUrl, toast, action, date, state, session, renderAccount
}
from './core.js';
import {
  roomCards
}
from './hotel.js';
function section(id,zh,en){
  return `<section class="section" id="${id}"><div class="section-head"><h2>${tr(zh,en)}</h2><span class="eyebrow">LIGHT CITY</span></div><div id="${id}-body"></div></section>`;
}
export async function signup(kind,bundle){
  const p=await requirePlayer();
  const circuit=kind==='circuit',license=kind==='license';
  let fields='';
  if(circuit){
    const tracks=bundle.tracks.filter(t=>t.is_active);
    if(!tracks.length)throw new Error(tr('目前暂无开放赛道','No open tracks'));
    fields+=field('track_id',tr('赛道','Track'),'select',tracks[0].id,{
      options:tracks.map(t=>[t.id,`${t.name} · 💎${t.trial_price}`])
    }
    )+field('license',tr('驾照等级','License grade'),'select','B',{
      options:['B','A','S']
    }
    );
  }
  if(license)fields+=field('exam_type',tr('考试类型','Exam'),'select','written',{
    options:[['written',tr('笔试','Written')],['road',tr('路考','Road')],['upgrade',tr('升级','Upgrade')]]
  }
  )+field('exam_date',tr('期望日期','Preferred date'),'date','',{
    required:false
  }
  );
  else fields+=field('car',tr('车型','Vehicle'),'text','',{
    required:false
  }
  );
  modal(tr(license?'驾照报名':circuit?'国际试车报名':'卡丁车报名',license?'License application':circuit?'Circuit signup':'Kart signup'),fields+field('session',tr('期望场次','Preferred session'),'text','',{
    required:false
  }
  )+field('name',tr('游戏 ID','Game ID'),'text',p.username)+field('contact',tr('联系方式','Contact'),'text',p.email)+field('note',tr('备注','Notes'),'textarea','',{
    required:false
  }
  ),{
    label:tr('提交报名','Apply'),submit:async d=>{
      await post('/api/'+kind,{
        ...d,exam_session:d.session
      }
      );toast(tr('报名已提交','Application submitted'));
    }
  }
  );
}
export async function signin(){
  await requirePlayer();
  const d=await api('/api/init?action=signin-status');
  modal(tr('每日签到','Daily check-in'),`<div class="wide"><p>${tr('连续签到','Streak')} <b>${d.current_streak}</b> ${tr('天','days')} · 💎 ${d.emeralds}</p><p>${tr('每周签到奖励从 1 到 7 绿宝石递增。','Earn 1 to 7 emeralds per day in a weekly cycle.')}</p>${d.signed_today?`<p class="notice">${tr('今天已经签到，明天再来','Already checked in today')}</p>`:''}</div>`,{
    label:tr('签到','Check in'),submit:d.signed_today?null:async()=>{
      const r=await post('/api/init?action=signin');toast(r.message);await session();renderAccount();
    }
  }
  );
}
async function comments(message){
  const d=modal(tr('留言评论','Comments'),'<div id="comments" class="wide"></div>'+field('content',tr('写评论','Write a comment'),'textarea'),{
    submit:async v=>{
      await requirePlayer();await post('/api/comments',{
        message_id:message.id,content:v.content
      }
      );toast(tr('评论已发表','Comment posted'));
    }
  }
  );
  region($('#comments',d),()=>api('/api/comments?message_id='+message.id),(r,box)=>{
    box.innerHTML=(r.comments||[]).map(c=>`<div class="row"><b>${esc(c.author_name)}</b><p>${text(c.content)}</p><small>${date(c.created_at)}</small></div>`).join('')||empty();
  }
  );
}
export async function render(el){
  el.innerHTML=`<section class="hero" id="home"><div class="hero-copy"><p class="eyebrow">WELCOME TO LIGHT CITY</p><h1>${tr('欢迎来到<br>灯光市','Welcome to<br>Light City')}</h1><p>${tr('一座由市民共同建设的 Minecraft 城市。在这里了解市政动态，办理市民事务，记录属于我们的城市生活。','A Minecraft city built together. Discover city news, access citizen services, and take part in our shared story.')}</p><div class="actions"><a class="button primary" href="#notice">${tr('查看市政公告','City announcements')} ↗</a><button id="signin">🎁 ${tr('每日签到','Check in')}</button></div></div><img src="/assets/backgrounds/bg-pixel-hero.jpg" alt="${tr('灯光市 Minecraft 城市实景','Light City Minecraft panorama')}"></section><div id="city-stats"></div>${section('notice','📜 市政公告','📜 Announcements')}${section('gallery','📸 城市风貌','📸 Around the city')}${section('wall','💬 市民留言墙','💬 Citizen wall')}${section('racing','🏁 赛道与驾照','🏁 Racing & licenses')}${section('hotel','🏨 树上酒店','🏨 Treehouse hotel')}<div class="actions"><a class="button" href="/hotel.html">${tr('查看全部房型','Browse all rooms')} →</a></div>${section('contact','📮 联系市政厅','📮 Contact City Hall')}`;
  $('#signin',el).onclick=e=>action(e.currentTarget,signin);
  const bundle=api('/api/homepage-bundle');
  region($('#city-stats',el),()=>bundle,(d,box)=>box.innerHTML=`<div class="stats"><div class="stat"><strong>${d.bundle.playerCount??0}</strong><span>${tr('注册市民','Citizens')}</span></div><div class="stat"><strong>${d.bundle.hotels.length}</strong><span>${tr('酒店项目','Hotel projects')}</span></div><div class="stat"><strong>${d.bundle.tracks.length}</strong><span>${tr('赛道项目','Track projects')}</span></div><div class="stat"><strong>2026</strong><span>${tr('建市年份','Founded')}</span></div></div>`);
  region($('#notice-body',el),()=>api('/api/announcements'),(d,box)=>{
    box.innerHTML=d.announcements.length?`<div class="cards">${d.announcements.map(a=>`<article class="card">${imageUrl(a.image_url)?`<img src="${esc(imageUrl(a.image_url))}" alt="" loading="lazy">`:''}<small>${date(a.created_at)}</small><h3>${esc(a.title)}</h3><p>${text(a.content)}</p></article>`).join('')}</div>`:empty(tr('市政公告将在这里发布','City announcements will appear here'));
  }
  );
  region($('#gallery-body',el),()=>api('/api/gallery'),(d,box)=>{
    const list=d.items||[];box.innerHTML=list.length?`<div class="cards">${list.map(g=>`<article><button class="gallery-button" data-image="${g.id}"><img src="${esc(imageUrl(g.image_url))}" alt="${esc(g.title)}" loading="lazy"></button><p>${esc(g.title)}</p></article>`).join('')}</div>`:empty();$$('[data-image]',box).forEach(b=>b.onclick=()=>{
      const g=list.find(g=>g.id===+b.dataset.image);modal(g.title,`<img class="media wide" src="${esc(imageUrl(g.image_url))}" alt="${esc(g.title)}">`,{
        wide:true
      }
      );
    }
    );
  }
  );
  const loadWall=()=>region($('#wall-body',el),()=>api('/api/messages?public=1'),(d,box)=>{
    box.innerHTML=(d.messages||[]).map(m=>`<article class="panel"><div class="row-head"><b>${esc(m.name)}</b><small>${date(m.created_at)}</small></div><p>${text(m.content)}</p>${m.admin_reply?`<div class="notice"><b>${tr('市政厅回复','City Hall reply')}</b><p>${text(m.admin_reply)}</p></div>`:''}<button data-comments="${m.id}">${tr('评论','Comments')}</button></article>`).join('')||empty();$$('[data-comments]',box).forEach(b=>b.onclick=()=>comments(d.messages.find(m=>m.id===+b.dataset.comments)));
  }
  );
  loadWall();
  region($('#racing-body',el),()=>bundle,(d,box)=>{
    box.innerHTML=`<div class="cards">${[['kart','🛞 卡丁车','🛞 Karting'],['circuit','🏎️ 国际赛车场','🏎️ Circuit'],['license','🚗 驾照考试','🚗 Driving licenses']].map(([k,zh,en])=>`<article class="card"><h3>${tr(zh,en)}</h3><p>${k==='license'?tr('查看考试要求并提交报名。','Read the requirements and apply.') : tr('选择场次和车型，向市政厅提交试跑申请。','Choose your session and vehicle to apply.')}</p><div class="actions"><button data-signup="${k}" class="primary">${tr('报名','Apply')}</button></div></article>`).join('')}</div><div class="panel" style="margin-top:24px"><h3>${tr('赛道信息与考试要求','Tracks and exam requirements')}</h3>${d.bundle.tracks.map(t=>`<p><b>${esc(t.name)}</b> · ${t.length_km??'—'} km · 💎 ${t.trial_price} ${tr('/次','/trial')}</p>`).join('')}${d.bundle.licenseReqs.map(r=>`<div class="row"><b>${esc(r.title)}</b><p>${text(r.requirements||r.description)}</p></div>`).join('')||''}</div>`;$$('[data-signup]',box).forEach(b=>b.onclick=e=>action(e.currentTarget,()=>signup(b.dataset.signup,d.bundle)));
  }
  );
  region($('#hotel-body',el),()=>bundle,(d,box)=>roomCards(box,d.bundle,{
    limit:3
  }
  ));
  $('#contact-body',el).innerHTML=`<div class="panel"><form id="contact-form"><div class="form-grid">${field('name',tr('游戏 ID','Game ID'),'text',state.session?.player?.username||'')}${field('contact',tr('联系方式','Contact'),'text',state.session?.player?.email||'')}${field('type',tr('事项类型','Category'),'select','建议',{
    options:['建议','投诉','咨询','合作']
  }
  )}${field('content',tr('留言内容','Message'),'textarea')}</div><p class="form-error" role="alert"></p><div class="actions"><button class="primary">${tr('提交留言','Submit message')}</button></div></form></div>`;
  $('#contact-body',el).insertAdjacentHTML('afterbegin',`<div class="notice"><b>${tr('反馈 Bug 或举报违规','Report a bug or misconduct')}</b><p>${tr('需要附图或视频？提交私密工单，材料由管理员处理。','Need to include images or video? Submit a private ticket for administrators.')}</p><div class="actions"><button id="report-bug">${tr('反馈 Bug','Report a bug')}</button><button id="report-misconduct">${tr('举报违规','Report misconduct')}</button></div></div>`);
  $('#report-bug',el).onclick=()=>createTicket({kind:'bug'}).catch(e=>toast(e.message,true));
  $('#report-misconduct',el).onclick=()=>createTicket({kind:'report'}).catch(e=>toast(e.message,true));
  $('#contact-form',el).onsubmit=e=>{
    e.preventDefault();
    const form=e.currentTarget;
    action($('button',form),async()=>{
      await requirePlayer();await post('/api/messages',Object.fromEntries(new FormData(form)));$('[name=content]',form).value='';toast(tr('留言已提交','Message submitted'));await loadWall();
    }
    );
  }
  ;
  if(new URLSearchParams(location.search).get('action')==='login'){
    const {
      login
    }
    =await import('./core.js');
    login();
  }
}
