import './press-motion.js';
import {shell,session,renderAccount,toast,region,state} from './core.js';
const pages={affairs:()=>import('./pages/affairs/index.js'),map:()=>import('./pages/map/index.js'),messages:()=>import('./social.js'),knowledge:()=>import('./pages/knowledge/public.js'),'hotel-owner':()=>import('./pages/hotel-owner/index.js'),home:()=>import('./pages/home/index.js'),hotel:()=>import('./pages/hotel/index.js'),profile:()=>import('./pages/profile/index.js'),dm:()=>import('./pages/messages/index.js'),notifications:()=>import('./pages/messages/index.js'),admin:()=>import('./admin.js')};
shell();
const auth=session().then(renderAccount).catch(e=>toast(e.message,true));
state.authPending=auth;
const page=document.body.dataset.page;
if(!['home','hotel'].includes(page))await auth;
await region(document.querySelector('main'),()=>pages[page](),async(m,el)=>m.render(el,page));
const {mountAssistantWindow}=await import('../ui/assistant-window.js');mountAssistantWindow();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});

// Back/forward cache must not restore stale elevated account UI.
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
