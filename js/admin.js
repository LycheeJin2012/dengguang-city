/* 灯光市 v16.3 · 管理后台（API 版） */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fmt=iso=>{if(!iso)return'—';const d=new Date(iso);const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())};
const STATUS_LABEL={pending:'待审批',active:'已激活',rejected:'已拒绝'};
const EXAM_LABEL={written:'B 级笔试',road:'A 级路考',upgrade:'S 级升级'};
const EXAM_BADGE={pending:'待审',passed:'✓ 通过',failed:'✗ 未通过'};

async function api(m,p,b){
  const o={method:m,credentials:'include'};
  if(b!==undefined){o.headers={'Content-Type':'application/json'};o.body=JSON.stringify(b);}
  const r=await fetch(p,o);
  const d=await r.json().catch(()=>({ok:false,error:'非 JSON'}));
  if(!r.ok)throw new Error(d.error||'HTTP '+r.status);
  return d||{};
}
const GET=(p)=>api('GET',p);
const POST=(p,b)=>api('POST',p,b);
const PATCH=(p,b)=>api('PATCH',p,b);
const DEL=(p)=>api('DELETE',p);

const showView=n=>{$('#view-login').style.display=n==='dash'?'none':'';$('#view-dash').style.display=n==='dash'?'':'none';};

async function boot(){
  try{
    const d=await GET('/api/login');
    if(d.ok&&d.user&&d.role&&d.role!=='player'){window._me=d.user;renderDash();}
    else showView('login');
  }catch(e){const el=$('#loginError');if(el)el.textContent='启动失败: '+e.message;showView('login');}
}

async function doLogin(){
  const errEl=$('#loginError');if(errEl)errEl.textContent='';
  const u=$('#loginUser').value.trim(),p=$('#loginPass').value;
  if(!u||!p){if(errEl)errEl.textContent='请输入账号和密码';return;}
  try{
    const d=await api('POST','/api/login',{username:u,password:p});
    if(!d.ok)throw new Error(d.error||'登录失败');
    if(d.role==='player')throw new Error('这是玩家账号');
    const me=await GET('/api/login');
    window._me=me.user;
    $('#loginUser').value='';$('#loginPass').value='';
    renderDash();
  }catch(err){if(errEl)errEl.textContent='登录失败: '+err.message;}
}
window.adminDoLogin=doLogin;

