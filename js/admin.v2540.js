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

// v25.37: 把 _fileToDataURL / _attachFileUpload 提到主 IIFE 顶层
// (之前在嵌套 IIFE 里, showAnnModal 等顶层函数调不到)
function _fileToDataURL(input, callback) {
  var f = input.files && input.files[0];
  if (!f) return callback(null);
  if (f.size > 3 * 1024 * 1024) { alert('文件太大 (上限 3MB)'); input.value = ''; return callback(null); }
  var r = new FileReader();
  r.onload = function(ev) { callback(ev.target.result); };
  r.readAsDataURL(f);
}
function _fileToDataURLP(input) {
  return new Promise(function(resolve){ _fileToDataURL(input, resolve); });
}
function _attachFileUpload(form) {
  // 给 data-f=image_url 的 input / textarea 加文件上传入口 (点击按钮 → 系统文件选择器)
  var fields = [].slice.call(form.querySelectorAll('input[data-f="image_url"], textarea[data-f="image_url"]'));
  fields.forEach(function(inp){
    if (inp.dataset.fileAttached) return;
    inp.dataset.fileAttached = '1';
    inp.placeholder = '图片 URL（可粘贴 https:// 或 data:image/...）';
    var wrap = document.createElement('div');
    wrap.className = 'image-upload-wrap';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'image-upload-btn';
    btn.innerHTML = '📁 上传照片';
    var file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.name = '_file_' + inp.dataset.f;
    file.className = 'image-upload-file';
    var hint = document.createElement('span');
    hint.className = 'image-upload-hint';
    hint.textContent = '（上限 3MB，自动转 base64）';
    var preview = document.createElement('img');
    preview.className = 'image-upload-preview';
    btn.addEventListener('click', function(){ file.click(); });
    file.addEventListener('change', function(){
      file._fileReading = true;
      _fileToDataURL(file, function(dataUrl){
        file._fileReading = false;
        if (dataUrl) { inp.value = dataUrl; preview.src = dataUrl; preview.style.display = ''; }
      });
    });
    inp.addEventListener('input', function(){
      var v = inp.value.trim();
      if (/^(https?:\/\/|data:image\/)/i.test(v)) { preview.src = v; preview.style.display = ''; }
      else if (!v) { preview.style.display = 'none'; }
    });
    if (inp.value && /^(https?:\/\/|data:image\/)/i.test(inp.value.trim())) {
      preview.src = inp.value.trim();
      preview.style.display = '';
    }
    wrap.appendChild(btn);
    wrap.appendChild(file);
    wrap.appendChild(hint);
    wrap.appendChild(preview);
    inp.parentNode.insertBefore(wrap, inp.nextSibling);
  });
}

// v17.9: 同步隐藏 view-login 和 view-dash, 避免 boot 异步时闪现登录页
// (combined session 时, 用户应直接进 dash, 看不到登录框)
try {
  const _vl = document.getElementById('view-login');
  const _vd = document.getElementById('view-dash');
  if (_vl) _vl.style.display = 'none';
  if (_vd) _vd.style.display = 'none';
} catch (_) { /* DOM 还没就绪 (此 script 放 <body> 末尾应已就绪) */ }

async function api(m,p,b){
  const o={method:m,credentials:'include'};
  if(b!==undefined){o.headers={'Content-Type':'application/json'};o.body=JSON.stringify(b);}
  const r=await fetch(p,o);
  const d=await r.json().catch(()=>({ok:false,error:'非 JSON'}));
  if(!r.ok)throw new Error(d.error||'HTTP '+r.status);
  return d||{};
}
// v25.64: GET 加 30s cache wrapper (P/POST/PATCH/DELETE 不缓存)
const _adminCache = new Map();
const _CACHE_TTL = 30_000;
const GET=(p, force)=>{
  if(force){
    _adminCache.delete(p); // 强制 bypass
  }
  const hit = _adminCache.get(p);
  if(!force && hit && Date.now()-hit.ts < _CACHE_TTL){
    return Promise.resolve(hit.data);
  }
  return api('GET',p).then(d => { _adminCache.set(p, { data:d, ts:Date.now() }); return d; });
};
const POST=(p,b)=>api('POST',p,b);
const PATCH=(p,b)=>api('PATCH',p,b);
const DEL=(p)=>api('DELETE',p);

const showView=n=>{$('#view-login').style.display=n==='dash'?'none':'';$('#view-dash').style.display=n==='dash'?'':'none';};

async function boot(){
  try{
    const d=await GET('/api/login');
    // 移除 boot loading 覆盖层
    const _ld = document.getElementById('bootLoading'); if (_ld) _ld.remove();
    // v17.10: 三种 session 状态
    // - combined (有 admin+player): 直接进 dash
    // - 纯 admin (role: super/admin): 直接进 dash
    // - 纯 player (role: player): 弹"二级密码" modal (需输入关联管理员密码 或 用 passkey)
    // - 未登录: 弹标准登录框
    if (d.ok && d.user) {
      if (d.role && d.role !== 'player') {
        // 纯管理员 或 combined session
        window._me = d.user;
        renderDash();
      } else if (d.player && d.player.linked_admin_id) {
        // 玩家 session + 已绑管理员 → 弹二级密码 modal
        showView('login'); // 显示登录框骨架
        showAdminEnterModal(d.player, d.player.linked_admin_id);
      } else {
        // 玩家但没绑管理员 → 登录框
        showView('login');
        const el = $('#loginError');
        if (el) el.textContent = '当前是玩家账号, 但未绑定管理员账号, 无法进入管理后台';
      }
    } else {
      showView('login');
    }
  }catch(e){
    const _ld = document.getElementById('bootLoading'); if (_ld) _ld.remove();
    const el=$('#loginError');if(el)el.textContent='启动失败: '+e.message;showView('login');
  }
}

// v17.10: 二级密码 modal (玩家 session + 关联管理员时弹)
// 提供两种进入方式: 输入管理员密码 / 用通行密钥
function showAdminEnterModal(player, adminId) {
  // 关掉旧 modal
  const old = document.getElementById('adminEnterBackdrop');
  if (old) old.remove();
  const mask = document.createElement('div');
  mask.id = 'adminEnterBackdrop';
  mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
  mask.innerHTML = `
    <div style="position:relative;background:var(--c-cream,#f5e6c5);border:3px solid #000;box-shadow:6px 6px 0 #000;padding:24px;max-width:420px;width:100%;">
      <h3 style="margin:0 0 4px;color:#000;font-size:18px;">🛡️ 进入管理后台</h3>
      <p style="color:#333;font-size:12px;margin:0 0 16px;line-height:1.5;">
        当前已登录玩家 <b style="color:#000">${esc(player.username)}</b>。<br>
        进入管理需要 <b style="color:#000">二级验证</b>: 输入关联管理员的密码, 或用通行密钥。
      </p>
      <div id="adminEnterTabs" style="display:flex;gap:4px;margin-bottom:14px;">
        <button id="tabPw" class="enter-tab enter-tab-active" style="flex:1;">🔑 管理员密码</button>
        <button id="tabPk" class="enter-tab" style="flex:1;">🔐 通行密钥</button>
      </div>
      <div id="adminEnterPw">
        <label style="color:#000;font-size:12px;display:block;margin-bottom:4px;">关联管理员密码</label>
        <input type="password" id="adminEnterPwInput" placeholder="管理员密码 (至少 8 位)" style="width:100%;padding:8px;background:var(--c-paper,#faf3e0);color:#000;border:2px solid #000;font-size:14px;">
        <div id="adminEnterMsg" style="min-height:18px;font-size:12px;margin-top:6px;color:#000;"></div>
        <div style="margin-top:14px;">
          <button class="btn btn-primary btn-block" id="adminEnterPwBtn" style="width:100%;">✓ 进入管理</button>
        </div>
      </div>
      <div id="adminEnterPk" style="display:none;">
        <p style="color:#000;font-size:12px;margin:0 0 10px;">使用你已注册的通行密钥验证身份</p>
        <div id="adminEnterPkMsg" style="min-height:18px;font-size:12px;margin:6px 0;color:#000;"></div>
        <div style="margin-top:14px;">
          <button class="btn btn-primary btn-block" id="adminEnterPkBtn" style="width:100%;">🔐 用通行密钥进入</button>
        </div>
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:2px solid #000;text-align:center;">
        <a href="/" style="color:var(--c-water,#1e6fb8);font-size:12px;text-decoration:none;">← 返回首页 (玩家身份保持登录)</a>
      </div>
    </div>
  `;
  document.body.appendChild(mask);

  // 切 tab
  document.getElementById('tabPw').onclick = () => {
    document.getElementById('tabPw').className = 'enter-tab enter-tab-active';
    document.getElementById('tabPk').className = 'enter-tab';
    document.getElementById('adminEnterPw').style.display = '';
    document.getElementById('adminEnterPk').style.display = 'none';
  };
  document.getElementById('tabPk').onclick = () => {
    document.getElementById('tabPk').className = 'enter-tab enter-tab-active';
    document.getElementById('tabPw').className = 'enter-tab';
    document.getElementById('adminEnterPk').style.display = '';
    document.getElementById('adminEnterPw').style.display = 'none';
  };

  // 阻止点背景关闭 (二级密码必填)
  mask.addEventListener('click', e => { if (e.target === mask) { /* noop */ } });

  // 密码登录
  document.getElementById('adminEnterPwBtn').onclick = async () => {
    const pw = document.getElementById('adminEnterPwInput').value;
    const msgEl = document.getElementById('adminEnterMsg');
    msgEl.style.color = '#f99';
    if (!pw || pw.length < 8) { msgEl.textContent = '请输入密码'; return; }
    const btn = document.getElementById('adminEnterPwBtn');
    btn.disabled = true; btn.textContent = '验证中…';
    try {
      const r = await POST('/api/init?action=admin-enter-password', { admin_password: pw });
      if (!r.ok) throw new Error(r.error || '验证失败');
      msgEl.style.color = '#9f9';
      msgEl.textContent = '✓ 验证通过, 进入管理...';
      setTimeout(() => { mask.remove(); location.reload(); }, 600);
    } catch (e) {
      msgEl.textContent = '✗ ' + e.message;
      btn.disabled = false; btn.textContent = '✓ 进入管理';
    }
  };

  // 通行密钥登录
  document.getElementById('adminEnterPkBtn').onclick = async () => {
    const msgEl = document.getElementById('adminEnterPkMsg');
    msgEl.style.color = '#f99';
    if (!window.PublicKeyCredential) { msgEl.textContent = '浏览器不支持通行密钥'; return; }
    const btn = document.getElementById('adminEnterPkBtn');
    btn.disabled = true; btn.textContent = '等待认证…';
    try {
      const r1 = await POST('/api/init?action=passkey-admin-enter-start', {});
      if (!r1.ok) throw new Error(r1.error || '开始挑战失败');
      const opts = r1.publicKey;
      opts.challenge = b64urlToBuf(opts.challenge);
      // WebAuthn 要求 allowCredentials[].id 必须是 BufferSource, 不是 base64url 字符串
      if (opts.allowCredentials) {
        opts.allowCredentials = opts.allowCredentials.map((c) => ({ ...c, id: b64urlToBuf(c.id) }));
      }
      const cred = await navigator.credentials.get({ publicKey: opts });
      if (!cred) throw new Error('未选择凭据');
      const r2 = await POST('/api/init?action=passkey-admin-enter-finish', {
        challenge_token: r1.challenge_token,
        credential: {
          id: cred.id,
          rawId: bufToB64url(cred.rawId),
          type: cred.type,
          response: {
            clientDataJSON: bufToB64url(cred.response.clientDataJSON),
            authenticatorData: bufToB64url(cred.response.authenticatorData),
            signature: bufToB64url(cred.response.signature),
          }
        }
      });
      if (!r2.ok) throw new Error(r2.error || '验证失败');
      msgEl.style.color = '#9f9';
      msgEl.textContent = '✓ 验证通过, 进入管理...';
      setTimeout(() => { mask.remove(); location.reload(); }, 600);
    } catch (e) {
      msgEl.textContent = '✗ ' + e.message;
      btn.disabled = false; btn.textContent = '🔐 用通行密钥进入';
    }
  };

  // 密码输入框 focus
  setTimeout(() => document.getElementById('adminEnterPwInput')?.focus(), 50);
}

function b64urlToBuf(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function bufToB64url(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
    // v17.5: 管理员首次密码登录后, 引导添加通行密钥
    try { await maybeOfferAdminPasskey(me.user && me.user.id); } catch (e) { /* 静默 */ }
  }catch(err){if(errEl)errEl.textContent='登录失败: '+err.message;}
}
window.adminDoLogin=doLogin;

/* ---------- v17.5 管理员首次密码登录后引导添加通行密钥 ---------- */
async function maybeOfferAdminPasskey(adminId){
  if(!adminId) return;
  if(!window.PublicKeyCredential) return;
  if(!window.isSecureContext) return;
  const _dismissKey='lc_admin_passkey_offer_dismissed_'+adminId;
  const _last=parseInt(localStorage.getItem(_dismissKey)||'0',10);
  if(_last && (Date.now()-_last)<7*24*60*60*1000) return;
  let _list=[];
  try{
    const _r=await fetch('/api/init?action=passkey-list',{credentials:'include'});
    const _d=await _r.json();
    if(_r.ok && _d.ok!==false) _list=_d.passkeys||[];
  }catch(e){return;}
  if(_list.length>0) return;
  showAdminPasskeyOffer(adminId,_dismissKey);
}

