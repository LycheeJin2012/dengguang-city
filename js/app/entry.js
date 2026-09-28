import './press-motion.js';
import {installErrorBoundary} from './error-boundary.js';
import {shell,session,renderAccount,toast,region,state} from './core.js';
// v84：错误边界装在所有业务逻辑之前，未捕获异常统一走 toast，而不是白屏。
installErrorBoundary();
// v84：所有路由直连 pages/ 真实模块，不再经过 home.js / hotel.js / social.js /
// admin.js 等 v79 兼容转发层，避免同一模块存在两条加载路径。
const pages={affairs:()=>import('./pages/affairs/index.js'),map:()=>import('./pages/map/index.js'),messages:()=>import('./pages/messages/index.js'),knowledge:()=>import('./pages/knowledge/public.js'),'hotel-owner':()=>import('./pages/hotel-owner/index.js'),home:()=>import('./pages/home/index.js'),hotel:()=>import('./pages/hotel/index.js'),profile:()=>import('./pages/profile/index.js'),dm:()=>import('./pages/messages/index.js'),notifications:()=>import('./pages/messages/index.js'),admin:()=>import('./admin/index.js')};
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
