import {createTicket,viewCitizenTicket} from './ticket-form.js';
import {
  $, $$, api, post, patch, del, region, tr, esc, text, ticketBody, date, status, empty, title, field, modal, action, toast, state, login, download, imageUrl
}
from './core.js';
import {
  parseDate
}
from '../date.js';
import {
  registerPasskey
}
from './security.js';
import {
  signin
}
from './home.js';
export async function render(el){
  const username=new URLSearchParams(location.search).get('u')||state.session?.player?.username;
  if(!username){
    el.innerHTML=title('玩家主页','Citizen profile')+`<div class="panel"><p>${tr('登录后查看你的市民档案','Sign in to view your citizen profile')}</p><button id="profile-login">${tr('登录','Sign in')}</button></div>`;
    $('#profile-login',el).onclick=async()=>{
      await login();
      if(state.session?.player)render(el);
    }
    ;
    return;
  }
  const d=await api('/api/social?action=profile&username='+encodeURIComponent(username)),p=d.profile,self=p.id===state.session?.player?.id;
  const joined=+parseDate(p.created_at);
  const days=Number.isFinite(joined)?Math.max(0,Math.floor((Date.now()-joined)/86400000)):0;
  el.innerHTML=title('市民档案','Citizen profile')+`<section class="panel"><div class="row-head"><div><span class="avatar">${esc(p.avatar_emoji||'👤')}</span><h2>${esc(p.username)}</h2></div><span class="badge">${tr('加入','Joined')} ${days} ${tr('天','days')}</span></div><p>${text(p.bio||tr('这位市民还没有填写简介。','This citizen has not added a bio.'))}</p><small>${tr('注册时间','Registered')} ${date(p.created_at)}</small><div class="stats"><div class="stat"><strong>${d.stats.messages}</strong><span>${tr('留言','Messages')}</span></div><div class="stat"><strong>${d.stats.comments}</strong><span>${tr('评论','Comments')}</span></div></div><div class="actions">${self?`<button id="edit-profile">${tr('编辑资料','Edit profile')}</button><button id="citizen-card">${tr('下载市民卡','Download citizen card')}</button><button id="daily-signin">🎁 ${tr('签到','Check in')}</button>`:`<a class="button" href="/dm.html?to=${encodeURIComponent(p.username)}">${tr('发送私信','Send a message')}</a>`}</div></section>${self?`<div class="tabs section" id="profile-tabs">${[['history','我的记录','My records'],['security','账号安全','Security'],['race','赛道成绩','Race times'],['exam','模拟考试','Practice exam'],['subscriptions','通知订阅','Subscriptions'],['rewards','工单奖励','Ticket rewards']].map(([k,zh,en])=>`<button data-tab="${k}" aria-selected="${k==='history'}">${tr(zh,en)}</button>`).join('')}</div><section id="profile-content" class="panel"></section>`:''}`;
  if(!self)return;
  $('#edit-profile',el).onclick=()=>modal(tr('编辑市民资料','Edit profile'),field('avatar_emoji',tr('头像表情','Avatar emoji'),'text',p.avatar_emoji)+field('bio',tr('个人简介','Bio'),'textarea',p.bio||'',{
    required:false,maxlength:500
  }
  ),{
    submit:async values=>{
      await patch('/api/social?action=me',values);await render(el);
    }
  }
  );
  $('#daily-signin',el).onclick=e=>action(e.currentTarget,signin);
  $('#citizen-card',el).onclick=()=>{
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540"><rect width="900" height="540" fill="#fff8dd"/><rect x="20" y="20" width="860" height="500" fill="none" stroke="#333323" stroke-width="8"/><path d="M20 130H880" stroke="#496a20" stroke-width="8"/><g fill="#496a20" font-family="sans-serif"><text x="60" y="90" font-size="38">LIGHT CITY · 市民身份卡</text><text x="60" y="240" font-size="48">${esc(p.username)}</text><text x="60" y="320" font-size="28">市民编号 / CITIZEN #${p.id}</text><text x="60" y="390" font-size="24">加入日期 / JOINED ${esc(p.created_at.slice(0,10))}</text><text x="60" y="460" font-size="20">Minecraft 城市作品纪念卡 · 非官方身份证件</text></g></svg>`;
    download('light-city-citizen.svg',svg,'image/svg+xml');
  }
  ;
  async function tab(key){
    $$('[data-tab]',el).forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===key));
    const old=$('#profile-content',el),box=document.createElement('section');
    box.id='profile-content';
    box.className='panel';
    old.replaceWith(box);
    await region(box,async()=>key,(k,target)=>({
      history,security,race,exam,subscriptions,rewards
    }
    [k])(target));
  }
  $$('[data-tab]',el).forEach(b=>b.onclick=()=>tab(b.dataset.tab));
  await tab('history');
}
async function history(el){
  const labels=[['messages','我的留言','My messages'],['bookings','酒店预订','Bookings'],['kart','卡丁车报名','Kart signups'],['circuit','国际试车','Circuit signups'],['license','驾照报名','License applications'],['tickets','事务工单','City service tickets']];
  el.innerHTML=labels.map(([k,zh,en])=>`<section class="section"><h3>${tr(zh,en)}</h3><div id="history-${k}"></div></section>`).join('');
  await Promise.all(labels.map(([k])=>region($('#history-'+k,el),()=>api('/api/'+k+'?my=1'),(d,box)=>{
    const rows=d[k]||d.signups||[];box.innerHTML=rows.map(r=>`<div class="row"><div class="row-head"><b>${esc(r.room_name||r.title||r.exam_type||r.session||'#'+r.id)}</b>${status(r.status)}</div><div>${r.body?ticketBody(r.body):text(r.content||r.note||'')}</div>${r.admin_reply?`<div class="notice">${text(r.admin_reply)}</div>`:''}${r.in_date?`<p>${esc(r.in_date)} → ${esc(r.out_date)}</p>`:''}<small>${date(r.created_at)}</small>${k==='tickets'?`<div class="actions"><button data-ticket="${esc(r.id)}">${tr('查看详情 / 补充材料','Details / add attachments')} ${r.attachment_count?'📎 '+r.attachment_count:''}</button></div>`:''}</div>`).join('')||empty();$$('[data-ticket]',box).forEach(button=>button.onclick=()=>viewCitizenTicket(button.dataset.ticket,{onChanged:()=>history(el)}).catch(e=>toast(e.message,true)));
  }
  )));
  el.insertAdjacentHTML('beforeend',`<button id="service-ticket">${tr('提交服务工单','Create service ticket')}</button>`);
  $('#service-ticket',el).onclick=()=>createTicket({onCreated:()=>history(el)}).catch(e=>toast(e.message,true));
}
async function security(el){
  el.innerHTML=`<h3>${tr('密码与通行密钥','Passwords and passkeys')}</h3><p>${tr('使用 Touch ID、Face ID 或设备 PIN 安全登录。','Sign in using Touch ID, Face ID, or your device PIN.')}</p><div class="actions"><button id="password-change">${tr('修改密码','Change password')}</button><button id="add-passkey">＋ ${tr('添加通行密钥','Add passkey')}</button></div><div id="keys" class="section"></div>`;
  $('#password-change',el).onclick=()=>modal(tr('修改市民密码','Change citizen password'),field('old_password',tr('原密码','Current password'),'password')+field('new_password',tr('新密码','New password'),'password')+field('confirm',tr('确认新密码','Confirm password'),'password'),{
    submit:async d=>{
      if(d.new_password!==d.confirm)throw new Error(tr('两次密码不一致','Passwords do not match'));await post('/api/init?action=player-change-password',d);toast(tr('密码已修改','Password changed'));
    }
  }
  );
  $('#add-passkey',el).onclick=()=>modal(tr('添加通行密钥','Add passkey'),field('name',tr('设备名称','Device name'),'text','My device'),{
    submit:async d=>{
      await registerPasskey(d.name);await security(el);
    }
  }
  );
  await region($('#keys',el),()=>post('/api/init?action=passkey-list'),(d,box)=>{
    box.innerHTML=(d.passkeys||[]).map(k=>`<div class="row row-head"><span>🔑 ${esc(k.name)} <small>${date(k.created_at)}</small></span><button data-delete="${k.id}" class="danger">${tr('移除','Remove')}</button></div>`).join('')||empty(tr('还没有通行密钥','No passkeys yet'));$$('[data-delete]',box).forEach(b=>b.onclick=e=>action(e.currentTarget,async()=>{
      if(confirm(tr('移除此通行密钥？','Remove this passkey?'))){
        await post('/api/init?action=passkey-delete',{
          id:+b.dataset.delete
        }
        );await security(el);
      }
    }
    ));
  }
  );
}
async function race(el){
  const b=await api('/api/homepage-bundle');
  const tracks=b.bundle.tracks.filter(t=>t.is_active);
  el.innerHTML=`<h3>${tr('我的赛道成绩','My race times')}</h3><button id="report-race" ${tracks.length?'':'disabled'}>＋ ${tr('上报成绩','Report time')}</button><div id="race-history" class="section"></div><h3>${tr('赛道排行榜','Track leaderboard')}</h3>${field('track',tr('赛道','Track'),'select',tracks[0]?.id,{
    options:tracks.map(t=>[t.id,t.name])
  }
  )}<div id="race-board" class="section"></div>`;
  $('#report-race',el).onclick=()=>modal(tr('上报圈速','Report lap time'),field('track_id',tr('赛道','Track'),'select',tracks[0].id,{
    options:tracks.map(t=>[t.id,t.name])
  }
  )+field('time',tr('圈速（分:秒.毫秒）','Time (m:ss.mmm)'),'text','1:23.456')+field('kart_name',tr('车型','Vehicle'),'text','',{
    required:false
  }
  )+field('license_grade',tr('驾照','License'),'select','B',{
    options:['B','A','S']
  }
  ),{
    submit:async d=>{
      const m=/^(\d+):([0-5]\d)\.(\d{3})$/.exec(d.time);if(!m)throw new Error(tr('时间格式应为 1:23.456','Use the format 1:23.456'));await post('/api/race-times',{
        ...d,time_ms:(+m[1]*60 + +m[2])*1000 + +m[3]
      }
      );await race(el);
    }
  }
  );
  region($('#race-history',el),()=>api('/api/race-times?my=1'),(d,box)=>box.innerHTML=d.times.map(r=>`<div class="row">${esc(r.track_name)} · <b>${esc(r.formatted)}</b> ${tr(r.verified?'已认证':'待认证',r.verified?'Verified':'Unverified')}</div>`).join('')||empty());
  const board=()=>region($('#race-board',el),()=>api('/api/race-times?track_id='+$('[name=track]',el).value),(d,box)=>box.innerHTML=d.leaderboard.map(r=>`<div class="rank"><strong>${r.rank}</strong><span>${esc(r.player_username)}</span><b>${esc(r.formatted)}</b></div>`).join('')||empty());
  $('[name=track]',el).onchange=board;
  if(tracks.length)await board();
}
async function exam(el){
  el.innerHTML=`<h3>${tr('驾照模拟考试','Practice driving test')}</h3><div class="actions">${['B','A','S'].map(g=>`<button data-grade="${g}">${g} ${tr('级练习','practice')}</button>`).join('')}</div><div id="quiz" class="section"></div><h3>${tr('错题本','Mistake notebook')}</h3><div id="wrong"></div>`;
  await region($('#wrong',el),()=>api('/api/exam-questions?my=1'),(d,box)=>box.innerHTML=d.wrong_book.map(q=>`<div class="row">${esc(q.grade)} · ${esc(q.question)}</div>`).join('')||empty());
  let version=0;
  $$('[data-grade]',el).forEach(b=>b.onclick=async()=>{
    const ticket=++version;await region($('#quiz',el),()=>api('/api/exam-questions?grade='+b.dataset.grade+'&limit=5&random=1'),(d,box)=>{
      let index=0,score=0;function next(){
        if(ticket!==version)return;const q=d.questions[index];if(!q){
          box.innerHTML=`<div class="notice">${tr('本轮完成','Complete')} · ${score}/${d.questions.length}</div>`;return;
        }
        let opts=q.options||[];if(q.q_type==='judge')opts=[tr('正确','True'),tr('错误','False')];box.innerHTML=`<p>${index+1}/${d.questions.length} · ${q.q_type==='multi'?tr('多选','Multiple answers'):tr('单选','Single answer')}</p><h3>${esc(q.question)}</h3><form id="answer">${opts.map((o,i)=>`<label class="field check"><input type="${q.q_type==='multi'?'checkbox':'radio'}" name="answer" value="${q.q_type==='judge'?['true','false'][i]:String.fromCharCode(65+i)}">${esc(o)}</label>`).join('')}<div class="actions"><button class="primary">${tr('提交答案','Submit answer')}</button></div></form><div id="answer-result"></div>`;$('#answer',box).onsubmit=e=>{
          e.preventDefault();const form=e.currentTarget,chosen=new FormData(form).getAll('answer');if(!chosen.length)return toast(tr('请先选择答案','Select an answer'),true);action($('button',form),async()=>{
            const r=await post('/api/exam-questions/answer',{
              question_id:q.id,answer:chosen.join('|')
            }
            );if(ticket!==version)return;if(r.is_correct)score++;form.remove();$('#answer-result',box).innerHTML=`<p class="notice">${tr(r.is_correct?'回答正确':'回答错误',r.is_correct?'Correct':'Incorrect')} · ${esc(r.correct_answer)}</p><p>${text(r.explanation)}</p><button id="next-question">${tr('下一题','Next')}</button>`;$('#next-question',box).onclick=()=>{
              index++;next();
            }
            ;
          }
          );
        }
        ;
      }
      if(d.questions.length)next();else box.innerHTML=empty(tr('此等级暂未发布题目','No questions for this grade'));
    }
    );
  }
  );
}
async function subscriptions(el){
  const d=await api('/api/subscriptions?my=1');
  const labels=[['announcement','市政公告','Announcements'],['reply','我的留言回复','Replies to my messages'],['dm','新私信','New messages']];
  el.innerHTML=`<h3>${tr('站内通知订阅','Site notification subscriptions')}</h3>${labels.map(([type,zh,en])=>{
    const s=d.subscriptions.find(s=>s.type===type&&s.enabled);return `<div class="row row-head"><span>${tr(zh,en)}</span><button data-type="${type}" data-id="${s?.id||''}">${tr(s?'取消订阅':'订阅',s?'Unsubscribe':'Subscribe')}</button></div>`;
  }
  ).join('')}`;
  $$('[data-type]',el).forEach(b=>b.onclick=e=>action(e.currentTarget,async()=>{
    if(b.dataset.id)await del('/api/subscriptions?id='+b.dataset.id);else await post('/api/subscriptions',{
      type:b.dataset.type,channel:'site'
    }
    );await subscriptions(el);
  }
  ));
}

async function rewards(el){await region(el,()=>api('/api/rewards?my=1'),(d,box)=>{box.innerHTML=`<h3>${tr('工单办理奖励','Ticket handling rewards')}</h3>${d.rewards.map(r=>`<div class="row"><b>+${r.amount} 💎</b> · ${tr('工单','Ticket')} #${esc(r.ticket_ref)}<p>${tr('承办管理员','Handler')} #${r.admin_id} · ${date(r.paid_at||r.created_at)}</p></div>`).join('')||empty()}`;});}