function showAdminPasskeyOffer(adminId,dismissKey){
  const old=document.getElementById('adminPasskeyOfferBackdrop');
  if(old) old.remove();
  const bd=document.createElement('div');
  bd.id='adminPasskeyOfferBackdrop';
  bd.style.cssText='position:fixed;left:0;right:0;bottom:0;top:auto;z-index:10000;display:flex;justify-content:center;pointer-events:none;padding:14px';
  bd.innerHTML=`
    <div style="pointer-events:auto;background:linear-gradient(135deg,#2a2a4a,#1a1a3a);border:3px solid #88f;border-radius:10px;padding:14px 18px;max-width:480px;width:100%;box-shadow:0 8px 28px rgba(0,0,0,.5);color:#ddf;font-family:inherit;line-height:1.55">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:26px;line-height:1">🔑</span>
        <div style="flex:1">
          <b style="color:#fff;font-size:15px">管理员要不要也加一个通行密钥？</b>
          <div style="font-size:11px;color:#aac;margin-top:2px">下次可指纹 / Face ID 一键进后台，不用记密码</div>
        </div>
        <button type="button" id="apkoClose" aria-label="关闭" style="background:none;border:none;color:#aac;font-size:18px;cursor:pointer;padding:0 4px;line-height:1" title="关闭">×</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button type="button" id="apkoAdd" style="flex:1;min-width:120px;background:linear-gradient(135deg,#44a,#226);color:#fff;border:2px solid #88f;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700">✅ 立即添加</button>
        <button type="button" id="apkoLater" style="background:transparent;color:#aac;border:2px solid #46a;border-radius:6px;padding:8px 12px;cursor:pointer;font-size:12px">⏭ 下次再说</button>
      </div>
      <div id="apkoMsg" style="margin-top:8px;font-size:12px;min-height:16px;color:#aac"></div>
    </div>
  `;
  document.body.appendChild(bd);
  const close=()=>bd.remove();
  bd.querySelector('#apkoClose').onclick=close;
  bd.querySelector('#apkoLater').onclick=()=>{try{localStorage.setItem(dismissKey,String(Date.now()));}catch(e){}close();};

  function b64urlToBuf(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out.buffer;}
  function bufToB64url(buf){const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}

  bd.querySelector('#apkoAdd').onclick=async()=>{
    const addBtn=bd.querySelector('#apkoAdd');
    const msg=bd.querySelector('#apkoMsg');
    addBtn.disabled=true;
    addBtn.textContent='⏳ 请触摸指纹/Face ID...';
    msg.textContent='';
    let timeoutId=setTimeout(()=>{
      addBtn.disabled=false;
      addBtn.textContent='✅ 立即添加';
      msg.style.color='#f99';
      msg.textContent='✗ 操作超时, 请重试';
    },30000);
    try{
      const r1=await fetch('/api/init?action=passkey-register-start',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({}),
      });
      const d1=await r1.json();
      if(!r1.ok||d1.error) throw new Error(d1.error||'获取 challenge 失败');
      const opts=d1.publicKey;
      opts.challenge=b64urlToBuf(opts.challenge);
      opts.user.id=b64urlToBuf(opts.user.id);
      const cred=await navigator.credentials.create({publicKey:opts});
      if(!cred) throw new Error('未创建凭据');
      const r2=await fetch('/api/init?action=passkey-register-finish',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          challenge_token:d1.challenge_token,
          name:'我的设备',
          credential:{
            id:cred.id,
            rawId:bufToB64url(cred.rawId),
            type:cred.type,
            response:{
              clientDataJSON:bufToB64url(cred.response.clientDataJSON),
              attestationObject:bufToB64url(cred.response.attestationObject),
              transports:cred.response.getTransports?cred.response.getTransports():[],
            },
          },
        }),
      });
      const d2=await r2.json();
      if(!r2.ok||d2.error) throw new Error(d2.error||'保存失败');
      clearTimeout(timeoutId);
      msg.style.color='#9f9';
      msg.textContent='✓ 已添加！下次直接用指纹/Face ID 登录后台。';
      setTimeout(()=>close(),1800);
      try{localStorage.setItem(dismissKey,String(Date.now()));}catch(e){}
    }catch(e){
      clearTimeout(timeoutId);
      addBtn.disabled=false;
      addBtn.textContent='✅ 立即添加';
      msg.style.color='#f99';
      if(e.name==='NotAllowedError'){
        msg.textContent='已取消 (没添加成功, 下次可再来)';
      }else{
        msg.textContent='✗ '+(e.message||'失败');
      }
    }
  };
}

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
    if(!list.length){box.innerHTML='';empty.style.display = 'flex';return;}
    empty.style.display='none';
    box.innerHTML=list.map(m=>{
      const hasReply=m.admin_reply&&m.admin_reply.length>0;
      const isAiReply=hasReply&&m.admin_reply.startsWith('🤖');
      const previousReply=m.previous_reply||'';
      const hasPreviousAi=previousReply.length>0;
      // v17.7: 全程回复链标签 — 即使没回复也要标
      let chainTag;
      if(!hasReply){
        chainTag='<span class="msg-replied-tag" style="background:#3a2a1a;color:#fc6;border-color:#c84;">⏳ 待回复</span>';
      }else if(hasPreviousAi){
        chainTag='<span class="msg-replied-tag" style="background:#1a1a3a;color:#9cf;border-color:#66f;" title="AI 先自动回复，后被管理员覆盖">🤖→💬 已被人工覆盖</span>';
      }else if(isAiReply){
        chainTag='<span class="msg-replied-tag" style="background:#1a3a1a;color:#9f9;border-color:#6f6;">🤖 AI 已回复</span>';
      }else{
        chainTag='<span class="msg-replied-tag" style="background:#1a2a3a;color:#9cf;border-color:#6cf;">💬 人工已回复</span>';
      }
      // v17.7: AI 原回复折叠区(被人工覆盖时显示)
      const previousAiBox=hasPreviousAi?`<div class="msg-prev-ai"><details><summary>📋 查看 AI 原回复（已被人工覆盖）</summary><div class="msg-prev-ai-body">${esc(previousReply)}</div></details></div>`:'';
      // v17.7: 回复链时间线
      const chainLine=hasPreviousAi?`<div class="msg-chain-line">📋 回复历程：${esc(previousReply).slice(0,30)}${previousReply.length>30?'…':''} → 人工覆盖 → 现回复</div>`:'';
      return `<article class="msg-item ${m.status!=='new'?'is-read':''}" data-id="${m.id}">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">👤 ${esc(m.name)}${m.contact?' · '+esc(m.contact):''}</b>
          ${m.player_username?`<span class="msg-player-tag">@${esc(m.player_username)}</span>`:''}
          ${m.status==='done'?'<span class="msg-read-tag">已处理</span>':m.status!=='new'?'<span class="msg-read-tag">已读</span>':'<span class="msg-unread-tag">新</span>'}
          ${chainTag}
        </div><div class="msg-time">${fmt(m.created_at)}</div></div>
        <div class="msg-content">${esc(m.content)}</div>
        ${hasReply?`<div class="msg-reply-box"><b>📣 市政厅回复：</b><div>${esc(m.admin_reply)}</div><small>${fmt(m.replied_at)}</small></div>`:''}
        ${chainLine}
        ${previousAiBox}
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
  }catch(e){throw e;}
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
  const nameTag=m.name?`<div style="color:#000;font-size:13px;margin-bottom:6px;">👤 ${esc(m.name)} <span style="color:#888;">· ${fmtDate(m.created_at)}</span></div>`:'';

  bd.innerHTML=`
    <div style="background:var(--c-cream,#f5e6c5);border:3px solid #000;box-shadow:6px 6px 0 #000;">
      <h3 style="margin:0 0 10px;color:#000;font-size:16px;">💬 回复留言 #${m.id}</h3>
      ${nameTag}
      ${contact}
      ${context}
      ${m.admin_reply && m.admin_reply.startsWith('🤖')?'<div style="background:#1a2a1a;border-left:3px solid #6f6;padding:6px 10px;border-radius:4px;margin-bottom:8px;font-size:12px;color:#9f9;">🤖 AI 已自动回复，管理员可编辑覆盖</div>':''}
      <div style="position:relative;margin-bottom:8px;">
        <textarea id="replyText" placeholder="输入回复内容…(无字数限制)" style="width:100%;min-height:140px;padding:10px;border-radius:4px;border:1px solid #444;background:#0f0f1a;color:#eee;font-family:inherit;font-size:14px;line-height:1.5;resize:vertical;box-sizing:border-box;">${esc(m.admin_reply||'')}</textarea>
        <div id="replyCount" style="position:absolute;bottom:6px;right:10px;font-size:11px;color:#888;pointer-events:none;background:rgba(15,15,26,0.7);padding:2px 6px;border-radius:3px;">${m.admin_reply ? m.admin_reply.length : 0} 字</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        <span style="flex:1;"></span>
        <button id="aiStandardBtn" type="button" style="background:#3a2;color:#fff;border:none;padding:8px 12px;border-radius:4px;cursor:pointer;font-size:13px;" title="亲切礼貌 100 字内">🤖 AI 草稿</button>
        <button id="aiProBtn" type="button" style="background:#1a4a8a;color:#fff;border:none;padding:8px 12px;border-radius:4px;cursor:pointer;font-size:13px;" title="政府公文体 100 字内">💼 专业回复</button>
        <button id="aiDetailBtn" type="button" style="background:#5a2a5a;color:#fff;border:none;padding:8px 12px;border-radius:4px;cursor:pointer;font-size:13px;" title="5 段结构 300-500 字详尽回复">📋 详细回复</button>
        <button id="aiShortBtn" type="button" style="background:#5a5a2;color:#fff;border:none;padding:8px 12px;border-radius:4px;cursor:pointer;font-size:13px;" title="30 字内极简">⚡ 极简</button>
        <button id="replyCancel" type="button" style="background:#555;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:13px;">取消</button>
        <button id="replyClear" type="button" style="background:#a33;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:13px;">清空</button>
        <button id="replySave" type="button" style="background:#6cf;color:#000;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px;">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(bd);

  const ta=bd.querySelector('#replyText');
  const cnt=bd.querySelector('#replyCount');
  // v25.67: 实时字数统计 (无限制, 只显示)
  ta.addEventListener('input',()=>{ if(cnt) cnt.textContent = ta.value.length + ' 字'; });
  const close=()=>bd.remove();
  bd.addEventListener('click',e=>{if(e.target===bd)close();});

  bd.querySelector('#replyCancel').onclick=close;
  bd.querySelector('#replyClear').onclick=()=>{ta.value='';ta.focus();};
  bd.querySelector('#replySave').onclick=()=>{
    const trimmed=ta.value.trim();
    if(!trimmed){if(!confirm('清空回复？（点确定 = 清空，点取消 = 继续编辑）'))return;}
    PATCH('/api/admin/messages?id='+m.id,{admin_reply:trimmed}).then(()=>{close();renderMessages();}).catch(e=>alert('保存失败: '+e.message));
  };

  // AI 3 种 tone 按钮
  async function aiDraft(tone, btn){
    if(!m.content){alert('留言内容为空，无法生成');return;}
    const orig = btn.textContent;
    btn.disabled=true;
    btn.textContent='⏳ 生成中…';
    try{
      const r=await fetch('/api/admin/messages?action=ai-draft',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message:m.content.slice(0,100),history:[],tone}),
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data.error){alert('AI 失败: '+(data.error||r.status));return;}
      ta.value=data.draft||'';
      ta.focus();
      const toneLabel = tone==='professional'?'专业':tone==='concise'?'极简':tone==='detailed'?'详细':'标准';
      btn.textContent='✅ '+toneLabel+' 已生成 ('+data.draft.length+'字 / '+data.model+')';
      setTimeout(()=>{btn.textContent=orig;},3000);
    }catch(e){
      alert('网络错误: '+e.message);
      btn.textContent=orig;
    }finally{
      btn.disabled=false;
    }
  }
  bd.querySelector('#aiStandardBtn').onclick=(e)=>aiDraft('standard', e.currentTarget);
  bd.querySelector('#aiProBtn').onclick=(e)=>aiDraft('professional', e.currentTarget);
  bd.querySelector('#aiDetailBtn').onclick=(e)=>aiDraft('detailed', e.currentTarget);
  bd.querySelector('#aiShortBtn').onclick=(e)=>aiDraft('concise', e.currentTarget);

  setTimeout(()=>ta.focus(),50);
}

