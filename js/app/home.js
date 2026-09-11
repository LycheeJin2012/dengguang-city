import {renderTicketCenter} from './ticket-center.js';
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
  return `<section class="section" id="${id}"><div class="section-head"><h2>${tr(zh,en)}</h2><span class="eyebrow">LIGHT CITY</span></div><div id="${id}-body" class="pane-body"></div></section>`;
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
  el.innerHTML=`<section class="hero-modern" id="home"><div class="hero-text"><p class="eyebrow">WELCOME TO LIGHT CITY</p><h1>${tr('欢迎来到<br>灯光市','Welcome to<br>Light City')}</h1><p>${tr('一座由市民共同建设的 Minecraft 城市。在这里了解市政动态，办理市民事务，记录属于我们的城市生活。','A Minecraft city built together. Discover city news, access citizen services, and take part in our shared story.')}</p><div class="actions"><a class="button primary" href="#notice">${tr('查看市政公告','City announcements')} ↗</a><button id="signin" class="cta-pulse" type="button">🎁 ${tr('每日签到','Check in')}</button></div></div><img src="/assets/backgrounds/bg-pixel-hero.jpg" alt="${tr('灯光市 Minecraft 城市实景','Light City Minecraft panorama')}" loading="eager" style="width:100%;height:100%;min-height:360px;object-fit:cover;border-left:var(--border)"></section><div id="city-stats" class="stat-grid"></div>${section('notice','📜 市政公告','📜 Announcements')}${section('contact','💬 留言与工单','💬 Messages & tickets')}${section('gallery','📸 城市风貌','📸 Around the city')}${section('racing','🏁 赛道与驾照','🏁 Racing & licenses')}${section('hotel','🏨 树上酒店','🏨 Treehouse hotel')}<div class="actions"><a class="button" href="/hotel.html">${tr('查看全部房型','Browse all rooms')} →</a></div>`;
  $('#signin',el).onclick=e=>action(e.currentTarget,signin);
  const bundle=api('/api/homepage-bundle');
  region($('#city-stats',el),()=>bundle,(d,box)=>box.innerHTML=[{value:d.bundle.playerCount??0,zh:'注册市民',en:'Citizens'},{value:'30+',zh:'绿化区块',en:'Green spaces'},{value:'50+',zh:'建筑',en:'Buildings'},{value:'1500+m',zh:'铁路',en:'Railway'},{value:'1000+m',zh:'公路',en:'Roads'},{value:'2023',zh:'建市年份',en:'Founded'}].map(s=>`<div class="stat-tile"><strong>${esc(s.value)}</strong><span>${tr(s.zh,s.en)}</span></div>`).join(''));
  region($('#notice-body',el),()=>api('/api/announcements'),(d,box)=>{
    box.innerHTML=d.announcements.length?`<div class="feature-grid">${d.announcements.map(a=>`<article class="feature-card">${imageUrl(a.image_url)?`<img src="${esc(imageUrl(a.image_url))}" alt="" loading="lazy" style="width:100%;aspect-ratio:16/10;object-fit:cover;border:var(--border-thin);margin-bottom:12px;background:var(--paper-soft)">`:''}<span class="feature-eyebrow">${date(a.created_at)}</span><h3>${esc(a.title)}</h3><p>${text(a.content)}</p></article>`).join('')}</div>`:empty(tr('市政公告将在这里发布','City announcements will appear here'));
  }
  );
  region($('#gallery-body',el),()=>api('/api/gallery'),(d,box)=>{
    const list=d.items||[];box.innerHTML=list.length?`<div class="feature-grid">${list.map(g=>`<article class="feature-card" style="padding:18px"><button class="gallery-button" data-image="${g.id}" style="margin-bottom:12px"><img src="${esc(imageUrl(g.image_url))}" alt="${esc(g.title)}" loading="lazy"></button><h3>${esc(g.title)}</h3></article>`).join('')}</div>`:empty();$$('[data-image]',box).forEach(b=>b.onclick=()=>{
      const g=list.find(g=>g.id===+b.dataset.image);modal(g.title,`<img class="media wide" src="${esc(imageUrl(g.image_url))}" alt="${esc(g.title)}">`,{
        wide:true
      }
      );
    }
    );
  }
  );
  renderTicketCenter($('#contact-body',el));
  region($('#racing-body',el),()=>bundle,(d,box)=>{
    box.innerHTML=`<div class="feature-grid">${[['kart','🛞 卡丁车','🛞 Karting'],['circuit','🏎️ 国际赛车场','🏎️ Circuit'],['license','🚗 驾照考试','🚗 Driving licenses']].map(([k,zh,en])=>`<article class="feature-card"><h3>${tr(zh,en)}</h3><p>${k==='license'?tr('查看考试要求并提交报名。','Read the requirements and apply.') : tr('选择场次和车型，向市政厅提交试跑申请。','Choose your session and vehicle to apply.')}</p><div class="feature-foot"><button data-signup="${k}" class="primary" style="background:var(--green);color:#fff;border:var(--border-thin);box-shadow:2px 2px 0 var(--line);min-height:40px;padding:0.4rem 0.9rem;font:inherit;font-weight:700;cursor:pointer">${tr('报名','Apply')}</button><span class="arrow" aria-hidden="true">→</span></div></article>`).join('')}</div><section class="pane pane-soft" style="margin-top:24px"><div class="pane-head"><div class="heading-block" style="min-width:0"><h3>${tr('赛道信息与考试要求','Tracks and exam requirements')}</h3></div></div><div class="list-rows">${d.bundle.tracks.map(t=>`<div class="row-item"><div class="row-item-head"><h4>${esc(t.name)}</h4><span class="badge active">${t.length_km??'—'} km · 💎 ${t.trial_price} ${tr('/次','/trial')}</span></div></div>`).join('')}${d.bundle.licenseReqs.map(r=>`<div class="row-item"><div class="row-item-head"><h4>${esc(r.title)}</h4></div><p>${text(r.requirements||r.description)}</p></div>`).join('')||''}</div></section>`;$$('[data-signup]',box).forEach(b=>b.onclick=e=>action(e.currentTarget,()=>signup(b.dataset.signup,d.bundle)));
  }
  );
  region($('#hotel-body',el),()=>bundle,(d,box)=>roomCards(box,d.bundle,{
    limit:3
  }
  ));
  if(new URLSearchParams(location.search).get('action')==='login'){
    const {
      login
    }
    =await import('./core.js');
    login();
  }
}
