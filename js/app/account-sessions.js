import {$,api,post,date,esc,action,empty} from './core.js';
export async function renderSessions(el){
 el.innerHTML='<h3>登录与会话</h3><p>成功登录记录从此功能启用后开始保存，不记录 IP 或精确位置。设备名称由浏览器信息推断，仅供参考。</p><button id="revoke-others">退出其他会话</button><div id="session-list"></div><h4>最近成功登录</h4><div id="login-history"></div>';
 const load=async()=>{const d=await api('/api/account-security');$('#session-list',el).innerHTML=d.sessions.map(s=>`<div class="row"><b>${esc(s.device_label)}${s.current?' · 当前会话':''}</b><p>建立于 ${date(s.created_at)} · 到期 ${date(s.expires_at)}</p></div>`).join('')||empty();$('#login-history',el).innerHTML=d.history.map(r=>`<div class="row">${esc(r.device_label)} · ${r.method==='passkey'?'通行密钥':'密码'} · ${date(r.created_at)}</div>`).join('')||empty('启用后尚无成功登录记录');};
 $('#revoke-others',el).onclick=e=>action(e.currentTarget,async()=>{if(!confirm('退出此玩家账号的其他会话？当前会话会保留。'))return;await post('/api/account-security',{action:'revoke-others'});await load();});await load();
}
