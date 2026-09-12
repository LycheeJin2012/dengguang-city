import './press-motion.js';
import {shell,session,renderAccount,toast,region,state} from './core.js';
const pages={affairs:()=>import('./affairs.js'),map:()=>import('./city-map.js'),messages:()=>import('./social.js'),knowledge:()=>import('./knowledge-public.js'),'hotel-owner':()=>import('./hotel-owner.js'),home:()=>import('./home.js'),hotel:()=>import('./hotel.js'),profile:()=>import('./profile.js'),dm:()=>import('./social.js'),notifications:()=>import('./social.js'),admin:()=>import('./admin.js')};
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
