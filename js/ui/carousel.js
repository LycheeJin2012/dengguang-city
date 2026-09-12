export const slideIndex=(index,length)=>length?((index%length)+length)%length:0;
export function mountCarousel(el,items,{imageUrl,onOpen=()=>{}}={}){
 const slides=items.filter(i=>imageUrl(i.image_url));if(!slides.length){el.innerHTML='<p class="notice">暂无记录</p>';return;}
 let requestId=0,shownIndex=-1;let userPlay=false;let index=0,paused=slides.length===1||matchMedia('(prefers-reduced-motion: reduce)').matches,inView=false;const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 el.innerHTML='<section class="city-carousel" aria-label="城市风貌轮播"><button type="button" class="gallery-button carousel-image" aria-label="查看当前图片"><img alt=""></button><div class="carousel-caption"><strong></strong><span data-position></span></div><p class="carousel-status" role="status" hidden></p><div class="actions"><button type="button" data-prev aria-label="上一张">←</button><button type="button" data-play></button><button type="button" data-next aria-label="下一张">→</button></div></section>';
 const root=el.firstElementChild,img=root.querySelector('img'),toggle=root.querySelector('[data-play]');
 function draw(){
  toggle.textContent=paused?'开始轮播':'暂停轮播';toggle.setAttribute('aria-pressed',String(!paused));
  if(shownIndex===index){++requestId;root.setAttribute('aria-busy','false');root.querySelector('.carousel-status').hidden=true;return;}
  const target=index,id=++requestId,item=slides[target],next=new Image(),status=root.querySelector('.carousel-status');
  root.setAttribute('aria-busy','true');status.hidden=true;
  next.onload=()=>{
   if(id!==requestId||!el.isConnected)return;
   root.style.setProperty('--image-ratio',String(next.naturalWidth/next.naturalHeight));
   img.src=next.src;img.alt=item.title||'';img.width=next.naturalWidth;img.height=next.naturalHeight;
   shownIndex=target;root.querySelector('strong').textContent=item.title||'';
   root.querySelector('[data-position]').textContent=`${target+1} / ${slides.length}`;
   root.setAttribute('aria-busy','false');
  };
  next.onerror=()=>{
   if(id!==requestId||!el.isConnected)return;
   paused=true;userPlay=false;root.setAttribute('aria-busy','false');
   status.textContent='图片加载失败，请切换图片或稍后重试';status.hidden=false;
   toggle.textContent='开始轮播';toggle.setAttribute('aria-pressed','false');
  };
  next.src=imageUrl(item.image_url);
 }
 function move(delta,manual=false){if(manual){paused=true;userPlay=false;}index=slideIndex(index+delta,slides.length);draw();}
 root.querySelector('[data-prev]').onclick=()=>move(-1,true);root.querySelector('[data-next]').onclick=()=>move(1,true);toggle.onclick=()=>{paused=!paused;userPlay=!paused;draw();};root.querySelector('.carousel-image').onclick=()=>{if(shownIndex>=0)onOpen(slides[shownIndex]);};
 const observer=new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting;});observer.observe(root);
 const stopForPreference=()=>{if(reduced.matches){paused=true;draw();}};reduced.addEventListener?.('change',stopForPreference);
 const timer=setInterval(()=>{if(!el.isConnected){clearInterval(timer);observer.disconnect();reduced.removeEventListener?.('change',stopForPreference);return;}if(!paused&&inView&&document.visibilityState==='visible'&&(userPlay||(!root.matches(':hover')&&!root.contains(document.activeElement)))&&!document.querySelector('dialog[open]'))move(1);},5000);
 draw();if(slides.length===1){root.querySelector('.actions').hidden=true;}
}