async function renderMessages(){
  try{
    const d=await GET('/api/admin/messages');
    const all=d.messages||[];
    const cAll=all.length,cNew=all.filter(m=>m.status==='new').length;
    $('#cntAll').textContent=cAll;$('#cntUnread').textContent=cNew;$('#cntRead').textContent=cAll-cNew;
    $('#msgUnread').textContent=cNew>0?`(${cNew})`:'';
    const f=document.querySelector('input[name="msgFilter"]:checked');
    const filter=f?f.value:'all';
    let list=all;
    if(filter==='unread')list=list.filter(m=>m.status==='new');
    if(filter==='read')list=list.filter(m=>m.status!=='new');
    const box=$('#msgList'),empty=$('#msgEmpty');
    if(!list.length){box.innerHTML='';empty.style.display='';return;}
    empty.style.display='none';
    box.innerHTML=list.map(m=>{
      const hasReply=m.admin_reply&&m.admin_reply.length>0;
      return `<article class="msg-item ${m.status!=='new'?'is-read':''}" data-id="${m.id}">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">👤 ${esc(m.name)}${m.contact?' · '+esc(m.contact):''}</b>
          ${m.player_username?`<span class="msg-player-tag">@${esc(m.player_username)}</span>`:''}
          ${m.status==='done'?'<span class="msg-read-tag">已处理</span>':m.status!=='new'?'<span class="msg-read-tag">已读</span>':'<span class="msg-unread-tag">新</span>'}
          ${hasReply?'<span class="msg-replied-tag">💬 已回复</span>':''}
        </div><div class="msg-time">${fmt(m.created_at)}</div></div>
        <div class="msg-content">${esc(m.content)}</div>
        ${hasReply?`<div class="msg-reply-box"><b>📣 市政厅回复：</b><div>${esc(m.admin_reply)}</div><small>${fmt(m.replied_at)}</small></div>`:''}
        <div class="msg-actions book-actions">
          <button class="btn btn-primary btn-sm" data-act="reply">${hasReply?'✎ 编辑回复':'💬 回复'}</button>
          ${m.status==='done'?'':`<button class="btn btn-ghost btn-sm" data-act="done">标为已处理</button>`}
          <button class="btn btn-ghost btn-sm" data-act="toggle">${m.status!=='new'&&m.status!=='done'?'标为未读':'标为已读'}</button>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el=>{
      const id=+el.dataset.id;
      el.querySelector('[data-act="reply"]').onclick=()=>openReply(id);
      el.querySelector('[data-act="done"]')?.addEventListener('click',()=>msgAction(id,'done'));
      el.querySelector('[data-act="toggle"]').onclick=()=>msgToggle(id);
      el.querySelector('[data-act="del"]').onclick=()=>msgDel(id);
    });
  }catch(e){console.error(e);}
}

async function msgAction(id,status){
  try{await PATCH('/api/admin/messages?id='+id+'&status='+status);renderMessages();}
  catch(e){alert('失败: '+e.message);}
}
async function msgToggle(id){
  try{const d=await GET('/api/admin/messages');const m=(d.messages||[]).find(x=>x.id===id);if(!m)return;
    const next=m.status==='new'?'read':'new';
    await PATCH('/api/admin/messages?id='+id+'&status='+next);renderMessages();
  }catch(e){alert('失败: '+e.message);}
}
async function msgDel(id){
  if(!confirm('删除该留言？'))return;
  try{await DEL('/api/admin/messages?id='+id);renderMessages();}
  catch(e){alert('失败: '+e.message);}
}
function openReply(id){
  GET('/api/admin/messages').then(d=>{
    const m=(d.messages||[]).find(x=>x.id===id);if(!m)return;
    showReplyModal(m);
  });
}

function showReplyModal(m){
  // 关掉旧模态
  const old=document.getElementById('replyModalBackdrop');
  if(old)old.remove();

  const bd=document.createElement('div');
  bd.id='replyModalBackdrop';
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  const fmtDate=s=>{try{return new Date(s*1000).toLocaleString('zh-CN',{hour12:false});}catch(_){return String(s||'');}};
  const context=m.content?`<div style="background:rgba(255,255,255,.06);border-left:3px solid #6cf;padding:8px 10px;border-radius:4px;margin-bottom:10px;font-size:13px;line-height:1.5;max-height:120px;overflow:auto;white-space:pre-wrap;">${esc(m.content)}</div>`:'';
  const contact=m.contact?`<div style="color:#aaa;font-size:12px;margin-bottom:8px;">📇 联系方式：${esc(m.contact)}</div>`:'';
  const nameTag=m.name?`<div style="color:#6cf;font-size:13px;margin-bottom:6px;">👤 ${esc(m.name)} <span style="color:#888;">· ${fmtDate(m.created_at)}</span></div>`:'';

  bd.innerHTML=`
    <div style="background:#1a1a2e;border:2px solid #6cf;border-radius:8px;padding:18px;max-width:560px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 10px;color:#6cf;font-size:16px;">💬 回复留言 #${m.id}</h3>
      ${nameTag}
      ${contact}
      ${context}
      <div style="position:relative;margin-bottom:8px;">
        <textarea id="replyText" placeholder="输入回复内容…" style="width:100%;min-height:140px;padding:10px;border-radius:4px;border:1px solid #444;background:#0f0f1a;color:#eee;font-family:inherit;font-size:14px;line-height:1.5;resize:vertical;box-sizing:border-box;">${esc(m.admin_reply||'')}</textarea>
        <div id="aiDraftStatus" style="position:absolute;top:6px;right:8px;font-size:12px;color:#888;"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        <button id="aiDraftBtn" type="button" style="background:#3a2;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:13px;">🤖 AI 草稿</button>
        <span style="flex:1;"></span>
        <button id="replyCancel" type="button" style="background:#555;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:13px;">取消</button>
        <button id="replyClear" type="button" style="background:#a33;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:13px;">清空</button>
        <button id="replySave" type="button" style="background:#6cf;color:#000;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px;">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(bd);

  const ta=bd.querySelector('#replyText');
  const status=bd.querySelector('#aiDraftStatus');
  const aiBtn=bd.querySelector('#aiDraftBtn');
  const close=()=>bd.remove();
  bd.addEventListener('click',e=>{if(e.target===bd)close();});

  bd.querySelector('#replyCancel').onclick=close;
  bd.querySelector('#replyClear').onclick=()=>{ta.value='';ta.focus();};
  bd.querySelector('#replySave').onclick=()=>{
    const trimmed=ta.value.trim();
    if(!trimmed){if(!confirm('清空回复？（点确定 = 清空，点取消 = 继续编辑）'))return;}
    PATCH('/api/admin/messages?id='+m.id,{admin_reply:trimmed}).then(()=>{close();renderMessages();}).catch(e=>alert('保存失败: '+e.message));
  };

  aiBtn.onclick=async()=>{
    if(!m.content){alert('留言内容为空，无法生成草稿');return;}
    aiBtn.disabled=true;
    status.textContent='✍️ 生成中…';
    status.style.color='#fa3';
    try{
      const r=await fetch('/api/admin/messages?action=ai-draft',{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message:m.content.slice(0,100),history:[]}),
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data.error){
        status.textContent='❌ '+ (data.error||('HTTP '+r.status));
        status.style.color='#f66';
        return;
      }
      ta.value=data.draft||'';
      ta.focus();
      status.textContent='✅ 已生成 ('+(data.model||'AI')+')';
      status.style.color='#6f6';
      setTimeout(()=>{status.textContent='';},3000);
    }catch(e){
      status.textContent='❌ '+e.message;
      status.style.color='#f66';
    }finally{
      aiBtn.disabled=false;
    }
  };

  setTimeout(()=>ta.focus(),50);
}

async function renderPlayers(){
  try{
    const d=await GET('/api/admin/players');
    const list=d.players||[];
    const cP=list.filter(p=>p.status==='pending').length;
    const cA=list.filter(p=>p.status==='active').length;
    const cR=list.filter(p=>p.status==='rejected').length;
    $('#cntPlayerPending').textContent=cP;$('#cntPlayerActive').textContent=cA;
    $('#cntPlayerRejected').textContent=cR;$('#cntPlayerAll').textContent=list.length;
    $('#playerPending').textContent=cP>0?`(${cP})`:'';
    const f=document.querySelector('input[name="playerFilter"]:checked');
    const filter=f?f.value:'pending';
    let shown=list;
    if(filter!=='all')shown=shown.filter(p=>p.status===filter);
    const box=$('#playerList'),empty=$('#playerEmpty');
    if(!shown.length){box.innerHTML='';empty.style.display='';return;}
    empty.style.display='none';
    const isSuper=window._me&&window._me.role==='super';
    box.innerHTML=shown.map(p=>{
      const isPending=p.status==='pending';
      const isActive=p.status==='active';
      const isRejected=p.status==='rejected';
      return `<article class="msg-item" data-id="${p.id}">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">${esc(p.avatar_emoji||'👤')} ${esc(p.username)}</b>
          <span style="color:var(--c-stone-dark);font-size:12px;margin-left:6px">${esc(p.email)}</span>
          <span class="msg-player-tag">${STATUS_LABEL[p.status]||p.status}</span>
        </div><div class="msg-time">${fmt(p.created_at)}</div></div>
        <p class="msg-content" style="font-size:13px;color:var(--c-stone-dark)">${p.bio?esc(p.bio):'<i>暂无简介</i>'}</p>
        <div class="msg-actions book-actions">
          ${isPending?`<button class="btn btn-primary btn-sm" data-act="approve">✓ 批准</button><button class="btn btn-ghost btn-sm btn-danger" data-act="reject">✗ 拒绝</button>`:''}
          ${!isPending?`<button class="btn btn-ghost btn-sm" data-act="reset-pw">🔑 ${isActive?'重置':'重置'}密码</button>`:''}
          ${isActive?`<button class="btn btn-ghost btn-sm btn-danger" data-act="reject">✗ 改为拒绝</button>`:''}
          ${isRejected?`<button class="btn btn-ghost btn-sm" data-act="approve">↻ 改为批准</button>`:''}
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el=>{
      const id=+el.dataset.id;
      el.querySelector('[data-act="approve"]')?.addEventListener('click',()=>playerAction(id,'approve'));
      el.querySelector('[data-act="reject"]')?.addEventListener('click',()=>playerAction(id,'reject'));
      el.querySelector('[data-act="reset-pw"]')?.addEventListener('click',()=>playerResetPw(id));
    });
  }catch(e){console.error(e);}
}
async function playerAction(id,act){
  const msg=act==='approve'?'批准该玩家注册？':'拒绝该玩家注册？';
  if(!confirm(msg))return;
  try{await PATCH('/api/admin/players?id='+id+'&action='+act);renderPlayers();}
  catch(e){alert('失败: '+e.message);}
}
async function playerResetPw(id){
  const np=prompt('新密码（至少 8 位）：','');
  if(!np)return;
  if(np.length<8){alert('密码至少 8 位');return;}
  try{await PATCH('/api/admin/players?id='+id+'&action=reset',{new_password:np});alert('密码已重置');}
  catch(e){alert('失败: '+e.message);}
}

async function renderBookings(){
  try{
    const d=await GET('/api/admin/bookings');
    const list=d.bookings||[];
    const cP=list.filter(b=>b.status==='pending').length;
    const cC=list.filter(b=>b.status==='confirmed').length;
    const cD=list.filter(b=>b.status==='completed').length;
    $('#bookCntAll').textContent=list.length;$('#bookCntPending').textContent=cP;
    $('#bookCntConfirmed').textContent=cC;$('#bookCntCompleted').textContent=cD;
    $('#bookPending').textContent=cP>0?`(${cP})`:'';
    const box=$('#bookList'),empty=$('#bookEmpty');
    if(!list.length){box.innerHTML='';empty.style.display='';return;}
    empty.style.display='none';
    box.innerHTML=list.map(b=>{
      const opts=['pending','confirmed','checked_in','completed','cancelled']
        .map(s=>`<option value="${s}" ${s===b.status?'selected':''}>${({pending:'待处理',confirmed:'已确认',checked_in:'已入住',completed:'已完成',cancelled:'已取消'})[s]}</option>`).join('');
      return `<article class="msg-item" data-id="${b.id}">
        <div class="msg-head"><div class="msg-head-left">
          <span class="msg-type type-book">${esc(b.room_name||b.room_id)}</span>
          <b class="msg-name">👤 ${esc(b.name)} · ${esc(b.contact)}</b>
          <span class="book-status">${esc(b.status)}</span>
        </div><div class="msg-time">${fmt(b.created_at)}</div></div>
        <div class="book-detail">
          <div>📅 ${esc(b.in_date)} → ${esc(b.out_date)}</div>
          <div>🌙 ${b.nights} 晚 · 👥 ${b.persons} 人${b.breakfast?' · 🍳 含早餐':''}</div>
          ${b.note?`<div>📝 ${esc(b.note)}</div>`:''}
        </div>
        <div class="msg-actions book-actions">
          <select class="book-status-sel">${opts}</select>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el=>{
      const id=+el.dataset.id;
      el.querySelector('.book-status-sel').onchange=(e)=>bookStatus(id,e.target.value);
      el.querySelector('[data-act="del"]').onclick=()=>bookDel(id);
    });
  }catch(e){console.error(e);}
}
async function bookStatus(id,s){
  try{await PATCH('/api/admin/bookings?id='+id+'&status='+s);renderBookings();}
  catch(e){alert('失败: '+e.message);}
}
async function bookDel(id){
  if(!confirm('删除该订单？'))return;
  try{await DEL('/api/admin/bookings?id='+id);renderBookings();}
  catch(e){alert('失败: '+e.message);}
}

async function renderLicense(){
  try{
    const d=await GET('/api/admin/license');
    const list=d.signups||[];
    const cP=list.filter(x=>x.status==='pending').length;
    const cPa=list.filter(x=>x.status==='passed').length;
    const cF=list.filter(x=>x.status==='failed').length;
    $('#cntLicPending').textContent=cP;$('#cntLicPassed').textContent=cPa;
    $('#cntLicFailed').textContent=cF;$('#cntLicAll').textContent=list.length;
    $('#licensePending').textContent=cP>0?`(${cP})`:'';
    const f=document.querySelector('input[name="licenseFilter"]:checked');
    const filter=f?f.value:'pending';
    let shown=list;if(filter!=='all')shown=shown.filter(x=>x.status===filter);
    const box=$('#licenseList'),empty=$('#licenseEmpty');
    if(!shown.length){box.innerHTML='';empty.style.display='';return;}
    empty.style.display='none';
    box.innerHTML=shown.map(x=>`<article class="msg-item" data-id="${x.id}">
      <div class="msg-head"><div class="msg-head-left">
        <b class="msg-name">${esc(x.player_username||'?')}</b>
        <span style="color:var(--c-stone-dark);font-size:12px;margin-left:6px">${esc(x.contact||'')}</span>
        <span class="msg-player-tag">${EXAM_LABEL[x.exam_type]||x.exam_type}</span>
        <span class="book-status">${EXAM_BADGE[x.status]||x.status}</span>
      </div><div class="msg-time">${fmt(x.created_at)}</div></div>
      ${x.note?`<div class="msg-content" style="font-size:13px">📝 ${esc(x.note)}</div>`:''}
      <div class="msg-actions book-actions">
        ${x.status==='pending'?`<button class="btn btn-primary btn-sm" data-act="pass">✓ 通过</button><button class="btn btn-ghost btn-sm btn-danger" data-act="fail">✗ 不通过</button>`:''}
        <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
      </div>
    </article>`).join('');
    box.querySelectorAll('.msg-item').forEach(el=>{
      const id=+el.dataset.id;
      el.querySelector('[data-act="pass"]')?.addEventListener('click',()=>licAction(id,'pass'));
      el.querySelector('[data-act="fail"]')?.addEventListener('click',()=>licAction(id,'fail'));
      el.querySelector('[data-act="del"]')?.addEventListener('click',()=>licDel(id));
    });
  }catch(e){console.error(e);}
}
async function licAction(id,act){
  const note=prompt(act==='pass'?'评语（可空）：':'不通过原因：','')||'';
  try{await PATCH('/api/admin/license?id='+id,{result:act,result_note:note});renderLicense();}
  catch(e){alert('失败: '+e.message);}
}
async function licDel(id){
  if(!confirm('删除该报名？'))return;
  try{await DEL('/api/admin/license?id='+id);renderLicense();}
  catch(e){alert('失败: '+e.message);}
}

async function renderKarts(){
  try{
    const d=await GET('/api/admin/kart');
    const list=d.signups||[];
    $('#kartCntAll').textContent=list.length;
    $('#kartCntPending').textContent=list.filter(x=>x.status==='pending').length;
    $('#kartCntApproved').textContent=list.filter(x=>x.status==='approved').length;
    $('#kartCntRejected').textContent=list.filter(x=>x.status==='rejected').length;
    const box=$('#kartList'),empty=$('#kartEmpty');
    if(!list.length){box.innerHTML='';empty.style.display='';return;}
    empty.style.display='none';
    box.innerHTML=list.map(k=>{
      const opts=['pending','approved','rejected']
        .map(s=>`<option value="${s}" ${s===k.status?'selected':''}>${({pending:'待审核',approved:'已批准',rejected:'已拒绝'})[s]}</option>`).join('');
      return `<article class="msg-item" data-id="${k.id}">
        <div class="msg-head"><div class="msg-head-left">
          <span class="msg-type type-book">🏁 赛道报名</span>
          <b class="msg-name">👤 ${esc(k.name)} · ${esc(k.contact)}</b>
          <span class="book-status">${esc(k.status)}</span>
          ${k.car?`<span class="gallery-num">车号 #${esc(k.car)}</span>`:''}
        </div><div class="msg-time">${fmt(k.created_at)}</div></div>
        <div class="msg-actions book-actions">
          <select class="book-status-sel">${opts}</select>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el=>{
      const id=el.dataset.id;
      el.querySelector('.book-status-sel').onchange=(e)=>kartStatus(id,e.target.value);
      el.querySelector('[data-act="del"]').onclick=()=>kartDel(id);
    });
  }catch(e){console.error(e);}
}
async function kartStatus(id,s){
  try{await PATCH('/api/admin/kart?id='+id,{status:s});renderKarts();}
  catch(e){alert('失败: '+e.message);}
}
async function kartDel(id){
  if(!confirm('删除该报名？'))return;
  try{await DEL('/api/admin/kart?id='+id);renderKarts();}
  catch(e){alert('失败: '+e.message);}
}

async function renderCircuits(){
  try{
    const d=await GET('/api/admin/circuit');
    const list=d.signups||[];
    $('#circuitCntAll').textContent=list.length;
    $('#circuitCntPending').textContent=list.filter(x=>x.status==='pending').length;
    $('#circuitCntApproved').textContent=list.filter(x=>x.status==='approved').length;
    $('#circuitCntRejected').textContent=list.filter(x=>x.status==='rejected').length;
    const box=$('#circuitList'),empty=$('#circuitEmpty');
    if(!list.length){box.innerHTML='';empty.style.display='';return;}
    empty.style.display='none';
    box.innerHTML=list.map(c=>{
      const opts=['pending','approved','rejected']
        .map(s=>`<option value="${s}" ${s===c.status?'selected':''}>${({pending:'待审核',approved:'已批准',rejected:'已拒绝'})[s]}</option>`).join('');
      return `<article class="msg-item" data-id="${c.id}">
        <div class="msg-head"><div class="msg-head-left">
          <span class="msg-type type-book">🏎️ 国际赛车场</span>
          <b class="msg-name">👤 ${esc(c.name)} · ${esc(c.contact)}</b>
          <span class="book-status">${esc(c.status)}</span>
          ${c.license?`<span class="gallery-num">${esc(c.license)}</span>`:''}
        </div><div class="msg-time">${fmt(c.created_at)}</div></div>
        <div class="msg-actions book-actions">
          <select class="book-status-sel">${opts}</select>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el=>{
      const id=el.dataset.id;
      el.querySelector('.book-status-sel').onchange=(e)=>circuitStatus(id,e.target.value);
      el.querySelector('[data-act="del"]').onclick=()=>circuitDel(id);
    });
  }catch(e){console.error(e);}
}
async function circuitStatus(id,s){
  try{await PATCH('/api/admin/circuit?id='+id,{status:s});renderCircuits();}
  catch(e){alert('失败: '+e.message);}
}
async function circuitDel(id){
  if(!confirm('删除该报名？'))return;
  try{await DEL('/api/admin/circuit?id='+id);renderCircuits();}
  catch(e){alert('失败: '+e.message);}
}

async function renderAdminList(){
  try{
    const d=await GET('/api/admin/admins');
    const list=d.admins||[];
    const me=window._me;
    if(!me)return;
    const box=$('#adminList');
    if(!list.length){box.innerHTML='<p class="empty-state">暂无管理员</p>';return;}
    box.innerHTML=list.map(a=>{
      const isMe=a.username===me.username;
      const canDel=me.role==='super'&&!isMe;
      return `<article class="admin-item" data-id="${esc(String(a.id))}">
        <div class="admin-avatar">${a.role==='super'?'🛡️':'👤'}</div>
        <div class="admin-meta">
          <b>${esc(a.username)} ${isMe?'<span class="me-tag">我</span>':''}</b>
          <span class="role-tag role-${a.role}">${a.role==='super'?'SUPER':'ADMIN'}</span>
        </div>
        <div class="admin-actions">
          ${me.role==='super'?`<button class="btn btn-ghost btn-sm" data-act="reset">${isMe?'修改密码':'重置密码'}</button>`:''}
          ${canDel?`<button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>`:''}
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.admin-item').forEach(el=>{
      const id=el.dataset.id;
      el.querySelector('[data-act="reset"]')?.addEventListener('click',()=>adminReset(id));
      el.querySelector('[data-act="del"]')?.addEventListener('click',()=>adminDel(id));
    });
  }catch(e){if(String(e).indexOf('403')>0){$('#adminList').innerHTML='<p class="empty-state">仅 super 可查看</p>';}}
}
async function adminReset(id){
  const np=prompt('新密码（至少 8 位）：','');if(!np)return;
  if(np.length<8){alert('至少 8 位');return;}
  try{await PATCH('/api/admin/admins?id='+id,{new_password:np});alert('已重置');}
  catch(e){alert('失败: '+e.message);}
}
async function adminDel(id){
  if(!confirm('删除该管理员？'))return;
  try{await DEL('/api/admin/admins?id='+id);renderAdminList();}
  catch(e){alert('失败: '+e.message);}
}

async function safeRender(fn){try{await fn();}catch(e){console.error(e);}}
function renderDash(){
  try{
    const a=window._me;
    $('#userName').textContent=a.username;
    const r=$('#userRole');
    r.textContent=a.role==='super'?'SUPER':'ADMIN';
    r.className='role-tag role-'+a.role;
    const ba=$('#btnAddAdmin');
    if(ba)ba.style.display=a.role==='super'?'':'none';
  }catch(e){console.error(e);}
  showView('dash');
  safeRender(renderMessages);
  safeRender(renderPlayers);
  safeRender(renderBookings);
  safeRender(renderLicense);
  safeRender(renderKarts);
  safeRender(renderCircuits);
  safeRender(renderAdminList);
}

// tab 切换
$$('.admin-tabs .tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const t=btn.dataset.tab;
    $$('.admin-tabs .tab').forEach(b=>b.classList.toggle('active',b===btn));
    $$('.tab-pane').forEach(p=>p.classList.toggle('active',p.id==='pane-'+t));
  });
});

// 过滤 radio 切换
['msgFilter','playerFilter','bookFilter','licenseFilter','kartFilter','circuitFilter'].forEach(name=>{
  document.querySelectorAll(`input[name="${name}"]`).forEach(r=>{
    r.addEventListener('change',()=>{
      if(name==='msgFilter')renderMessages();
      else if(name==='playerFilter')renderPlayers();
      else if(name==='bookFilter')renderBookings();
      else if(name==='licenseFilter')renderLicense();
      else if(name==='kartFilter')renderKarts();
      else if(name==='circuitFilter')renderCircuits();
    });
  });
});

// 添加管理员
const btnAddAdmin=$('#btnAddAdmin');
if(btnAddAdmin){
  btnAddAdmin.addEventListener('click',()=>{
    const u=prompt('新管理员用户名（3-20 位字母/数字/下划线）：');
    if(!u)return;
    const p=prompt('密码（至少 8 位）：','');
    if(!p||p.length<8){alert('密码至少 8 位');return;}
    const r=confirm('是否设为超级管理员？\n确定=super，取消=普通 admin');
    POST('/api/admin/admins',{username:u,password:p,role:r?'super':'admin'})
      .then(()=>{alert('已创建');renderAdminList();})
      .catch(e=>alert('失败: '+e.message));
  });
}

// 修改自己密码
const pwdForm=$('#pwdForm');
if(pwdForm){
  pwdForm.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const oldP=$('#pwdOld').value,np=$('#pwdNew').value,np2=$('#pwdNew2').value;
    const msgEl=$('#pwdMsg');msgEl.textContent='';
    if(np.length<8||np!==np2){msgEl.textContent='新密码至少 8 位且两次一致';msgEl.className='pwd-msg err';return;}
    try{
      const me=window._me;
      await POST('/api/admin/change-password',{username:me.username,password:oldP});
      await PATCH('/api/admin/admins?id='+me.id,{new_password:np});
      msgEl.textContent='✓ 密码已更新';msgEl.className='pwd-msg ok';
      pwdForm.reset();
    }catch(err){
      msgEl.textContent='更新失败: '+(String(err.message).indexOf('密码')>=0?'当前密码错误':err.message);
      msgEl.className='pwd-msg err';
    }
  });
}

// 退出登录
const btnLogout=$('#btnLogout');
if(btnLogout){
  btnLogout.addEventListener('click',async()=>{
    if(!confirm('确认退出登录？'))return;
    try{await DEL('/api/login');}catch(e){}
    window._me=null;showView('login');
  });
}

boot();
})();
