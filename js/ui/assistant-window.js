import {state,login,region} from '../app/core.js';
export function mountAssistantWindow(){
 if(document.querySelector('#assistant-launcher'))return;
 const launcher=document.createElement('button');launcher.id='assistant-launcher';launcher.type='button';launcher.textContent='🤖 灯灯';launcher.setAttribute('aria-expanded','false');launcher.setAttribute('aria-controls','assistant-window');
 const panel=document.createElement('section');panel.id='assistant-window';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','灯灯个人助手');
 panel.innerHTML='<header class="assistant-window-head"><strong>灯灯个人助手</strong><a href="/messages.html?to=%E7%81%AF%E7%81%AF%E5%AE%A2%E6%9C%8D" aria-label="打开完整会话">↗</a><button type="button" data-close-assistant aria-label="关闭灯灯浮窗">✕</button></header><div class="assistant-window-content"></div>';
 const shadow=panel.querySelector('.assistant-window-content').attachShadow({mode:'open'});shadow.innerHTML='<link rel="stylesheet" href="/css/style.css?v=76"><div class="assistant-embedded"></div>';
 let owner=null,loaded=false,loading=null;
 async function content(){await state.authPending;const id=state.session?.player?.id||null;if(loaded&&id===owner)return;if(loading)return loading;
 owner=id;const main=document.createElement('main');shadow.querySelector('.assistant-embedded').replaceChildren(main);
 if(!id){const p=document.createElement('p');p.textContent='登录后使用灯灯个人助手';const button=document.createElement('button');button.textContent='市民登录';button.onclick=async()=>{await login();await content();};main.append(p,button);loaded=false;return;}
 main.inert=true;loading=region(main,()=>import('../app/chat-page.js'),(m,el)=>m.renderChat(el,{assistantOnly:true,isVisible:()=>!panel.hidden&&state.session?.player?.id===owner}));try{await loading;loaded=!!main.querySelector('#send-form');}finally{main.inert=false;loading=null;}
 }
 function close(){panel.hidden=true;launcher.setAttribute('aria-expanded','false');launcher.focus();}
 launcher.onclick=async()=>{if(!panel.hidden){close();return;}panel.hidden=false;launcher.setAttribute('aria-expanded','true');const closeButton=panel.querySelector('[data-close-assistant]');closeButton.focus();await content();if(!panel.hidden&&document.activeElement===closeButton)(shadow.querySelector('#send-form textarea')||shadow.querySelector('main>button'))?.focus();};panel.querySelector('[data-close-assistant]').onclick=close;
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}});
 document.body.append(panel,launcher);
}