async function renderPlayers(){
  try{
    // 用 super 专用端点: 含 last_session 字段
    const isSuper=window._me&&window._me.role==='super';
    const url=isSuper?'/api/init?action=admin-player-list':'/api/admin/players';
    const method=isSuper?'POST':'GET';
    const d=isSuper?await POST(url,{}):await GET(url);
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
    if(!shown.length){box.innerHTML='';empty.style.display = 'flex';return;}
    empty.style.display='none';
    // 按 status 排序: pending 在前 (待处理优先), 然后 active, 然后 rejected
    const _ord={pending:0,active:1,rejected:2};
    shown=[...shown].sort((a,b)=>(_ord[a.status]??9)-(_ord[b.status]??9)||(b.id-a.id));
    box.innerHTML=shown.map(p=>{
      const isPending=p.status==='pending';
      const isActive=p.status==='active';
      const isRejected=p.status==='rejected';
      const lastSession=p.last_session?fmt(p.last_session):'<i style="color:#aaa">从未登录</i>';
      return `<article class="msg-item" data-id="${p.id}">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">${esc(p.avatar_emoji||'👤')} ${esc(p.username)}</b>
          <span style="color:var(--c-stone-dark);font-size:12px;margin-left:6px">${esc(p.email)}</span>
          <span class="msg-player-tag">${STATUS_LABEL[p.status]||p.status}</span>
          ${p.game_id?`<span class="gallery-num" title="游戏ID" style="margin-left:4px">🎮 ${esc(p.game_id)}</span>`:''}
        </div><div class="msg-time">注册：${fmt(p.created_at)}</div></div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--c-stone-dark);padding:4px 0 2px">
          <span title="注册时间">📅 已注册：${fmt(p.created_at)}</span>
          <span title="最后活跃">🕒 最后活跃：${lastSession}</span>
        </div>
        <p class="msg-content" style="font-size:13px;color:var(--c-stone-dark);margin:6px 0">${p.bio?esc(p.bio):'<i>暂无简介</i>'}</p>
        <div class="msg-actions book-actions">
          ${isPending?`<button class="btn btn-primary btn-sm" data-act="approve">✓ 批准</button><button class="btn btn-ghost btn-sm btn-danger" data-act="reject">✗ 拒绝</button>`:''}
          ${!isPending?`<button class="btn btn-ghost btn-sm" data-act="reset-pw">🔑 重置密码</button>`:''}
          ${isActive?`<button class="btn btn-ghost btn-sm btn-danger" data-act="reject">✗ 改为拒绝</button>`:''}
          ${isRejected?`<button class="btn btn-ghost btn-sm" data-act="approve">↻ 改为批准</button>`:''}
          ${isSuper?`<button class="btn btn-ghost btn-sm" data-act="rename" title="修改玩家账号名 (game_id 同步)">✏️ 改名</button>`:''}
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el=>{
      const id=+el.dataset.id;
      el.querySelector('[data-act="approve"]')?.addEventListener('click',()=>playerAction(id,'approve'));
      el.querySelector('[data-act="reject"]')?.addEventListener('click',()=>playerAction(id,'reject'));
      el.querySelector('[data-act="reset-pw"]')?.addEventListener('click',()=>playerResetPw(id));
      el.querySelector('[data-act="rename"]')?.addEventListener('click',()=>playerRename(id, p.username));
    });
    // 显示/隐藏 "代注册玩家" 按钮
    const btnCreate=document.getElementById('btnPlayerCreate');
    if(btnCreate)btnCreate.style.display=isSuper?'':'none';
  }catch(e){throw e;}
}

// 超管代注册玩家
function showCreatePlayerModal(){
  if(!window._me||window._me.role!=='super')return;
  // 关掉旧模态
  const old=document.getElementById('createPlayerBackdrop');
  if(old)old.remove();
  const bd=document.createElement('div');
  bd.id='createPlayerBackdrop';
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  bd.innerHTML=`
    <div style="background:var(--c-cream,#f5e6c5);border:3px solid #000;box-shadow:6px 6px 0 #000;">
      <h3 style="margin:0 0 6px;color:#000;font-size:17px;">🆕 代注册玩家账号</h3>
      <p style="color:#aaa;font-size:12px;margin:0 0 14px;line-height:1.5">
        由 super 管理员直接创建账号，无需玩家本人注册和审批。账号立即激活可用。
      </p>
      <div style="display:grid;gap:10px;grid-template-columns:1fr">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#333">
          <span>玩家用户名 <b style="color:#fff">*</b> <small>（2-32 字符，中文/字母/数字/下划线/连字符/点/空格，不含 @）</small></span>
          <input id="cpUser" type="text" placeholder="如：SIM_漫画家" style="padding:8px 10px;border:1px solid #444;background:#0f0f1a;color:#eee;border-radius:4px;font-family:inherit;font-size:14px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#333">
          <span>邮箱 <b style="color:#fff">*</b></span>
          <input id="cpEmail" type="email" placeholder="player@example.com" style="padding:8px 10px;border:1px solid #444;background:#0f0f1a;color:#eee;border-radius:4px;font-family:inherit;font-size:14px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#333">
          <span>游戏 ID <small>（可选）</small></span>
          <input id="cpGame" type="text" placeholder="Minecraft 游戏内 ID" style="padding:8px 10px;border:1px solid #444;background:#0f0f1a;color:#eee;border-radius:4px;font-family:inherit;font-size:14px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#333">
          <span>初始密码 <b style="color:#fff">*</b> <small>（至少 8 位）</small></span>
          <input id="cpPass" type="text" placeholder="可填临时密码，玩家可自行修改" style="padding:8px 10px;border:1px solid #444;background:#0f0f1a;color:#eee;border-radius:4px;font-family:inherit;font-size:14px">
        </label>
      </div>
      <div id="cpMsg" style="font-size:12px;margin-top:8px;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button id="cpCancel" type="button" style="background:#555;color:#fff;border:none;padding:9px 16px;border-radius:4px;cursor:pointer;font-size:13px">取消</button>
        <button id="cpSave" type="button" style="background:#6cf;color:#000;border:none;padding:9px 16px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px">✓ 创建账号</button>
      </div>
    </div>
  `;
  document.body.appendChild(bd);
  const close=()=>bd.remove();
  bd.addEventListener('click',e=>{if(e.target===bd)close();});
  document.getElementById('cpCancel').onclick=close;
  setTimeout(()=>{document.getElementById('cpUser').focus();},50);
  document.getElementById('cpSave').onclick=async()=>{
    const username=document.getElementById('cpUser').value.trim();
    const email=document.getElementById('cpEmail').value.trim();
    const game_id=document.getElementById('cpGame').value.trim();
    const password=document.getElementById('cpPass').value;
    const msgEl=document.getElementById('cpMsg');
    const saveBtn=document.getElementById('cpSave');
    msgEl.style.color='#e8b840';
    msgEl.textContent='提交中…';
    saveBtn.disabled=true;
    try{
      const r=await fetch('/api/init?action=admin-player-create',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username,email,game_id,password}),
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data.error)throw new Error(data.error||'创建失败');
      msgEl.style.color='#9f9';
      msgEl.textContent='✓ 账号创建成功: '+username;
      setTimeout(()=>{close();renderPlayers();},800);
    }catch(e){
      msgEl.style.color='#f99';
      msgEl.textContent='✗ '+(e.message||'失败');
    }finally{
      saveBtn.disabled=false;
    }
  };
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
async function playerRename(id, currentName){
  // v17.10: super 改玩家账号名
  if(!window._me || window._me.role!=='super'){alert('只有 super 管理员可改名');return;}
  const newName = prompt(`将玩家账号名从\n"${currentName}"\n改为:`, currentName);
  if(newName===null)return; // 取消
  const trimmed = (newName||'').trim();
  if(!trimmed){alert('名字不能为空');return;}
  if(trimmed.length<2 || trimmed.length>32){alert('名字 2-32 字符');return;}
  if(trimmed===currentName){alert('未变化');return;}
  if(!confirm(`确认把玩家账号名改为 "${trimmed}"?\n\n注意: 这会同时改玩家的登录名, 玩家下次登录需用新名. game_id 若等于旧名也会同步更新.`))return;
  try{
    const r = await PATCH('/api/admin/players?id='+id+'&action=rename', { new_username: trimmed });
    alert('✓ 玩家名已改为: ' + (r.username||trimmed) + (r.game_id_synced?'\n(game_id 已同步)':'\n(game_id 未同步, 因为玩家已自定义)'));
    renderPlayers();
  } catch(e){ alert('失败: '+e.message); }
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
    if(!list.length){box.innerHTML='';empty.style.display = 'flex';return;}
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
          <button class="btn btn-primary btn-sm" data-act="edit">✎ 编辑</button>
          <select class="book-status-sel">${opts}</select>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el=>{
      const id=+el.dataset.id;
      const _b = list.find(x => x.id === id);
      el.querySelector('.book-status-sel').onchange=(e)=>bookStatus(id,e.target.value);
      el.querySelector('[data-act="del"]').onclick=()=>bookDel(id);
      const _eb = el.querySelector('[data-act="edit"]');
      if (_eb) _eb.onclick = () => _b && bookEdit(_b);
    });
  }catch(e){throw e;}
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

// v20: 酒店预订编辑 modal
function bookEdit(b) {
  const old = document.getElementById('bookEditBackdrop');
  if (old) old.remove();
  const bd = document.createElement('div');
  bd.id = 'bookEditBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  bd.innerHTML = `
    <div style="border:3px solid #000;box-shadow:6px 6px 0 #000;max-height:90vh;overflow-y:auto;">
      <h3 style="margin:0 0 12px;color:#000;font-size:16px;">✎ 编辑酒店预订 #${b.id}</h3>
      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">姓名</span>
        <input id="beName" value="${esc(b.name||'')}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;" />
      </label>
      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">联系方式</span>
        <input id="beContact" value="${esc(b.contact||'')}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;" />
      </label>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <label style="flex:1;display:block;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">入住日期</span>
          <input id="beIn" type="date" value="${esc(b.in_date||'')}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;" />
        </label>
        <label style="flex:1;display:block;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">退房日期</span>
          <input id="beOut" type="date" value="${esc(b.out_date||'')}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;" />
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <label style="flex:1;display:block;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">人数</span>
          <input id="bePersons" type="number" min="1" value="${b.persons||1}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;" />
        </label>
        <label style="flex:1;display:flex;align-items:center;gap:6px;color:#ccc;font-size:13px;padding-top:18px;">
          <input id="beBf" type="checkbox" ${b.breakfast ? 'checked' : ''} /> 🍳 含早餐
        </label>
      </div>
      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">特殊要求</span>
        <textarea id="beNote" rows="2" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;line-height:1.4;resize:vertical;box-sizing:border-box;">${esc(b.note||'')}</textarea>
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button id="beCancel" type="button" style="background:#555;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:13px;">取消</button>
        <button id="beSave" type="button" style="background:#fc6;color:#000;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px;">💾 保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#beCancel').onclick = close;
  bd.querySelector('#beSave').onclick = async () => {
    const btn = bd.querySelector('#beSave');
    btn.disabled = true; btn.textContent = '⏳ 保存中...';
    try {
      const body = {
        name: bd.querySelector('#beName').value.trim(),
        contact: bd.querySelector('#beContact').value.trim(),
        in_date: bd.querySelector('#beIn').value,
        out_date: bd.querySelector('#beOut').value,
        persons: parseInt(bd.querySelector('#bePersons').value, 10) || 1,
        breakfast: bd.querySelector('#beBf').checked ? 1 : 0,
        note: bd.querySelector('#beNote').value.trim(),
      };
      const r = await fetch('/api/admin/bookings?id=' + b.id, {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || '保存失败');
      close();
      renderBookings();
    } catch (e) {
      alert('保存失败: ' + e.message);
      btn.disabled = false; btn.textContent = '💾 保存';
    }
  };
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
    if(!shown.length){box.innerHTML='';empty.style.display = 'flex';return;}
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
  }catch(e){throw e;}
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
    const cP=list.filter(x=>x.status==='pending').length;
    $('#kartCntAll').textContent=list.length;
    $('#kartCntPending').textContent=cP;
    $('#kartCntApproved').textContent=list.filter(x=>x.status==='approved').length;
    $('#kartCntRejected').textContent=list.filter(x=>x.status==='rejected').length;
    $('#kartPending').textContent=cP>0?`(${cP})`:'';
    const box=$('#kartList'),empty=$('#kartEmpty');
    if(!list.length){box.innerHTML='';empty.style.display = 'flex';return;}
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
          <button class="btn btn-primary btn-sm" data-act="edit">✎ 编辑</button>
          <select class="book-status-sel">${opts}</select>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el=>{
      const id=+el.dataset.id;
      const _k = list.find(x => x.id === id);
      el.querySelector('.book-status-sel').onchange=(e)=>kartStatus(id,e.target.value);
      el.querySelector('[data-act="del"]').onclick=()=>kartDel(id);
      el.querySelector('[data-act="edit"]')?.addEventListener('click', () => _k && kartCircuitEdit(_k, 'kart'));
    });
  }catch(e){throw e;}
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
    const cP=list.filter(x=>x.status==='pending').length;
    $('#circuitCntAll').textContent=list.length;
    $('#circuitCntPending').textContent=cP;
    $('#circuitCntApproved').textContent=list.filter(x=>x.status==='approved').length;
    $('#circuitCntRejected').textContent=list.filter(x=>x.status==='rejected').length;
    $('#circuitPending').textContent=cP>0?`(${cP})`:'';
    const box=$('#circuitList'),empty=$('#circuitEmpty');
    if(!list.length){box.innerHTML='';empty.style.display = 'flex';return;}
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
          <button class="btn btn-primary btn-sm" data-act="edit">✎ 编辑</button>
          <select class="book-status-sel">${opts}</select>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.msg-item').forEach(el=>{
      const id=+el.dataset.id;
      const _c = list.find(x => x.id === id);
      el.querySelector('.book-status-sel').onchange=(e)=>circuitStatus(id,e.target.value);
      el.querySelector('[data-act="del"]').onclick=()=>circuitDel(id);
      el.querySelector('[data-act="edit"]')?.addEventListener('click', () => _c && kartCircuitEdit(_c, 'circuit'));
    });
  }catch(e){throw e;}
}
async function circuitStatus(id,s){
  try{await PATCH('/api/admin/circuit?id='+id,{status:s});renderCircuits();}
  catch(e){alert('失败: '+e.message);}
}

// v20: 赛道/赛车场报名编辑 modal (公用)
function kartCircuitEdit(it, kind) {
  const old = document.getElementById('kcEditBackdrop');
  if (old) old.remove();
  const bd = document.createElement('div');
  bd.id = 'kcEditBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  const isK = kind === 'kart';
  const _type = isK ? '🏁 赛道报名' : '🏎️ 国际赛车场';
  const _color = isK ? '#fc6' : '#c6f';
  const _endpoint = isK ? '/api/admin/kart' : '/api/admin/circuit';
  const _statusOpts = (isK ? ['pending','approved','rejected'] : ['pending','confirmed','cancelled'])
    .map(s => `<option value="${s}" ${s===it.status?'selected':''}>${({pending:'待处理',approved:'已批准',rejected:'已拒绝',confirmed:'已确认',cancelled:'已取消'})[s]}</option>`).join('');
  bd.innerHTML = `
    <div style="background:var(--c-cream,#f5e6c5);border:3px solid #000;box-shadow:6px 6px 0 #000;max-height:90vh;overflow-y:auto;">
      <h3 style="margin:0 0 12px;color:${_color};font-size:16px;">✎ 编辑${_type} #${it.id}</h3>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <label style="flex:1;display:block;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">姓名</span>
          <input id="kcName" value="${esc(it.name||'')}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;" />
        </label>
        <label style="flex:1;display:block;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">联系方式</span>
          <input id="kcContact" value="${esc(it.contact||'')}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;" />
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <label style="flex:1;display:block;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">场次 (session)</span>
          <input id="kcSession" value="${esc(it.session||'')}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;" />
        </label>
        <label style="flex:1;display:block;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">${isK ? '车辆 (car)' : '驾照 (license)'}</span>
          <input id="kcCar" value="${esc((isK?it.car:it.license)||'')}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;" />
        </label>
      </div>
      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">状态</span>
        <select id="kcStatus" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;">${_statusOpts}</select>
      </label>
      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">备注</span>
        <textarea id="kcNote" rows="2" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;line-height:1.4;resize:vertical;box-sizing:border-box;">${esc(it.note||'')}</textarea>
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button id="kcCancel" type="button" style="background:#555;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:13px;">取消</button>
        <button id="kcSave" type="button" style="background:${_color};color:#000;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px;">💾 保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#kcCancel').onclick = close;
  bd.querySelector('#kcSave').onclick = async () => {
    const btn = bd.querySelector('#kcSave');
    btn.disabled = true; btn.textContent = '⏳ 保存中...';
    try {
      const body = {
        name: bd.querySelector('#kcName').value.trim(),
        contact: bd.querySelector('#kcContact').value.trim(),
        session: bd.querySelector('#kcSession').value.trim(),
        status: bd.querySelector('#kcStatus').value,
        note: bd.querySelector('#kcNote').value.trim(),
      };
      if (isK) body.car = bd.querySelector('#kcCar').value.trim();
      else body.license = bd.querySelector('#kcCar').value.trim();
      const r = await fetch(_endpoint + '?id=' + it.id, {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || '保存失败');
      close();
      (isK ? renderKarts : renderCircuits)();
    } catch (e) {
      alert('保存失败: ' + e.message);
      btn.disabled = false; btn.textContent = '💾 保存';
    }
  };
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
    if(!list.length){box.innerHTML='';const e=document.getElementById('adminListEmpty');if(e)e.style.display='flex';return;}
    box.innerHTML=list.map(a=>{
      const isMe=a.username===me.username;
      const canDel=me.role==='super'&&!isMe;
      const linkedBadge = a.linked_player_id
        ? `<span class="role-tag" style="background:#a6a;color:#fff;font-size:10px;" title="此管理员已与该玩家账号合并: 用玩家密码或通行密钥即可登入管理; 退出管理无需重新验证">🔗 合并: ${esc(a.linked_player_username||'#'+a.linked_player_id)}</span>`
        : '';
      return `<article class="admin-item" data-id="${esc(String(a.id))}">
        <div class="admin-avatar">${a.role==='super'?'🛡️':'👤'}</div>
        <div class="admin-meta">
          <b>${esc(a.username)} ${isMe?'<span class="me-tag">我</span>':''}</b>
          <span class="role-tag role-${a.role}">${a.role==='super'?'SUPER':'ADMIN'}</span>
          ${linkedBadge}
        </div>
        <div class="admin-actions">
          ${me.role==='super'?`<button class="btn btn-primary btn-sm" data-act="edit">✎ 编辑</button>`:''}
          ${me.role==='super'?`<button class="btn btn-ghost btn-sm" data-act="link">${a.linked_player_id?'⛓️‍💥 解除合并':'🔗 合并玩家'}</button>`:''}
          ${me.role==='super'?`<button class="btn btn-ghost btn-sm" data-act="reset">${isMe?'修改密码':'重置密码'}</button>`:''}
          ${canDel?`<button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>`:''}
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('.admin-item').forEach(el=>{
      const id=+el.dataset.id;
      const _a = list.find(x => x.id === id);
      el.querySelector('[data-act="edit"]')?.addEventListener('click',()=>_a && adminEdit(_a));
      el.querySelector('[data-act="reset"]')?.addEventListener('click',()=>adminReset(id));
      el.querySelector('[data-act="del"]')?.addEventListener('click',()=>adminDel(id));
      el.querySelector('[data-act="link"]')?.addEventListener('click',()=>adminLink(id));
    });
    const ae=document.getElementById('adminListEmpty');if(ae)ae.style.display='none';
  }catch(e){if(String(e).indexOf('403')>0){$('#adminList').innerHTML='<p class="empty-state">仅 super 可查看</p>';}}
}
async function adminReset(id){
  const np=prompt('新密码（至少 8 位）：','');if(!np)return;
  if(np.length<8){alert('至少 8 位');return;}
  try{await PATCH('/api/admin/admins?id='+id,{new_password:np});alert('已重置');}
  catch(e){alert('失败: '+e.message);}
}

