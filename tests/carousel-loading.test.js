import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountCarousel} from '../js/ui/carousel.js';

test('carousel keeps the displayed image and caption together across slow, cancelled and failed loads',()=>{
 const names=['Image','IntersectionObserver','matchMedia','setInterval'];
 const old=Object.fromEntries(names.map(k=>[k,globalThis[k]]));
 const requests=[],nodes=new Map();
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,setAttribute(){}});return nodes.get(selector);};
 const root={querySelector:node,style:{setProperty(k,v){this[k]=v;}},setAttribute(){}};
 const el={firstElementChild:root,isConnected:true};let opened;
 try{
  globalThis.Image=class{constructor(){requests.push(this);}naturalWidth=1000;naturalHeight=694;};
  globalThis.IntersectionObserver=class{observe(){}};
  globalThis.matchMedia=()=>({matches:false,addEventListener(){}});
  globalThis.setInterval=()=>0;
  mountCarousel(el,[{image_url:'a',title:'A'},{image_url:'b',title:'B'},{image_url:'c',title:'C'}],{imageUrl:x=>x,onOpen:x=>opened=x.title});
  requests[0].onload();assert.equal(node('img').src,'a');
  node('[data-next]').onclick();const slow=requests.at(-1);
  node('[data-prev]').onclick();slow.onload();assert.equal(node('img').src,'a');
  node('[data-next]').onclick();const superseded=requests.at(-1);
  node('[data-next]').onclick();requests.at(-1).onload();superseded.onload();
  assert.equal(node('img').src,'c');assert.equal(node('strong').textContent,'C');
  assert.equal(root.style['--image-ratio'],String(1000/694));
  node('[data-next]').onclick();requests.at(-1).onerror();
  assert.equal(node('img').src,'c');node('.carousel-image').onclick();assert.equal(opened,'C');
  assert.equal(node('.carousel-status').hidden,false);
 }finally{for(const k of names){if(old[k]===undefined)delete globalThis[k];else globalThis[k]=old[k];}}
});
