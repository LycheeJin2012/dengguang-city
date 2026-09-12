export const slideIndex=(index,length)=>length?((index%length)+length)%length:0;
export function mountCarousel(el,items,{imageUrl,onOpen=()=>{}}={}){
 const slides=items.filter(i=>imageUrl(i.image_url));if(!slides.length){el.innerHTML='<p class="notice">暂无记录</p>';return;}
 let userPlay=false;let index=0,paused=slides.length===1||matchMedia('(prefers-reduced-motion: reduce)').matches,inView=false;const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 el.innerHTML='<section class="city-carousel" aria-label="城市风貌轮播"><button type="button" class="gallery-button carousel-image" aria-label="查看当前图片"><img alt=""></button><div class="carousel-caption"><strong></strong><span data-position></span></div><div class="actions"><button type="button" data-prev aria-label="上一张">←</button><button type="button" data-play></button><button type="button" data-next aria-label="下一张">→</button></div></section>';
 const root=el.firstElementChild,img=root.querySelector('img'),toggle=root.querySelector('[data-play]');
 function draw(){const item=slides[index];img.src=imageUrl(item.image_url);img.alt=item.title||'';root.querySelector('strong').textContent=item.title||'';root.querySelector('[data-position]').textContent=`${index+1} / ${slides.length}`;toggle.textContent=paused?'开始轮播':'暂停轮播';toggle.setAttribute('aria-pressed',String(!paused));}
 function move(delta,manual=false){if(manual){paused=true;userPlay=false;}index=slideIndex(index+delta,slides.length);draw();}
 root.querySelector('[data-prev]').onclick=()=>move(-1,true);root.querySelector('[data-next]').onclick=()=>move(1,true);toggle.onclick=()=>{paused=!paused;userPlay=!paused;draw();};root.querySelector('.carousel-image').onclick=()=>onOpen(slides[index]);
 const observer=new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting;});observer.observe(root);
 const stopForPreference=()=>{if(reduced.matches){paused=true;draw();}};reduced.addEventListener?.('change',stopForPreference);
 const timer=setInterval(()=>{if(!el.isConnected){clearInterval(timer);observer.disconnect();reduced.removeEventListener?.('change',stopForPreference);return;}if(!paused&&inView&&document.visibilityState==='visible'&&(userPlay||(!root.matches(':hover')&&!root.contains(document.activeElement)))&&!document.querySelector('dialog[open]'))move(1);},5000);
 draw();if(slides.length===1){root.querySelector('.actions').hidden=true;}
}