// v20: 管理员账号编辑 (用户名 + 角色)
function adminEdit(a) {
  const old = document.getElementById('adminEditBackdrop');
  if (old) old.remove();
  const bd = document.createElement('div');
  bd.id = 'adminEditBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  const isMe = window._me && a.id === window._me.id;
  bd.innerHTML = `
    <div style="background:var(--c-cream,#f5e6c5);border:3px solid #000;box-shadow:6px 6px 0 #000;">
      <h3 style="margin:0 0 12px;color:#c8c;font-size:16px;">✎ 编辑管理员 #${a.id}</h3>
      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">用户名 (3-32 字符)</span>
        <input id="admUser" value="${esc(a.username)}" ${isMe?'disabled':''} style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:${isMe?'#1a1a2a':'#0f0f1a'};color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;" />
      </label>
      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">角色</span>
        <select id="admRole" ${isMe?'disabled':''} style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:${isMe?'#1a1a2a':'#0f0f1a'};color:#eee;font-family:inherit;font-size:13px;box-sizing:border-box;">
          <option value="admin" ${a.role==='admin'?'selected':''}>ADMIN (普通管理员)</option>
          <option value="super" ${a.role==='super'?'selected':''}>SUPER (超级管理员)</option>
        </select>
      </label>
      ${isMe?'<p style="color:#a44;font-size:11px;margin-bottom:8px;">⚠️ 自己的账号不能改用户名/角色, 用"修改密码"按钮改密码</p>':''}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button id="admCancel" type="button" style="background:#555;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:13px;">取消</button>
        <button id="admSave" type="button" style="background:#a6a;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px;">💾 保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#admCancel').onclick = close;
  bd.querySelector('#admSave').onclick = async () => {
    const btn = bd.querySelector('#admSave');
    btn.disabled = true; btn.textContent = '⏳ 保存中...';
    try {
      const body = {};
      const newU = bd.querySelector('#admUser').value.trim();
      const newR = bd.querySelector('#admRole').value;
      if (!isMe && newU !== a.username) body.username = newU;
      if (!isMe && newR !== a.role) body.role = newR;
      if (Object.keys(body).length === 0) { close(); return; }
      const r = await fetch('/api/admin/admins?id=' + a.id, {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || '保存失败');
      close();
      renderAdminList();
    } catch (e) {
      alert('保存失败: ' + e.message);
      btn.disabled = false; btn.textContent = '💾 保存';
    }
  };
}
async function adminDel(id){
  if(!confirm('删除该管理员？'))return;
  try{await DEL('/api/admin/admins?id='+id);renderAdminList();}
  catch(e){alert('失败: '+e.message);}
}
async function adminLink(id){
  // v17.9: 合并/解除合并 玩家账号 (双向 linked_player_id + linked_admin_id)
  const _isLinked = await (await GET('/api/admin/admins')).admins
    .find(x => x.id === id)?.linked_player_id;
  if (_isLinked) {
    // 解除合并
    if (!confirm('确认解除合并? 解除后两边需重新登录。')) return;
    try {
      await POST('/api/init?action=admin-unmerge-account',
        { admin_id: id, player_id: _isLinked });
      renderAdminList();
      alert('已解除合并');
    } catch (e) { alert('失败: ' + e.message); }
    return;
  }
  // 合并 — 弹一个玩家列表 modal 让 super 直接点选
  showMergePlayerModal(id);
}

// 合并玩家 modal — 列出所有 active 玩家, super 点选
async function showMergePlayerModal(adminId) {
  const old = document.getElementById('mergePlayerBackdrop');
  if (old) old.remove();
  const mask = document.createElement('div');
  mask.id = 'mergePlayerBackdrop';
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <div class="modal-head">
        <h3>🔗 选择要合并的玩家</h3>
        <button class="modal-close" id="mpClose">×</button>
      </div>
      <div class="modal-body">
        <p style="margin:0 0 12px;font-size:13px;color:var(--c-stone);">合并后: 用该玩家密码或通行密钥登录, 即可同时获得管理身份; 退出管理无需重新验证, 玩家身份保留。两边密码独立, 互不影响。</p>
        <div style="margin-bottom:10px;">
          <input type="text" id="mpSearch" placeholder="搜索玩家 username / game_id / email..." style="width:100%;padding:8px 10px;font-size:14px;border:2px solid var(--c-stone);background:var(--c-bg-2);">
        </div>
        <div id="mpList" style="max-height:380px;overflow-y:auto;border:2px solid var(--c-stone);background:var(--c-paper);">
          <p style="text-align:center;padding:24px;color:var(--c-stone);">载入中…</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  document.getElementById('mpClose').addEventListener('click', close);
  mask.addEventListener('click', e => { if (e.target === mask) close(); });

  // 拉所有玩家
  let _players = [];
  try {
    // super 用 admin-player-list 端点, 含 status
    const r = await POST('/api/init?action=admin-player-list', {});
    _players = (r.players || []).filter(p => p.status === 'active');
  } catch (e) {
    document.getElementById('mpList').innerHTML = '<p style="text-align:center;padding:24px;color:#c33;">加载失败: ' + esc(e.message) + '</p>';
    return;
  }

  function render(q) {
    const list = document.getElementById('mpList');
    const ql = (q || '').trim().toLowerCase();
    const filtered = !ql ? _players : _players.filter(p =>
      (p.username || '').toLowerCase().includes(ql) ||
      (p.game_id || '').toLowerCase().includes(ql) ||
      (p.email || '').toLowerCase().includes(ql)
    );
    if (!filtered.length) {
      list.innerHTML = '<p style="text-align:center;padding:24px;color:var(--c-stone);">无匹配玩家</p>';
      return;
    }
    list.innerHTML = filtered.map(p => `
      <div class="mp-row" data-pid="${esc(String(p.id))}" data-pname="${esc(p.username)}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--c-bg-2);cursor:pointer;transition:background 0.1s;">
        <span style="font-size:24px;">${esc(p.avatar_emoji || '👤')}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:var(--c-stone-dark);font-size:14px;">${esc(p.username)}</div>
          <div style="font-size:11px;color:var(--c-stone);overflow:hidden;text-overflow:ellipsis;">ID: ${p.id} · ${esc(p.game_id || '-')} · ${esc(p.email || '')}</div>
        </div>
        <span style="font-size:11px;color:var(--c-emerald);">→ 合并</span>
      </div>
    `).join('');
    list.querySelectorAll('.mp-row').forEach(row => {
      row.addEventListener('mouseover', () => row.style.background = 'var(--c-bg-2)');
      row.addEventListener('mouseout', () => row.style.background = '');
      row.addEventListener('click', async () => {
        const pid = parseInt(row.dataset.pid, 10);
        const pname = row.dataset.pname;
        if (!confirm(`确认将管理员与此玩家 [${pname}] 合并?\n\n合并后:\n• 用玩家密码/通行密钥登录即可获得管理身份\n• 退出管理无需重新验证, 玩家身份保留\n• 两边密码独立`)) return;
        try {
          await POST('/api/init?action=admin-merge-account',
            { admin_id: adminId, player_id: pid });
          renderAdminList();
          close();
          alert('已合并玩家 ' + pname + '\n\n该玩家下次登录即可获得管理身份');
        } catch (e) { alert('失败: ' + e.message); }
      });
    });
  }
  document.getElementById('mpSearch').addEventListener('input', e => render(e.target.value));
  render('');
}

async function safeRender(fn){
  try { await fn(); }
  catch (e) {
    console.error('[safeRender] ' + (fn.name || 'render') + ' 失败:', e);
    // v25.55: render 失败时把错误显示在 tab 内容区, 不再静默空白
    const _names = { renderMessages: 'msgList', renderPlayers: 'playerList', renderBookings: 'bookList', renderLicense: 'licenseList', renderKarts: 'kartList', renderCircuits: 'circuitList', renderAdminList: 'adminList', renderAnnouncements: 'annList', renderGallery: 'galGrid' };
    const _el = document.getElementById(_names[fn.name] || '');
    if (_el) _el.innerHTML = '<div class="empty-state" style="color:#c44"><div class="empty-icon">⚠️</div><p>加载失败: ' + (e.message || e) + '</p><p style="font-size:12px">打开浏览器 Console (F12) 看详细错误, 或点 🔄 刷新按钮重试</p></div>';
  }
}

// v25.64: 全局 .pane-refresh 按钮事件委托 — 调对应 render 函数强制重 fetch (bypass cache)
const _RENDER_ENDPOINTS = {
  renderMessages: '/api/admin/messages',
  renderPlayers: '/api/admin/players',
  renderBookings: '/api/admin/bookings',
  renderLicense: '/api/admin/license',
  renderKarts: '/api/admin/kart',
  renderCircuits: '/api/admin/circuit',
  renderAdminList: '/api/admin/admins',
  renderAnnouncements: '/api/announcements',
  renderGallery: '/api/gallery',
  renderDms: null, // DM 走 init endpoint, 单独处理
};
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.pane-refresh');
  if (!btn) return;
  const target = btn.dataset.target;
  const fn = window[target];
  if (typeof fn === 'function') {
    const endpoint = _RENDER_ENDPOINTS[target];
    if (endpoint) GET(endpoint, true); // 先清 cache
    btn.disabled = true;
    btn.textContent = '⏳ 刷新中...';
    safeRender(fn).finally(() => {
      setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 刷新'; }, 600);
    });
  }
});
  // ============================================================
  // Super 管理员 - 公告管理 (v17.8)
  // ============================================================
  async function renderAnnouncements() {
    if (!window._me || window._me.role !== 'super') return;
    // super 可见 "+ 发布新公告" 按钮
    const _annCreateBtn = document.getElementById('annCreateBtn');
    if (_annCreateBtn) {
      _annCreateBtn.style.display = '';
      _annCreateBtn.onclick = () => showAnnModal(null);
    }
    const list = document.getElementById('annList');
    const empty = document.getElementById('annEmpty');
    if (!list || !empty) return;
    list.innerHTML = '<p class="empty-state">载入中…</p>';
    empty.style.display = 'none';
    try {
      const r = await fetch('/api/announcements', { credentials: 'same-origin' });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || '加载失败');
      const anns = d.announcements || [];
      if (anns.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'flex';
        return;
      }
      list.innerHTML = anns.map(a => `
        <article class="msg-item ann-item" data-id="${a.id}">
          ${a.image_url ? `<img src="${esc(a.image_url)}" alt="封面图" loading="lazy" style="width:100%;max-height:140px;object-fit:cover;border-radius:4px;margin-bottom:8px;display:block;" onerror="this.style.opacity=0" />` : ''}
          <div class="msg-head"><div class="msg-head-left">
            <b class="msg-name">📢 ${esc(a.title)}</b>
            <span class="msg-read-tag">仅 SUPER</span>
          </div><div class="msg-time">${fmt(a.created_at)}${a.updated_at ? ' <span style="color:var(--c-stone-dark)">· 已编辑</span>' : ''}</div></div>
          <div class="msg-content" style="white-space:pre-wrap">${esc(a.content)}</div>
          <div class="msg-content ann-meta">✍️ 发布者：${esc(a.admin_username || '未知')} · 📅 ${fmt(a.created_at)}${a.updated_at ? ' · 🕓 更新：' + fmt(a.updated_at) : ''}</div>
          <div class="msg-actions book-actions">
            <button class="btn btn-primary btn-sm" data-act="edit">✎ 编辑</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-act="del">🗑 删除</button>
          </div>
        </article>`).join('');
      list.querySelectorAll('.ann-item').forEach(el => {
        const id = +el.dataset.id;
        el.querySelector('[data-act="edit"]').onclick = () => {
          const a = anns.find(x => x.id === id);
          if (a) showAnnModal(a);
        };
        el.querySelector('[data-act="del"]').onclick = () => annDel(id);
      });
    } catch (e) {
      list.innerHTML = '<p style="color:#c33;padding:20px;text-align:center">✗ ' + esc(e.message) + '</p>';
    }
  }

  function showAnnModal(ann) {
    const isNew = !ann;
    const old = document.getElementById('annModalBackdrop');
    if (old) old.remove();
    const bd = document.createElement('div');
    bd.id = 'annModalBackdrop';
    bd.className = 'modal-mask';
    bd.style.zIndex = '200';
    bd.innerHTML = `
      <div class="modal" style="max-width:620px;">
        <div class="modal-head">
          <h3>${isNew ? '📢 发布新公告' : '✎ 编辑公告 #' + ann.id}</h3>
          <button class="modal-close" id="annClose" type="button">✕</button>
        </div>
        <div class="modal-body">
          <form id="annForm" class="modal-form" onsubmit="return false;">
            <label>
              <span>标题（2-80 字）</span>
              <input id="annTitle" maxlength="80" value="${esc(ann ? ann.title : '')}" placeholder="如：灯光市开通新交通线" />
            </label>
            <label>
              <span>内容（2-2000 字）</span>
              <textarea id="annContent" maxlength="2000" placeholder="公告正文..." style="min-height:160px;line-height:1.5;resize:vertical;">${esc(ann ? ann.content : '')}</textarea>
              <span id="annCount" style="display:block;color:var(--c-stone-dark);font-size:12px;margin-top:2px;text-align:right;font-family:var(--font-cn);">0 / 2000</span>
            </label>
            <label>
              <span>封面图（选填 · 可输入 URL 或选文件上传）</span>
              <input id="annImageUrl" data-f="image_url" maxlength="2000" value="${esc(ann ? (ann.image_url || '') : '')}" placeholder="https://... 或 data:image/png;base64,..." />
            </label>
            <div class="modal-actions">
              <button id="annCancel" type="button" class="btn btn-ghost">取消</button>
              <button id="annSave" type="button" class="btn btn-primary">${isNew ? '📢 发布' : '💾 保存'}</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(bd);
    _attachFileUpload(bd);
    const ti = bd.querySelector('#annTitle');
    const ta = bd.querySelector('#annContent');
    const cnt = bd.querySelector('#annCount');
    const upd = () => { cnt.textContent = ta.value.length + ' / 2000'; };
    ta.addEventListener('input', upd);
    upd();
    const close = () => bd.remove();
    bd.addEventListener('click', e => { if (e.target === bd) close(); });
    bd.querySelector('#annClose').onclick = close;
    bd.querySelector('#annCancel').onclick = close;
    bd.querySelector('#annSave').onclick = async () => {
      const title = ti.value.trim();
      const content = ta.value.trim();
      if (title.length < 2) { alert('标题至少 2 字'); ti.focus(); return; }
      if (content.length < 2) { alert('内容至少 2 字'); ta.focus(); return; }
      const btn = bd.querySelector('#annSave');
      btn.disabled = true; btn.textContent = '⏳ 保存中...';
      try {
        const url = isNew ? '/api/init?action=announcement-create' : '/api/init?action=announcement-update&id=' + ann.id;
        const method = 'POST';
        const r = await fetch(url, {
          method, credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, image_url: bd.querySelector('#annImageUrl').value.trim() })
        });
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error || '保存失败');
        close();
        renderAnnouncements();
      } catch (e) {
        alert('保存失败: ' + e.message);
        btn.disabled = false; btn.textContent = isNew ? '📢 发布' : '💾 保存';
      }
    };
    setTimeout(() => ti.focus(), 50);
  }

  async function annDel(id) {
    if (!confirm('删除该公告？此操作不可恢复。')) return;
    try {
      const r = await fetch('/api/init?action=announcement-delete&id=' + id, {
        method: 'POST', credentials: 'same-origin'
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || '删除失败');
      renderAnnouncements();
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }

  // 创建按钮
  const btnAnnCreate = document.getElementById('btnAnnCreate');
  if (btnAnnCreate) btnAnnCreate.addEventListener('click', () => showAnnModal(null));

  // ============================================================
  // v18: 首页图集管理 (super only)
  // ============================================================
  let _galAll = [];      // 缓存当前列表
  let _galFilter = '';   // 当前分类过滤
  async function renderGallery() {
    if (!window._me || window._me.role !== 'super') return;
    const _galCreateBtn = document.getElementById('galCreateBtn');
    if (_galCreateBtn) {
      _galCreateBtn.style.display = '';
      _galCreateBtn.onclick = () => showGalModal(null);
    }
    const grid = document.getElementById('galGrid');
    const empty = document.getElementById('galEmpty');
    if (!grid || !empty) return;
    grid.innerHTML = '<p class="empty-state">载入中…</p>';
    empty.style.display = 'none';
    try {
      const r = await fetch('/api/gallery', { credentials: 'same-origin' });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || '加载失败');
      _galAll = d.items || [];
      // 分类过滤按钮激活态
      document.querySelectorAll('.gal-cat-btn').forEach(b => {
        b.classList.toggle('active', (b.dataset.cat || '') === _galFilter);
      });
      const list = _galFilter ? _galAll.filter(x => x.cat === _galFilter) : _galAll;
      if (list.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'flex';
        return;
      }
      grid.innerHTML = list.map(it => `
        <div class="gal-item" data-id="${it.id}" style="background:#fff;border:2px solid ${it.is_published ? '#5fa' : '#aaa'};border-radius:6px;overflow:hidden;display:flex;flex-direction:column;">
          <div style="aspect-ratio:1/1;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;">
            <img src="${esc(it.file_url)}" alt="${esc(it.label)}" loading="lazy" style="max-width:100%;max-height:100%;object-fit:contain;" onerror="this.style.opacity=.3;this.alt='加载失败'" />
          </div>
          <div style="padding:8px;font-size:12px;line-height:1.4;">
            <div style="font-weight:700;color:#4a3a2a;margin-bottom:2px;">#${it.num} ${esc(it.label)}</div>
            <div style="color:#7a6a5a;">${esc(it.cat)}${it.is_featured ? ' · ⭐精选' : ''}${it.is_published ? '' : ' · ⛔草稿'}</div>
            <div style="display:flex;gap:4px;margin-top:6px;">
              <button class="btn btn-ghost btn-sm gal-edit" data-id="${it.id}" style="flex:1;font-size:11px;padding:4px;">✎</button>
              <button class="btn btn-ghost btn-sm gal-toggle" data-id="${it.id}" style="flex:1;font-size:11px;padding:4px;">${it.is_published ? '下架' : '上架'}</button>
              <button class="btn btn-ghost btn-sm gal-feat" data-id="${it.id}" style="flex:1;font-size:11px;padding:4px;">${it.is_featured ? '取消精选' : '⭐精选'}</button>
              <button class="btn btn-ghost btn-sm gal-del" data-id="${it.id}" style="flex:1;font-size:11px;padding:4px;background:#c33;color:#fff;">🗑</button>
            </div>
          </div>
        </div>
      `).join('');
      grid.querySelectorAll('.gal-edit').forEach(b => b.onclick = () => {
        const it = _galAll.find(x => x.id === +b.dataset.id);
        if (it) showGalModal(it);
      });
      grid.querySelectorAll('.gal-toggle').forEach(b => b.onclick = () => galToggle(+b.dataset.id));
      grid.querySelectorAll('.gal-feat').forEach(b => b.onclick = () => galFeat(+b.dataset.id));
      grid.querySelectorAll('.gal-del').forEach(b => b.onclick = () => galDel(+b.dataset.id));
    } catch (e) {
      grid.innerHTML = '<p style="color:#c33;padding:20px;text-align:center">✗ ' + esc(e.message) + '</p>';
    }
  }

  function showGalModal(item) {
    const isNew = !item;
    const old = document.getElementById('galModalBackdrop');
    if (old) old.remove();
    const bd = document.createElement('div');
    bd.id = 'galModalBackdrop';
    bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    const _v = (k) => item ? esc(item[k] || '') : '';
    bd.innerHTML = `
      <div style="background:var(--c-cream,#f5e6c5);border:3px solid #000;box-shadow:6px 6px 0 #000;max-height:90vh;overflow-y:auto;">
        <h3 style="margin:0 0 12px;color:#000;font-size:16px;">${isNew ? '🖼️ 添加首页图片' : '✎ 编辑图片 #' + item.id}</h3>
        <label style="display:block;margin-bottom:8px;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">编号 (1-999, 唯一, 控制显示顺序)</span>
          <input id="galNum" type="number" min="1" max="999" value="${_v('num')}" style="width:100%;padding:8px 10px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:14px;box-sizing:border-box;" />
        </label>
        <label style="display:block;margin-bottom:8px;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">分类</span>
          <select id="galCat" style="width:100%;padding:8px 10px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:14px;box-sizing:border-box;">
            <option value="city">城市 (city)</option>
            <option value="road">路网 (road)</option>
            <option value="kart">赛道 (kart)</option>
            <option value="nature">自然 (nature)</option>
            <option value="announcement">公告配图 (announcement)</option>
          </select>
        </label>
        <label style="display:block;margin-bottom:8px;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">标题 (label, 80 字内)</span>
          <input id="galLabel" maxlength="80" value="${_v('label')}" placeholder="如：市中心发言台" style="width:100%;padding:8px 10px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:14px;box-sizing:border-box;" />
        </label>
        <label style="display:block;margin-bottom:8px;">
          <span style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">图片 (二选一)</span>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <input id="galFile" type="file" accept="image/*" style="flex:1;font-size:12px;color:#ccc;" />
            <span style="color:#888;font-size:11px;">或粘贴 URL ↓</span>
          </div>
          <textarea id="galUrl" maxlength="2000" placeholder="https://... 或 data:image/png;base64,..." style="width:100%;min-height:80px;padding:8px 10px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:monospace;font-size:12px;line-height:1.4;resize:vertical;box-sizing:border-box;">${_v('file_url')}</textarea>
          <div id="galPreview" style="margin-top:6px;max-width:100%;max-height:160px;overflow:hidden;display:${_v('file_url') ? 'block' : 'none'};">
            <img id="galPreviewImg" src="${_v('file_url')}" style="max-width:100%;max-height:160px;border-radius:4px;" />
          </div>
        </label>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
          <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:13px;">
            排序 (小在前)
            <input id="galSort" type="number" value="${_v('sort_order') || 0}" style="width:80px;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0f0f1a;color:#eee;font-family:inherit;font-size:13px;" />
          </label>
          <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:13px;">
            <input id="galFeat" type="checkbox" ${item && item.is_featured ? 'checked' : ''} /> ⭐ 精选
          </label>
          <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:13px;">
            <input id="galPub" type="checkbox" ${isNew || (item && item.is_published) ? 'checked' : ''} /> 📢 上架
          </label>
        </label>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
          <button id="galCancel" type="button" style="background:#555;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:13px;">取消</button>
          <button id="galSave" type="button" style="background:#6cf;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px;">${isNew ? '🖼️ 添加' : '💾 保存'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(bd);
    if (item) {
      // 选中 cat
      const _catEl = bd.querySelector('#galCat');
      if (_catEl) _catEl.value = item.cat || 'city';
    }
    // v20: 文件选择 → FileReader 转 base64 → 填入 URL + 预览
    const _fileInput = bd.querySelector('#galFile');
    const _urlInput = bd.querySelector('#galUrl');
    const _preview = bd.querySelector('#galPreview');
    const _previewImg = bd.querySelector('#galPreviewImg');
    if (_fileInput) {
      _fileInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        if (f.size > 3 * 1024 * 1024) { alert('文件太大 (上限 3MB)'); _fileInput.value = ''; return; }
        const reader = new FileReader();
        e.target._fileReading = true;
        reader.onload = (ev) => {
          e.target._fileReading = false;
          const dataUrl = ev.target.result;
          _urlInput.value = dataUrl;
          if (_previewImg) _previewImg.src = dataUrl;
          if (_preview) _preview.style.display = 'block';
        };
        reader.readAsDataURL(f);
      });
    }
    if (_urlInput) {
      _urlInput.addEventListener('input', () => {
        if (_previewImg) _previewImg.src = _urlInput.value;
        if (_preview) _preview.style.display = _urlInput.value ? 'block' : 'none';
      });
    }
    const close = () => bd.remove();
    bd.addEventListener('click', e => { if (e.target === bd) close(); });
    bd.querySelector('#galCancel').onclick = close;
    bd.querySelector('#galSave').onclick = async () => {
      const num = parseInt(bd.querySelector('#galNum').value, 10);
      const cat = bd.querySelector('#galCat').value;
      const label = bd.querySelector('#galLabel').value.trim();
      const file_url = bd.querySelector('#galUrl').value.trim();
      const sort_order = parseInt(bd.querySelector('#galSort').value, 10) || 0;
      const is_featured = bd.querySelector('#galFeat').checked ? 1 : 0;
      const is_published = bd.querySelector('#galPub').checked ? 1 : 0;
      if (!num || num < 1) { alert('编号必须是正整数'); return; }
      if (!label) { alert('标题必填'); return; }
      if (!file_url) { alert('图片 URL 必填'); return; }
      if (!/^https?:\/\//i.test(file_url) && !/^data:image\//i.test(file_url)) {
        alert('URL 必须是 https:// 或 data:image/ 开头'); return;
      }
      const btn = bd.querySelector('#galSave');
      btn.disabled = true; btn.textContent = '⏳ 保存中...';
      try {
        const url = isNew ? '/api/gallery' : '/api/gallery?id=' + item.id;
        const method = isNew ? 'POST' : 'PATCH';
        const r = await fetch(url, {
          method, credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ num, cat, label, file_url, sort_order, is_featured, is_published })
        });
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error || '保存失败');
        close();
        renderGallery();
      } catch (e) {
        alert('保存失败: ' + e.message);
        btn.disabled = false; btn.textContent = isNew ? '🖼️ 添加' : '💾 保存';
      }
    };
    setTimeout(() => bd.querySelector('#galLabel').focus(), 50);
  }

  async function galToggle(id) {
    const it = _galAll.find(x => x.id === id);
    if (!it) return;
    try {
      const r = await fetch('/api/gallery?id=' + id, {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_published: !it.is_published ? 1 : 0 })
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || '失败');
      renderGallery();
    } catch (e) { alert('操作失败: ' + e.message); }
  }
  async function galFeat(id) {
    const it = _galAll.find(x => x.id === id);
    if (!it) return;
    try {
      const r = await fetch('/api/gallery?id=' + id, {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_featured: !it.is_featured ? 1 : 0 })
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || '失败');
      renderGallery();
    } catch (e) { alert('操作失败: ' + e.message); }
  }
  async function galDel(id) {
    if (!confirm('删除该图片？此操作不可恢复。')) return;
    try {
      const r = await fetch('/api/gallery?id=' + id, {
        method: 'DELETE', credentials: 'same-origin'
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || '失败');
      renderGallery();
    } catch (e) { alert('删除失败: ' + e.message); }
  }

  // 分类过滤
  document.querySelectorAll('.gal-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _galFilter = btn.dataset.cat || '';
      renderGallery();
    });
  });

function renderDash(){
  try{
    const a=window._me;
    $('#userName').textContent=a.username;
    const r=$('#userRole');
    r.textContent=a.role==='super'?'SUPER':'ADMIN';
    r.className='role-tag role-'+a.role;
    const ba=$('#btnAddAdmin');
    if(ba)ba.style.display=a.role==='super'?'':'none';
  }catch(e){throw e;}
  showView('dash');
  // v25.54: 9 个 render 并行 fetch (之前 await 串行 9 个 ~ 3-4.5s, 改 Promise.all 降到 ~0.5-1s)
  Promise.all([
    safeRender(renderMessages),
    safeRender(renderPlayers),
    safeRender(renderBookings),
    safeRender(renderLicense),
    safeRender(renderKarts),
    safeRender(renderCircuits),
    safeRender(renderAdminList),
    safeRender(renderAnnouncements),
    safeRender(renderGallery),
  ]);
  // 仅 super 可见 DM 监管 tab
  try {
    if (window._me && window._me.role === 'super') {
      const td = document.getElementById('tabDms');
      if (td) td.style.display = '';
      const ta = document.getElementById('tabAnnouncements');
      if (ta) ta.style.display = '';
      // 初次拉 AI 转人工数
      fetch('/api/init?action=admin-dm-ai-struggle', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(r => r.json()).then(d => {
          if (d.ok) {
            const c = (d.struggles || []).length;
            const e = document.getElementById('dmsAiStruggle');
            if (e) e.textContent = String(c);
          }
        }).catch(() => {});
    }
  } catch (e) {}
}

// tab 切换
$$('.admin-tabs .tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const t=btn.dataset.tab;
    $$('.admin-tabs .tab').forEach(b=>b.classList.toggle('active',b===btn));
    $$('.tab-pane').forEach(p=>{
      const isActive = p.id==='pane-'+t;
      p.classList.toggle('active',isActive);
      p.style.display = isActive ? '' : 'none';
    });
    // 切换主 tab 时重置所有 sub-tabs 的 active 状态, 避免旧 pane 的 sub-tab 仍高亮
    $$('.subtab').forEach(b=>b.classList.remove('active'));
    // 恢复各 pane 的默认 sub-tab active (报名记录, 即 data-sub="signup")
    const _defaultSub = $$('.subtabs[data-pane="'+t+'"] .subtab[data-sub="signup"]');
    if(_defaultSub.length) _defaultSub[0].classList.add('active');
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

// 超管代注册玩家按钮 (仅 super 可见)
const btnPlayerCreate=$('#btnPlayerCreate');
if(btnPlayerCreate){
  btnPlayerCreate.addEventListener('click',showCreatePlayerModal);
}

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
// v17.9: combined session 时, 用 admin-logout 只清 admin 身份, 保留 player 身份 (跳玩家首页)
const btnLogout=$('#btnLogout');
if(btnLogout){
  btnLogout.addEventListener('click',async()=>{
    let _isCombined = false;
    try {
      const _me = await GET('/api/login');
      _isCombined = !!(_me && _me.combined && _me.player);
    } catch(e){}
    if (_isCombined) {
      if(!confirm('退出管理后台?\n\n玩家身份会保留, 你将被带回玩家首页。')) return;
      try {
        const _r = await POST('/api/init?action=admin-logout', {});
        // 后端会写新 cookie (只含 player_id), 跳玩家首页
        window._me = null;
        location.href = 'index.html';
      } catch(e){ alert('退出失败: ' + e.message); }
    } else {
      if(!confirm('确认退出登录？'))return;
      try{await DEL('/api/login');}catch(e){}
      window._me=null;showView('login');
    }
  });
}

// ============================================================
// Super 管理员 - DM 私信监管 + 代回复 (v17.0)
// ============================================================
async function renderDms(query) {
  if (!window._me || window._me.role !== 'super') return;
  const list = document.getElementById('dmList');
  const empty = document.getElementById('dmEmpty');
  if (!list) return;
  list.innerHTML = ''; empty && (empty.style.display = 'none');
  try {
    // 用 admin-dm-conversations 端点: 服务端已按 (from,to) pair 聚合, 每对只 1 条最新 + 未读数
    const r = await fetch('/api/init?action=admin-dm-conversations', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query || '' }),
    });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || '加载失败');
    const convs = d.conversations || [];
    if (convs.length === 0) {
      list.innerHTML = '';
      if (empty) { empty.style.display = ''; } else { list.innerHTML = '<p class="empty-state">暂无 DM 记录</p>'; }
      return;
    }
    list.innerHTML = convs.map(p => {
      const isAiReply = p.from_username === '灯灯客服';
      const unread = p.unread_count || 0;
      // v17.8: 回复人审计 — AI 还是某位管理员
      let replyTag = '';
      if (isAiReply) {
        if (p.replied_by_admin_id && p.replied_by_admin_username) {
          // 管理员借 AI 身份代发
          replyTag = `<span style="background:#1a1a3a;color:#9cf;padding:1px 6px;border-radius:3px;font-size:11px;margin-left:6px" title="管理员 ${esc(p.replied_by_admin_username)} 借灯灯客服身份代发">👤 管理员 ${esc(p.replied_by_admin_username)} 已回复</span>`;
        } else {
          // AI 客服自动回复
          replyTag = '<span style="background:#1a2a1a;color:#9f9;padding:1px 6px;border-radius:3px;font-size:11px;margin-left:6px">🤖 AI 已回复</span>';
        }
      }
      return `<div class="msg-item dm-pair" data-pid1="${p.from_player_id}" data-pid2="${p.to_player_id}" style="cursor:pointer${unread>0?';border-left:4px solid var(--c-emerald)':''}">
        <div class="msg-avatar">${isAiReply ? '🤖' : (p.from_avatar || '👤')}</div>
        <div class="msg-body">
          <div class="msg-meta">
            <b>${esc(p.from_username || '?')}</b> → <b>${esc(p.to_username || '?')}</b>
            ${replyTag}
            ${unread>0?`<span style="background:#a33;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;margin-left:6px">💬 ${unread} 未读</span>`:''}
            <span style="float:right;font-size:11px;color:#888">${p.last_at}</span>
          </div>
          <div class="msg-content" style="color:var(--c-stone-dark);font-size:13px;max-height:60px;overflow:hidden">${esc((p.last_content||'').slice(0,200))}</div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.dm-pair').forEach(el => {
      el.onclick = () => openDmThread(parseInt(el.dataset.pid1, 10), parseInt(el.dataset.pid2, 10));
    });
  } catch (e) {
    list.innerHTML = '<p class="empty-state" style="color:#c33">✗ ' + esc(e.message) + '</p>';
  }
}

async function openDmThread(pid1, pid2) {
  const md = document.getElementById('modalMask');
  const mt = document.getElementById('modalTitle');
  const mb = document.getElementById('modalBody');
  if (!md) return;
  mt.textContent = '私信对话 # ' + pid1 + ' ↔ ' + pid2;
  mb.innerHTML = '<p style="padding:20px;text-align:center;color:#888">载入中…</p>';
  md.style.display = '';
  try {
    // 拿双方 username
    const r1 = await fetch('/api/admin/players?id=' + pid1, { credentials: 'same-origin' }).catch(() => null);
    // 用 admin 玩家列表查 username
    let fromName = '?', toName = '?';
    try {
      const rP = await fetch('/api/admin/players?id=' + pid1, { credentials: 'same-origin' });
      const dP = await rP.json();
      if (dP.ok && dP.players) fromName = dP.players.find(x => x.id === pid1)?.username || '?';
    } catch (e) {}
    try {
      const rP2 = await fetch('/api/admin/players?id=' + pid2, { credentials: 'same-origin' });
      const dP2 = await rP2.json();
      if (dP2.ok && dP2.players) toName = dP2.players.find(x => x.id === pid2)?.username || '?';
    } catch (e) {}

    const r = await fetch('/api/init?action=admin-dm-thread&player_id=' + pid1 + '&peer_id=' + pid2, { credentials: 'same-origin' });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || '加载失败');
    const msgs = d.messages || [];

    // 找"哪个是玩家、哪个是 bot"
    const playerId = fromName === '灯灯客服' ? pid2 : (toName === '灯灯客服' ? pid1 : pid1);
    const botId = fromName === '灯灯客服' ? pid1 : (toName === '灯灯客服' ? pid2 : null);
    const humanName = fromName === '灯灯客服' ? toName : fromName;
    // 最后一条非 AI 的发言作为 AI 辅助生成的上下文
    const lastPlayerMsg = [...msgs].reverse().find(m => m.from_username !== '灯灯客服');

    mb.innerHTML = `
      <div style="max-height:400px;overflow-y:auto;background:var(--c-bg-2);padding:8px;margin-bottom:12px">
        ${msgs.length===0?'<p style="color:var(--c-stone, #7a6a5a);text-align:center;padding:20px;font-size:13px">（暂无消息）</p>':''}
        ${msgs.map(m => {
          const isBot = m.from_username === '灯灯客服';
          const isAdmin = m.from_username === '灯灯客服' && m.content && m.content.length > 0;
          return `<div style="display:flex;gap:6px;margin-bottom:6px;${isBot?'justify-content:flex-end':''}">
            <div style="max-width:75%;padding:6px 10px;border-radius:6px;${isBot?'background:#1a2a1a;color:#9f9':'background:#fff;color:#333'}">
              <div style="font-size:10px;color:#888;margin-bottom:2px">${esc(m.from_username||'?')} · ${m.created_at}</div>
              <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word">${esc(m.content||'')}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
      ${botId ? `
      <div style="border-top:2px solid var(--c-stone);padding-top:10px">
        <div style="font-size:12px;color:#666;margin-bottom:6px">✍️ 借 <b>灯灯客服</b> 身份回复给 <b>${esc(humanName)}</b>：</div>
        <textarea id="dmReplyText" style="width:100%;min-height:80px;padding:8px;border:2px solid var(--c-stone);background:var(--c-bg-1);font-family:inherit;font-size:13px;box-sizing:border-box" placeholder="输入回复内容（最多 100 字）..." maxlength="100"></textarea>
        <div style="font-size:11px;color:#888;margin-top:4px"><span id="dmReplyCount">0</span> / 100 字</div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:flex-end">
          <button type="button" id="dmAiBtn" class="btn btn-secondary btn-sm" title="AI 辅助生成 100 字内回复草稿" style="background:linear-gradient(135deg,#5a2,#2a5);color:#fff">🤖 AI 辅助生成</button>
          <button type="button" id="dmReplyCancel" class="btn btn-ghost btn-sm">关闭</button>
          <button type="button" id="dmReplySend" class="btn btn-primary btn-sm">📤 以灯灯客服身份发送</button>
        </div>
        <div id="dmReplyMsg" style="font-size:12px;margin-top:6px;color:#666"></div>
      </div>
      ` : '<p style="color:#888;font-size:12px;text-align:center;padding:10px">此对话双方都是普通玩家，无法借 AI 身份回复。请直接联系玩家。</p>'}
    `;
    // 字数计数
    const ta=document.getElementById('dmReplyText');
    const cnt=document.getElementById('dmReplyCount');
    if(ta&&cnt){ta.addEventListener('input',()=>{cnt.textContent=ta.value.length;});}
    const sendBtn = document.getElementById('dmReplySend');
    const cancelBtn = document.getElementById('dmReplyCancel');
    const aiBtn = document.getElementById('dmAiBtn');
    if (cancelBtn) cancelBtn.onclick = () => md.style.display = 'none';
    if (aiBtn && lastPlayerMsg) {
      aiBtn.onclick = async () => {
        const toPlayerId = fromName === '灯灯客服' ? pid2 : pid1;
        const orig = aiBtn.textContent;
        aiBtn.disabled = true;
        aiBtn.textContent = '⏳ AI 生成中…';
        try {
          const r = await fetch('/api/init?action=admin-dm-ai-suggest', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to_player_id: toPlayerId, last_message: lastPlayerMsg.content || '' }),
          });
          const dd = await r.json();
          if (!r.ok || dd.error) throw new Error(dd.error || 'AI 失败');
          const taEl = document.getElementById('dmReplyText');
          if (taEl) {
            taEl.value = dd.draft || '';
            taEl.focus();
            if(cnt)cnt.textContent = taEl.value.length;
          }
          aiBtn.textContent = '✅ 已生成 (' + (dd.draft||'').length + '字)';
          setTimeout(() => { aiBtn.textContent = orig; }, 2500);
        } catch (e) {
          aiBtn.textContent = '✗ ' + (e.message || '失败');
          setTimeout(() => { aiBtn.textContent = orig; }, 2500);
        } finally {
          aiBtn.disabled = false;
        }
      };
    } else if (aiBtn) {
      aiBtn.disabled = true;
      aiBtn.title = '没有玩家发言可参考';
    }
    if (sendBtn) {
      sendBtn.onclick = async () => {
        const ta = document.getElementById('dmReplyText');
        const content = (ta?.value || '').trim();
        if (!content) { alert('请输入回复内容'); return; }
        if (content.length > 100) { alert('最多 100 字'); return; }
        const toPlayerId = fromName === '灯灯客服' ? pid2 : pid1;
        sendBtn.disabled = true;
        const orig = sendBtn.textContent;
        sendBtn.textContent = '⏳ 发送中...';
        try {
          const r = await fetch('/api/init?action=admin-dm-reply', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to_player_id: toPlayerId, content }),
          });
          const d = await r.json();
          if (!r.ok || d.error) throw new Error(d.error || '发送失败');
          const msgEl = document.getElementById('dmReplyMsg');
          msgEl.textContent = '✓ 已发送！';
          msgEl.style.color = 'var(--c-emerald)';
          setTimeout(() => openDmThread(pid1, pid2), 500);
        } catch (e) {
          alert('发送失败: ' + e.message);
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = orig;
        }
      };
    }
  } catch (e) {
    mb.innerHTML = '<p style="color:#c33;padding:20px;text-align:center">✗ ' + esc(e.message) + '</p>';
  }
}

async function renderDmAiStruggle() {
  if (!window._me || window._me.role !== 'super') return;
  const list = document.getElementById('dmList');
  if (!list) return;
  list.innerHTML = '<p class="empty-state">载入 AI 转人工列表…</p>';
  try {
    const r = await fetch('/api/init?action=admin-dm-ai-struggle', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || '加载失败');
    const ss = d.struggles || [];
    if (ss.length === 0) {
      list.innerHTML = '<p class="empty-state" style="background:none;border:none;padding:20px;text-align:center">🎉 AI 没有转人工的对话</p>';
      return;
    }
    list.innerHTML = '<p style="background:#fff3cd;border:2px solid #e8b840;padding:8px;margin-bottom:12px;font-size:12px">⚠️ 以下是 AI 客服给出"转人工"建议的对话，玩家可能需要人工协助。点击查看完整对话：</p>' + ss.map(s => {
      return `<div class="msg-item dm-pair" data-pid1="${s.from_player_id}" data-pid2="${s.to_player_id}" style="cursor:pointer;border-left:4px solid #e8b840">
        <div class="msg-avatar">🤖</div>
        <div class="msg-body">
          <div class="msg-meta">
            <b>${esc(s.to_username || '?')}</b> → <b>灯灯客服 (AI 转人工)</b>
            <span style="float:right;font-size:11px;color:#888">${s.created_at}</span>
          </div>
          <div class="msg-content" style="color:#444;font-size:13px;background:#fff8e0;padding:6px 8px;border-radius:4px;margin-top:4px">${esc((s.content||'').slice(0,200))}</div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.dm-pair').forEach(el => {
      el.onclick = () => openDmThread(parseInt(el.dataset.pid1, 10), parseInt(el.dataset.pid2, 10));
    });
  } catch (e) {
    list.innerHTML = '<p class="empty-state" style="color:#c33">✗ ' + esc(e.message) + '</p>';
  }
}

// DM 监管 tab 事件
(function setupDmTab() {
  const dmSearch = document.getElementById('dmSearch');
  if (dmSearch) {
    let timer = null;
    dmSearch.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => renderDms(dmSearch.value), 300);
    });
  }
  const btnRefresh = document.getElementById('btnDmRefresh');
  if (btnRefresh) btnRefresh.onclick = () => { const q = dmSearch?.value || ''; renderDms(q); };
  const btnAiStruggle = document.getElementById('btnDmAiStruggle');
  if (btnAiStruggle) btnAiStruggle.onclick = () => renderDmAiStruggle();
  // tab 切换钩子：进入 dms tab 时拉数据
  document.querySelectorAll('.admin-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'dms') renderDms();
    });
  });
  // modal 关闭按钮（兜底，其他 modal 也能用）
  const mc = document.getElementById('modalClose');
  if (mc) mc.onclick = () => { const mm = document.getElementById('modalMask'); if (mm) mm.style.display = 'none'; };
  const mm = document.getElementById('modalMask');
  if (mm) mm.addEventListener('click', (e) => { if (e.target === mm) mm.style.display = 'none'; });
})();

// ============================================================
// 统一刷新按钮（v17.1） - 每个 tab 一个 🔄 按钮
// ============================================================
(function setupRefreshButtons() {
  function attach(id, renderFn) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.onclick = async () => {
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ 刷新中...';
      try {
        await safeRender(renderFn);
        btn.textContent = '✓ 已刷新';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      } catch (e) {
        btn.textContent = '✗ 失败';
        setTimeout(() => { btn.textContent = orig; }, 2000);
      } finally {
        btn.disabled = false;
      }
    };
  }
  attach('btnMsgRefresh',     renderMessages);
  attach('btnPlayerRefresh',  renderPlayers);
  attach('btnBookRefresh',    renderBookings);
  attach('btnLicenseRefresh', renderLicense);
  attach('btnKartRefresh',    renderKarts);
  attach('btnCircuitRefresh', renderCircuits);
  attach('btnAdminRefresh',   renderAdminList);
  attach('btnAnnRefresh',     renderAnnouncements);
  // btnDmRefresh already handled above
})();

boot();
})();

// ============================================================
// v25.20: 酒店/赛车场/驾照 manage 渲染 (用 window.__manageData, 不 fetch)
// ============================================================
(function(){
  // sub-tab 切换
  document.addEventListener('click', function(e){
    var tab = e.target.closest('.subtab');
    if (!tab) return;
    var nav = tab.closest('.subtabs');
    if (!nav) return;
    var pane = nav.dataset.pane;
    var sub = tab.dataset.sub;
    nav.querySelectorAll('.subtab').forEach(function(b){ b.classList.toggle('active', b === tab); });
    document.querySelectorAll('.subview[data-subview^="'+pane+'-"]').forEach(function(sv){
      sv.classList.toggle('active', sv.dataset.subview === pane+'-'+sub);
    });
    if (sub === 'manage') {
      if (pane === 'bookings') renderHotelManage();
      else if (pane === 'license') renderLicenseManage();
      else if (pane === 'kart') renderTrackManage();
    }
  });

  // super 才看 manage 按钮
  if (window._me && window._me.role === 'super') {
    document.querySelectorAll('[data-super-only]').forEach(function(el){ el.style.display = ''; });
  }

  // escape
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){ return ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'})[c]; }); }


// ============================================================
// v25.22: + 新建按钮 click handler (inline form, 不弹 modal)
// ============================================================
(function(){
  // esc helper (复用了之前那个, 但确保能用)
  function esc2(s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){ return ({'<':'&lt;','>':'&gt;','&amp;':'&amp;','"':'&quot;',"'":'&#39;'})[c]; }); }

  // 通用: 简易 inline form
  function _buildInlineForm(opts) {
    var fields = opts.fields.map(function(f){
      return '<label style="display:block;margin:6px 0;font-size:13px;">' +
        '<span style="display:block;font-weight:700;margin-bottom:2px;">' + esc2(f.label) + '</span>' +
        (f.type === 'textarea' ? '<textarea data-f="' + f.name + '" rows="3" style="width:100%;padding:6px;border:2px solid var(--c-black);font-family:var(--font-cn);">' + esc2(f.value || '') + '</textarea>'
          : '<input data-f="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc2(f.value || '') + '" style="width:100%;padding:6px;border:2px solid var(--c-black);font-family:var(--font-cn);" />') +
        '</label>';
    }).join('');
    return '<div style="background:#fffbe5;border:3px solid var(--c-black);padding:12px;margin:8px 0;box-shadow:4px 4px 0 var(--c-stone-dark);">' +
      '<div style="font-weight:700;color:var(--c-grass-dark);margin-bottom:8px;">' + esc2(opts.title) + '</div>' +
      fields +
      '<div style="margin-top:8px;display:flex;gap:6px;">' +
        '<button data-act="save" class="btn btn-primary btn-sm">💾 保存</button>' +
        '<button data-act="cancel" class="btn btn-ghost btn-sm">取消</button>' +
      '</div></div>';
  }

  // 通用: 提交表单 → API
  // v25.32: 先等所有 pending file uploads 完成再提交（避免 base64 还没好就发了）
  async function _submitForm(btn, action, body, onSuccess) {
    var form = btn.closest('[data-form-wrap]') || btn.parentElement.parentElement;
    // 等所有 pending file reads 完成
    var pendingFiles = form.querySelectorAll('input[type="file"][name^="_file_"]');
    await Promise.all([].slice.call(pendingFiles).map(function(fi){
      if (!fi.files || !fi.files[0] || !fi._fileReading) return Promise.resolve();
      return new Promise(function(res){
        var intId = setInterval(function(){
          if (!fi._fileReading) { clearInterval(intId); res(); }
        }, 50);
        // 超时 10s 保护
        setTimeout(function(){ clearInterval(intId); res(); }, 10000);
      });
    }));
    var inputs = form.querySelectorAll('[data-f]');
    inputs.forEach(function(inp){ body[inp.dataset.f] = inp.value; });
    btn.disabled = true; btn.textContent = '⏳ 保存中...';
    try {
      var r = await fetch(action, { method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
      var d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || '保存失败');
      if (onSuccess) onSuccess(d);
    } catch (e) {
      alert('保存失败: ' + e.message);
      btn.disabled = false; btn.textContent = '💾 保存';
    }
  }

  // + 新建酒店
  var _btnAddHotel = document.getElementById('btnAddHotel');
  if (_btnAddHotel) {
    _btnAddHotel.addEventListener('click', function(){
      var list = document.getElementById('hotelManageList');
      var oldForm = list.querySelector('[data-form-wrap]');
      if (oldForm) oldForm.remove();
      var div = document.createElement('div');
      div.setAttribute('data-form-wrap', 'hotel');
      div.innerHTML = _buildInlineForm({
        title: '🏨 新建酒店',
        fields: [
          {name: 'name', label: '酒店名 *'},
          {name: 'address', label: '地址'},
          {name: 'description', label: '介绍', type: 'textarea'},
          {name: 'image_url', label: '图片 URL (选填)'},
          {name: 'sort_order', label: '排序', type: 'number', value: '99'},
        ]
      });
      list.insertBefore(div, list.firstChild);
      _attachFileUpload(div);  // v25.45: 立即挂文件上传, 不用等 Save click
      div.querySelector('[data-act="cancel"]').addEventListener('click', function(){ div.remove(); });
      div.querySelector('[data-act="save"]').addEventListener('click', function(){
        _submitForm(this, '/api/admin/hotels', {is_active:1}, function(){
          // 重新渲染
          var p = div.parentElement;
          div.remove();
          // 找 renderHotelManage 函数
          // 因为函数在 IIFE 内部, 不直接可访问 — 触发 subtab click 重新渲染
          var subtab = document.querySelector('.subtab.active[data-sub="manage"]');
          if (subtab) { subtab.click(); subtab.click(); }
        });
      });
    });
  }

  // + 新建赛车场
  var _btnAddTrack = document.getElementById('btnAddTrack');
  if (_btnAddTrack) {
    _btnAddTrack.addEventListener('click', function(){
      var list = document.getElementById('trackManageList');
      var oldForm = list.querySelector('[data-form-wrap]');
      if (oldForm) oldForm.remove();
      var div = document.createElement('div');
      div.setAttribute('data-form-wrap', 'track');
      div.innerHTML = _buildInlineForm({
        title: '🏁 新建赛车场',
        fields: [
          {name: 'name', label: '赛车场名 *'},
          {name: 'length_km', label: '长度 (km)', type: 'number', value: '1.0'},
          {name: 'laps', label: '圈数', type: 'number', value: '8'},
          {name: 'difficulty', label: '难度 (简单/中等/困难)'},
          {name: 'description', label: '介绍', type: 'textarea'},
          {name: 'image_url', label: '图片 URL (选填)'},
          {name: 'trial_price', label: '试车价格 (💎/次)', type: 'number', value: '0'},
          {name: 'sort_order', label: '排序', type: 'number', value: '99'},
        ]
      });
      list.insertBefore(div, list.firstChild);
      _attachFileUpload(div);  // v25.45: 立即挂文件上传, 不用等 Save click
      div.querySelector('[data-act="cancel"]').addEventListener('click', function(){ div.remove(); });
      div.querySelector('[data-act="save"]').addEventListener('click', function(){
        _submitForm(this, '/api/admin/race-tracks', {is_active:1}, function(){
          div.remove();
          var subtab = document.querySelector('.subtab.active[data-sub="manage"]');
          if (subtab) { subtab.click(); subtab.click(); }
        });
      });
    });
  }

  // + 新增驾照要求
  var _btnAddLicReq = document.getElementById('btnAddLicReq');
  if (_btnAddLicReq) {
    _btnAddLicReq.addEventListener('click', function(){
      var list = document.getElementById('licenseManageList');
      var oldForm = list.querySelector('[data-form-wrap]');
      if (oldForm) oldForm.remove();
      var div = document.createElement('div');
      div.setAttribute('data-form-wrap', 'license');
      div.innerHTML = _buildInlineForm({
        title: '🎫 新增驾照要求',
        fields: [
          {name: 'exam_type', label: '类型 (B / A / S) *'},
          {name: 'title', label: '标题 *'},
          {name: 'description', label: '介绍', type: 'textarea'},
          {name: 'requirements', label: '要求', type: 'textarea'},
          {name: 'min_age', label: '最小年龄', type: 'number', value: '16'},
          {name: 'duration_minutes', label: '时长 (分钟)', type: 'number', value: '45'},
          {name: 'sort_order', label: '排序', type: 'number', value: '99'},
        ]
      });
      list.insertBefore(div, list.firstChild);
      _attachFileUpload(div);  // v25.45: 立即挂文件上传, 不用等 Save click
      div.querySelector('[data-act="cancel"]').addEventListener('click', function(){ div.remove(); });
      div.querySelector('[data-act="save"]').addEventListener('click', function(){
        _submitForm(this, '/api/admin/license-req', {is_active:1}, function(){
          div.remove();
          var subtab = document.querySelector('.subtab.active[data-sub="manage"]');
          if (subtab) { subtab.click(); subtab.click(); }
        });
      });
    });
  }
})();

// ============================================================
// v25.23: 完整 CRUD: ✎ 编辑 + 🗑 删除 + + 房型
// ============================================================
(function(){
  function esc3(s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){ return ({'<':'&lt;','>':'&gt;','&amp;':'&amp;','"':'&quot;',"'":'&#39;'})[c]; }); }
  async function _apiCall(method, url, body) {
    var opts = { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    var r = await fetch(url, opts);
    var d = await r.json().catch(function(){ return {}; });
    if (!r.ok || d.error) throw new Error(d.error || '操作失败');
    return d;
  }
  function _refetchData() {
    // 重新拉一次 manage-data 并 eval
    var s = document.createElement('script');
    s.src = '/api/admin/manage-data?keys=hotels,rooms,tracks,licenseReq&_=' + Date.now();
    document.head.appendChild(s);
  }
  function _rebuildList(pane, listId) {
    // 简单办法: 触发 active sub-tab 的 click 两次
    var sub = document.querySelector('.subtab.active[data-sub="manage"]');
    if (sub) { sub.click(); sub.click(); }
  }

  // 通用编辑表单 (hotel / track / licReq 都用这个)
  function _editForm(opts) {
    // opts: { title, fields: [{name,label,type,value}], apiUrl, listId, onSaved }
    var fields = opts.fields.map(function(f){
      return '<label style="display:block;margin:6px 0;font-size:13px;">' +
        '<span style="display:block;font-weight:700;margin-bottom:2px;">' + esc3(f.label) + (f.required ? ' *' : '') + '</span>' +
        (f.type === 'textarea' ? '<textarea data-f="' + f.name + '" rows="3" style="width:100%;padding:6px;border:2px solid var(--c-black);font-family:var(--font-cn);">' + esc3(f.value || '') + '</textarea>'
          : '<input data-f="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc3(f.value || '') + '"' + (f.required ? ' required' : '') + ' style="width:100%;padding:6px;border:2px solid var(--c-black);font-family:var(--font-cn);" />') +
        '</label>';
    }).join('');
    return '<div data-form-wrap="' + esc3(opts.formKey) + '" style="background:#fffbe5;border:3px solid var(--c-black);padding:12px;margin:8px 0;box-shadow:4px 4px 0 var(--c-stone-dark);">' +
      '<div style="font-weight:700;color:var(--c-grass-dark);margin-bottom:8px;">' + esc3(opts.title) + '</div>' +
      fields +
      '<div style="margin-top:8px;display:flex;gap:6px;">' +
        '<button data-act="save" class="btn btn-primary btn-sm">💾 保存</button>' +
        '<button data-act="cancel" class="btn btn-ghost btn-sm">取消</button>' +
      '</div></div>';
  }

  function _formValues(form) {
    var out = {};
    form.querySelectorAll('[data-f]').forEach(function(inp){ out[inp.dataset.f] = inp.value; });
    return out;
  }

  // --- ✎ 编辑 / 🗑 删除 按钮 (delegation 到 list container) ---
  function _attachCrudHandlers(opts) {
    // opts: { listId, type (hotel/track/licenseReq/room) }
    var list = document.getElementById(opts.listId);
    if (!list) return;
    // 先移除旧 listener (避免重复)
    var key = '_crud_' + opts.listId;
    if (list[key]) list.removeEventListener('click', list[key]);
    list[key] = async function(e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var act = btn.dataset.act;
      var id = +btn.dataset.id;
      var wrap = list.querySelector('[data-form-wrap]');
      if (wrap) wrap.remove();

      if (act === 'edit-hotel') {
        var hotels = (window.__manageData && window.__manageData.hotels) || [];
        var item = hotels.find(function(h){ return h.id === id; });
        if (!item) return;
        var div = document.createElement('div');
        div.innerHTML = _editForm({
          title: '✎ 编辑酒店', formKey: 'edit-hotel-' + id,
          fields: [
            {name: 'name', label: '酒店名', required: true, value: item.name},
            {name: 'address', label: '地址', value: item.address || ''},
            {name: 'description', label: '介绍', type: 'textarea', value: item.description || ''},
            {name: 'image_url', label: '图片 URL', value: item.image_url || ''},
            {name: 'sort_order', label: '排序', type: 'number', value: item.sort_order || 0},
            {name: 'is_active', label: '上架 (1=是, 0=否)', type: 'number', value: item.is_active != null ? item.is_active : 1},
          ],
        });
        list.insertBefore(div.firstChild, list.firstChild);
        var form = list.firstChild;
        _attachFileUpload(form);  // v25.45: 立即挂文件上传, 不用等 Save click
        form.querySelector('[data-act="cancel"]').onclick = function(){ form.remove(); };
        form.querySelector('[data-act="save"]').onclick = async function() {
          var v = _formValues(form);
          v.is_active = parseInt(v.is_active, 10);
          v.sort_order = parseInt(v.sort_order, 10);
          try {
            await _apiCall('PATCH', '/api/admin/hotels?id=' + id, v);
            form.remove();
            _refetchData();
            setTimeout(function(){ _rebuildList('bookings', 'hotelManageList'); }, 300);
          } catch (e) { alert('保存失败: ' + e.message); }
        };
      }
      else if (act === 'del-hotel') {
        if (!confirm('删除酒店 (会级联删所有房型)?')) return;
        try {
          await _apiCall('DELETE', '/api/admin/hotels?id=' + id);
          _refetchData();
          setTimeout(function(){ _rebuildList('bookings', 'hotelManageList'); }, 300);
        } catch (e) { alert('删除失败: ' + e.message); }
      }
      else if (act === 'add-room') {
        var div2 = document.createElement('div');
        div2.innerHTML = _editForm({
          title: '🛏️ 新建房型 (酒店 #' + id + ')', formKey: 'add-room-' + id,
          fields: [
            {name: 'name', label: '房型名', required: true},
            {name: 'capacity', label: '人数', type: 'number', value: 2},
            {name: 'beds', label: '床型', value: '1.8m 大床'},
            {name: 'price_per_night', label: '每晚价格 (💎)', type: 'number', required: true, value: 100},
            {name: 'breakfast_included', label: '含早餐 (1=是, 0=否)', type: 'number', value: 1},
            {name: 'description', label: '描述', type: 'textarea'},
            {name: 'image_url', label: '图片 URL (或选文件)'},
            {name: 'sort_order', label: '排序', type: 'number', value: 99},
          ],
        });
        list.insertBefore(div2.firstChild, list.firstChild);
        var form2 = list.firstChild;
        _attachFileUpload(form2);  // v25.45: 立即挂文件上传
        form2.querySelector('[data-act="cancel"]').onclick = function(){ form2.remove(); };
        form2.querySelector('[data-act="save"]').onclick = async function() {
          var v = _formValues(form2);
          v.hotel_id = id;
          v.capacity = parseInt(v.capacity, 10) || 2;
          v.price_per_night = parseInt(v.price_per_night, 10) || 0;
          v.breakfast_included = parseInt(v.breakfast_included, 10) || 0;
          v.sort_order = parseInt(v.sort_order, 10) || 0;
          try {
            await _apiCall('POST', '/api/admin/hotel-rooms', v);
            form2.remove();
            _refetchData();
            setTimeout(function(){ _rebuildList('bookings', 'hotelManageList'); }, 300);
          } catch (e) { alert('保存失败: ' + e.message); }
        };
      }
      else if (act === 'edit-room') {
        var rooms = (window.__manageData && window.__manageData.rooms) || [];
        var r = rooms.find(function(x){ return x.id === id; });
        if (!r) return;
        var div3 = document.createElement('div');
        div3.innerHTML = _editForm({
          title: '✎ 编辑房型 #' + id, formKey: 'edit-room-' + id,
          fields: [
            {name: 'name', label: '房型名', required: true, value: r.name},
            {name: 'capacity', label: '人数', type: 'number', value: r.capacity || 2},
            {name: 'beds', label: '床型', value: r.beds || ''},
            {name: 'price_per_night', label: '每晚价格 (💎)', type: 'number', required: true, value: r.price_per_night},
            {name: 'breakfast_included', label: '含早餐', type: 'number', value: r.breakfast_included != null ? r.breakfast_included : 1},
            {name: 'description', label: '描述', type: 'textarea', value: r.description || ''},
            {name: 'image_url', label: '图片 URL (或选文件)', value: r.image_url || ''},
            {name: 'sort_order', label: '排序', type: 'number', value: r.sort_order || 0},
            {name: 'is_active', label: '上架', type: 'number', value: r.is_active != null ? r.is_active : 1},
          ],
        });
        list.insertBefore(div3.firstChild, list.firstChild);
        var form3 = list.firstChild;
        _attachFileUpload(form3);  // v25.45: 立即挂文件上传
        form3.querySelector('[data-act="cancel"]').onclick = function(){ form3.remove(); };
        form3.querySelector('[data-act="save"]').onclick = async function() {
          var v = _formValues(form3);
          v.capacity = parseInt(v.capacity, 10);
          v.price_per_night = parseInt(v.price_per_night, 10);
          v.breakfast_included = parseInt(v.breakfast_included, 10);
          v.sort_order = parseInt(v.sort_order, 10);
          v.is_active = parseInt(v.is_active, 10);
          try {
            await _apiCall('PATCH', '/api/admin/hotel-rooms?id=' + id, v);
            form3.remove();
            _refetchData();
            setTimeout(function(){ _rebuildList('bookings', 'hotelManageList'); }, 300);
          } catch (e) { alert('保存失败: ' + e.message); }
        };
      }
      else if (act === 'del-room') {
        if (!confirm('删除房型?')) return;
        try {
          await _apiCall('DELETE', '/api/admin/hotel-rooms?id=' + id);
          _refetchData();
          setTimeout(function(){ _rebuildList('bookings', 'hotelManageList'); }, 300);
        } catch (e) { alert('删除失败: ' + e.message); }
      }
      else if (act === 'edit-track') {
        var tracks = (window.__manageData && window.__manageData.tracks) || [];
        var t = tracks.find(function(x){ return x.id === id; });
        if (!t) return;
        var div4 = document.createElement('div');
        div4.innerHTML = _editForm({
          title: '✎ 编辑赛车场', formKey: 'edit-track-' + id,
          fields: [
            {name: 'name', label: '赛车场名', required: true, value: t.name},
            {name: 'length_km', label: '长度 (km)', type: 'number', value: t.length_km || 0},
            {name: 'laps', label: '圈数', type: 'number', value: t.laps || 0},
            {name: 'difficulty', label: '难度', value: t.difficulty || ''},
            {name: 'description', label: '介绍', type: 'textarea', value: t.description || ''},
            {name: 'image_url', label: '图片 URL', value: t.image_url || ''},
            {name: 'trial_price', label: '试车价格 (💎/次)', type: 'number', value: t.trial_price || 0},
            {name: 'sort_order', label: '排序', type: 'number', value: t.sort_order || 0},
            {name: 'is_active', label: '上架', type: 'number', value: t.is_active != null ? t.is_active : 1},
          ],
        });
        list.insertBefore(div4.firstChild, list.firstChild);
        var form4 = list.firstChild;
        _attachFileUpload(form4);  // v25.45: 立即挂文件上传
        form4.querySelector('[data-act="cancel"]').onclick = function(){ form4.remove(); };
        form4.querySelector('[data-act="save"]').onclick = async function() {
          var v = _formValues(form4);
          v.length_km = parseFloat(v.length_km);
          v.laps = parseInt(v.laps, 10);
          v.trial_price = parseInt(v.trial_price, 10);
          v.sort_order = parseInt(v.sort_order, 10);
          v.is_active = parseInt(v.is_active, 10);
          try {
            await _apiCall('PATCH', '/api/admin/race-tracks?id=' + id, v);
            form4.remove();
            _refetchData();
            setTimeout(function(){ _rebuildList('kart', 'trackManageList'); }, 300);
          } catch (e) { alert('保存失败: ' + e.message); }
        };
      }
      else if (act === 'del-track') {
        if (!confirm('删除赛车场?')) return;
        try {
          await _apiCall('DELETE', '/api/admin/race-tracks?id=' + id);
          _refetchData();
          setTimeout(function(){ _rebuildList('kart', 'trackManageList'); }, 300);
        } catch (e) { alert('删除失败: ' + e.message); }
      }
      else if (act === 'edit-license') {
        var lics = (window.__manageData && window.__manageData.licenseReq) || [];
        var l = lics.find(function(x){ return x.id === id; });
        if (!l) return;
        var div5 = document.createElement('div');
        div5.innerHTML = _editForm({
          title: '✎ 编辑驾照要求', formKey: 'edit-lic-' + id,
          fields: [
            {name: 'exam_type', label: '类型 (B/A/S)', required: true, value: l.exam_type},
            {name: 'title', label: '标题', required: true, value: l.title},
            {name: 'description', label: '介绍', type: 'textarea', value: l.description || ''},
            {name: 'image_url', label: '图片 URL (或选文件)', value: l.image_url || ''},
            {name: 'requirements', label: '要求', type: 'textarea', value: l.requirements || ''},
            {name: 'min_age', label: '最小年龄', type: 'number', value: l.min_age || 16},
            {name: 'duration_minutes', label: '时长 (分钟)', type: 'number', value: l.duration_minutes || 30},
            {name: 'sort_order', label: '排序', type: 'number', value: l.sort_order || 0},
            {name: 'is_active', label: '上架', type: 'number', value: l.is_active != null ? l.is_active : 1},
          ],
        });
        list.insertBefore(div5.firstChild, list.firstChild);
        var form5 = list.firstChild;
        _attachFileUpload(form5);  // v25.45: 立即挂文件上传
        form5.querySelector('[data-act="cancel"]').onclick = function(){ form5.remove(); };
        form5.querySelector('[data-act="save"]').onclick = async function() {
          var v = _formValues(form5);
          v.min_age = parseInt(v.min_age, 10);
          v.duration_minutes = parseInt(v.duration_minutes, 10);
          v.sort_order = parseInt(v.sort_order, 10);
          v.is_active = parseInt(v.is_active, 10);
          try {
            await _apiCall('PATCH', '/api/admin/license-req?id=' + id, v);
            form5.remove();
            _refetchData();
            setTimeout(function(){ _rebuildList('license', 'licenseManageList'); }, 300);
          } catch (e) { alert('保存失败: ' + e.message); }
        };
      }
      else if (act === 'del-license') {
        if (!confirm('删除驾照要求?')) return;
        try {
          await _apiCall('DELETE', '/api/admin/license-req?id=' + id);
          _refetchData();
          setTimeout(function(){ _rebuildList('license', 'licenseManageList'); }, 300);
        } catch (e) { alert('删除失败: ' + e.message); }
      }
    };
    list.addEventListener('click', list[key]);
  }

  // 挂上 4 个 list 的 handler
  _attachCrudHandlers({ listId: 'hotelManageList', type: 'hotel' });
  _attachCrudHandlers({ listId: 'trackManageList', type: 'track' });
  _attachCrudHandlers({ listId: 'licenseManageList', type: 'licenseReq' });
})();

// ============================================================
// v25.23: render 函数加 ✎ / 🗑 / + 房型 按钮
// ============================================================
(function(){
  // 替换 renderHotelManage (v25.28 加 sync XHR 兜底)
  // v25.30: 直接 async fetch，不依赖 window.__manageData 全局变量
  async function renderHotelManage(){
    var list = document.getElementById('hotelManageList');
    var empty = document.getElementById('hotelManageEmpty');
    if (!list || !empty) return;
    var d;
    try {
      var r = await fetch('/api/admin/manage-data?keys=hotels,rooms');
      var txt = await r.text();
      // 从 JS 响应里提取 JSON
      var m = txt.match(/window\.__manageData\s*=\s*({.+})\s*;/);
      d = m ? JSON.parse(m[1]) : {};
    } catch(e) {
      console.error('renderHotelManage fetch failed', e);
      d = {};
    }
    var hotels = (d && d.hotels) || [];
    var rooms = (d && d.rooms) || [];
    if (hotels.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    var _me = (window._me || {}).role === 'super';
    list.innerHTML = hotels.map(function(h){
      var hrs = rooms.filter(function(r){ return r.hotel_id === h.id; });
      return '<article class="msg-item ann-item">' +
        '<div class="msg-head"><div class="msg-head-left"><b class="msg-name">🏨 ' + esc(h.name) + '</b>' +
        (h.is_active ? '' : ' <span class="msg-read-tag">已下架</span>') +
        ' <span class="gallery-num">' + hrs.length + ' 房型</span></div>' +
        '<div class="msg-time">' + esc(h.sort_order || 0) + '</div></div>' +
        (h.image_url ? '<div style="margin:8px 0;"><img src="' + esc(h.image_url) + '" loading="lazy" onerror="this.style.opacity=\'0.25\'" style="max-width:240px;max-height:120px;border:2px solid var(--c-stone);" alt="酒店图片" /></div>' : '') +
        (h.address ? '<div class="msg-content">📍 ' + esc(h.address) + '</div>' : '') +
        (h.description ? '<div class="msg-content" style="white-space:pre-wrap">' + esc(h.description) + '</div>' : '') +
        (hrs.length > 0 ? '<div style="margin:8px 0;padding:8px;background:var(--c-bg-2);border:1px solid var(--c-stone);">' +
          hrs.map(function(r){
            return '<div style="display:flex;gap:6px;align-items:center;font-family:var(--font-pixel);font-size:11px;padding:4px 0;">' +
              '<span style="flex:1;">🛏️ ' + esc(r.name) + ' · ' + r.capacity + '人 · ' + (r.breakfast_included ? '🍳' : '—') + '</span>' +
              '<span style="color:var(--c-grass-dark);font-weight:700;">💎 ' + r.price_per_night + '/晚</span>' +
              (_me ? '<button data-act="edit-room" data-id="' + r.id + '" class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 6px;">✎</button>' +
              '<button data-act="del-room" data-id="' + r.id + '" class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 6px;">🗑</button>' : '') +
              '</div>';
          }).join('') + '</div>' : '') +
        (_me ? '<div class="msg-actions book-actions">' +
          '<button data-act="edit-hotel" data-id="' + h.id + '" class="btn btn-primary btn-sm">✎ 编辑酒店</button>' +
          '<button data-act="add-room" data-id="' + h.id + '" class="btn btn-primary btn-sm">+ 房型</button>' +
          '<button data-act="del-hotel" data-id="' + h.id + '" class="btn btn-ghost btn-sm" style="background:#c33;color:white;">🗑 删除</button>' +
        '</div>' : '') +
        '</article>';
    }).join('');
  }
  // 替换 renderTrackManage (v25.28 加 sync XHR 兜底)
  // v25.30: 直接 async fetch，不依赖 window.__manageData 全局变量
  async function renderTrackManage(){
    var list = document.getElementById('trackManageList');
    var empty = document.getElementById('trackManageEmpty');
    if (!list || !empty) return;
    var d;
    try {
      var r = await fetch('/api/admin/manage-data?keys=hotels,rooms,tracks');
      var txt = await r.text();
      var m = txt.match(/window\.__manageData\s*=\s*({.+})\s*;/);
      d = m ? JSON.parse(m[1]) : {};
    } catch(e) {
      console.error('renderTrackManage fetch failed', e);
      d = {};
    }
    var tracks = (d && d.tracks) || [];
    if (tracks.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    var _me = (window._me || {}).role === 'super';
    list.innerHTML = tracks.map(function(t){
      return '<article class="msg-item ann-item">' +
        '<div class="msg-head"><div class="msg-head-left"><b class="msg-name">🏁 ' + esc(t.name) + '</b></div>' +
        '<div class="msg-time">' + (t.length_km || '?') + ' km / ' + (t.laps || '?') + ' 圈</div></div>' +
        (t.image_url ? '<div style="margin:8px 0;"><img src="' + esc(t.image_url) + '" loading="lazy" onerror="this.style.opacity=\'0.25\'" style="max-width:240px;max-height:120px;" alt="赛道图片" /></div>' : '') +
        (t.trial_price ? '<div class="msg-content" style="background:#fff8e0;">💎 试车价格: ' + esc(t.trial_price) + ' 💎/次</div>' : '') +
        (t.difficulty ? '<div class="msg-content">难度: ' + esc(t.difficulty) + '</div>' : '') +
        (t.description ? '<div class="msg-content" style="white-space:pre-wrap">' + esc(t.description) + '</div>' : '') +
        (_me ? '<div class="msg-actions book-actions">' +
          '<button data-act="edit-track" data-id="' + t.id + '" class="btn btn-primary btn-sm">✎ 编辑</button>' +
          '<button data-act="del-track" data-id="' + t.id + '" class="btn btn-ghost btn-sm" style="background:#c33;color:white;">🗑 删除</button>' +
        '</div>' : '') +
        '</article>';
    }).join('');
  }
  // 替换 renderLicenseManage (v25.28 加 sync XHR 兜底)
  // v25.30: 直接 async fetch，不依赖 window.__manageData 全局变量
  async function renderLicenseManage(){
    var list = document.getElementById('licenseManageList');
    var empty = document.getElementById('licenseManageEmpty');
    if (!list || !empty) return;
    var d;
    try {
      var r = await fetch('/api/admin/manage-data?keys=licenseReq');
      var txt = await r.text();
      var m = txt.match(/window\.__manageData\s*=\s*({.+})\s*;/);
      d = m ? JSON.parse(m[1]) : {};
    } catch(e) {
      console.error('renderLicenseManage fetch failed', e);
      d = {};
    }
    var reqs = (d && d.licenseReq) || [];
    if (reqs.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    var _me = (window._me || {}).role === 'super';
    list.innerHTML = reqs.map(function(l){
      return '<article class="msg-item ann-item">' +
        '<div class="msg-head"><div class="msg-head-left"><b class="msg-name">🎫 ' + esc(l.exam_type) + ' 级 · ' + esc(l.title) + '</b></div>' +
        '<div class="msg-time">' + (l.min_age || 16) + '+ · ' + (l.duration_minutes || 30) + ' 分钟</div></div>' +
        (l.description ? '<div class="msg-content" style="white-space:pre-wrap">' + esc(l.description) + '</div>' : '') +
        (l.requirements ? '<div class="msg-content" style="background:#fff8e0;">📋 ' + esc(l.requirements) + '</div>' : '') +
        (_me ? '<div class="msg-actions book-actions">' +
          '<button data-act="edit-license" data-id="' + l.id + '" class="btn btn-primary btn-sm">✎ 编辑</button>' +
          '<button data-act="del-license" data-id="' + l.id + '" class="btn btn-ghost btn-sm" style="background:#c33;color:white;">🗑 删除</button>' +
        '</div>' : '') +
        '</article>';
    }).join('');
  }
  // 重新 attach (因为 render 函数变了, CRUD handler 需要重新挂)
  // 触发 sub-tab click 重新渲染
  // 立即调用一次
  // (实际上 attachCrudHandlers 已经在文件末尾调用, 这里不需要重复)

  // 同步 data-super-only visibility (super 才看按钮)
  function _applySuperOnlyVisibility() {
    if (window._me && window._me.role === 'super') {
      document.querySelectorAll('[data-super-only]').forEach(function(el){
        // 子 tab 按钮 (subtab) 强制显示, 其它 (新增按钮) 也显示
        el.style.display = '';
      });
    } else {
      document.querySelectorAll('[data-super-only]').forEach(function(el){
        el.style.display = 'none';
      });
    }
  }
  // 立即跑一次
  _applySuperOnlyVisibility();
  // v25.25: boot() 后再跑一次 (因为 IIFE 早于 boot, window._me 还没设)
  // 监听 bootDone 事件 / 用 setTimeout / 监听 userName 变化
  var _superCheckInterval = setInterval(function() {
    if (window._me && window._me.role === 'super') {
      _applySuperOnlyVisibility();
      clearInterval(_superCheckInterval);
    }
  }, 100);
  setTimeout(function() { clearInterval(_superCheckInterval); }, 5000);

  // v25.30: 暴露 render 函数供外层 tab 切换调用
  window.renderHotelManage = renderHotelManage;
  window.renderTrackManage = renderTrackManage;
  window.renderLicenseManage = renderLicenseManage;
})();


// v25.32: delegated file upload（3MB 上限，兼容 input/textarea[data-f="image_url"]）
(function(){
  document.body.addEventListener('change', function(e){
    if (e.target.type !== 'file') return;
    if (e.target.files && e.target.files[0]) {
      var f = e.target.files[0];
      if (f.size > 3 * 1024 * 1024) { alert('文件太大 (上限 3MB)'); e.target.value = ''; return; }
      var r = new FileReader();
      e.target._fileReading = true;
      r.onload = function(ev){
        e.target._fileReading = false;
        var parent = e.target.parentNode;
        var urlInput = parent.querySelector('input[data-f="image_url"], textarea[data-f="image_url"]');
        if (urlInput) urlInput.value = ev.target.result;
      };
      r.readAsDataURL(f);
    }
  });
})();

})();
