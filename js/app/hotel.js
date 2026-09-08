import {
  $, $$, api, post, region, tr, esc, empty, field, modal, title, requirePlayer, imageUrl, toast
}
from './core.js';
const localDay=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
export async function book(room,hotel){
  const player=await requirePlayer();
  if(!room.is_active||!hotel.is_active)throw new Error(tr('此房型暂未开放预订','Room not available'));
  const tomorrow=new Date();
  tomorrow.setDate(tomorrow.getDate()+1);
  const after=new Date(tomorrow);
  after.setDate(after.getDate()+1);
  const d=modal(tr('预订 · ','Book · ')+room.name,`<div class="wide notice">${esc(hotel.name)} / ${esc(room.name)} · 💎 ${Number(room.price_per_night)} ${tr('/晚','/night')}</div>`+field('in_date',tr('入住日期','Check-in'),'date',localDay(tomorrow))+field('out_date',tr('退房日期','Check-out'),'date',localDay(after))+field('name',tr('入住人','Guest'),'text',player.username)+field('contact',tr('联系方式','Contact'),'text',player.email)+field('persons',tr('入住人数','Guests'),'number',1,{
    min:1,max:Math.min(6,room.capacity)
  }
  )+field('breakfast',tr(room.breakfast_included?'房费已含早餐':'加早餐（10 💎/晚/人）',room.breakfast_included?'Breakfast included':'Breakfast (10 💎 per guest/night)'),'checkbox',room.breakfast_included)+field('note',tr('备注','Notes'),'textarea','',{
    required:false
  }
  )+'<p id="booking-total" class="wide price"></p>',{
    label:tr('提交预订','Submit booking'),submit:async v=>{
      await post('/api/bookings',{
        ...v,room_id:room.id
      }
      );toast(tr('预订已提交，等待市政厅确认','Booking submitted for confirmation'));
    }
  }
  );
  const total=()=>{
    const form=$('form',d);
    const v=Object.fromEntries(new FormData(form));
    const nights=(new Date(v.out_date)-new Date(v.in_date))/86400000;
    $('#booking-total',d).textContent=nights>0?`💎 ${nights*(Number(room.price_per_night)+(v.breakfast&&!room.breakfast_included?10*Number(v.persons):0))} · ${nights} ${tr('晚','night(s)')}`:tr('退房日期必须晚于入住日期','Checkout must follow check-in');
  }
  ;
  $('form',d).addEventListener('input',total);
  total();
  if(room.breakfast_included)$('[name=breakfast]',d).disabled=true;
}
export function roomCards(el,bundle,{
  limit
}
={
}
){
  const hotels=new Map(bundle.hotels.map(h=>[h.id,h]));
  const rooms=bundle.rooms.filter(r=>hotels.has(r.hotel_id)).slice(0,limit);
  el.innerHTML=rooms.length?`<div class="cards">${rooms.map(r=>{
    const h=hotels.get(r.hotel_id),open=r.is_active&&h.is_active;return `<article class="card">${imageUrl(r.image_url||h.image_url)?`<img loading="lazy" src="${esc(imageUrl(r.image_url||h.image_url))}" alt="${esc(r.name)}">`:''}<p class="eyebrow">${esc(h.name)}</p><h3>${esc(r.name)}</h3><p>${esc(r.beds||'')} · ${Number(r.capacity)} ${tr('人','guests')}</p><p class="muted">${esc(r.description||tr('房型介绍待公布','Details coming soon'))}</p><p class="price">💎 ${Number(r.price_per_night)} / ${tr('晚','night')}</p><div class="actions"><button data-detail="${r.id}">${tr('详情','Details')}</button><button data-book="${r.id}" class="primary" ${open?'':'disabled'}>${tr(open?'预订':'筹建中',open?'Book':'Coming soon')}</button></div></article>`;
  }
  ).join('')}</div>`:empty();
  $$('[data-book]',el).forEach(b=>b.onclick=()=>book(rooms.find(r=>r.id===+b.dataset.book),hotels.get(rooms.find(r=>r.id===+b.dataset.book).hotel_id)).catch(e=>toast(e.message,true)));
  $$('[data-detail]',el).forEach(b=>b.onclick=()=>{
    const r=rooms.find(r=>r.id===+b.dataset.detail),h=hotels.get(r.hotel_id);modal(r.name,`<div class="wide"><p>${esc(h.name)} · ${esc(h.address)}</p><p>${esc(r.description)}</p><p>${esc(r.beds)} · ${r.capacity} ${tr('人','guests')}</p><p>${tr(r.breakfast_included?'含早餐':'不含早餐',r.breakfast_included?'Breakfast included':'Breakfast not included')}</p><p class="price">💎 ${r.price_per_night} / ${tr('晚','night')}</p></div>`);
  }
  );
}
export async function render(el){
  el.innerHTML=title('树上酒店','Treehouse Hotel')+`<div class="toolbar">${field('availability',tr('状态','Status'),'select','all',{
    options:[['all',tr('全部','All')],['open',tr('可预订','Available')],['draft',tr('筹建中','Coming soon')]]
  }
  )}${field('guests',tr('至少容纳','Minimum capacity'),'number',1,{
    min:1,max:6
  }
  )}${field('sort',tr('排序','Sort'),'select','default',{
    options:[['default',tr('默认','Default')],['asc',tr('价格从低到高','Price: low to high')],['desc',tr('价格从高到低','Price: high to low')]]
  }
  )}</div><div id="rooms"></div>`;
  await region($('#rooms',el),()=>api('/api/homepage-bundle'),(d,box)=>{
    const draw=()=>{
      const v=$('[name=availability]',el).value,cap=Number($('[name=guests]',el).value)||1,s=$('[name=sort]',el).value;const hs=new Map(d.bundle.hotels.map(h=>[h.id,h]));let rooms=d.bundle.rooms.filter(r=>r.capacity>=cap&&(v==='all'||(v==='open')===!!(r.is_active&&hs.get(r.hotel_id)?.is_active)));if(s!=='default')rooms.sort((a,b)=>(a.price_per_night-b.price_per_night)*(s==='asc'?1:-1));roomCards(box,{
        ...d.bundle,rooms
      }
      );
    }
    ;$$('.toolbar input,.toolbar select',el).forEach(x=>x.onchange=draw);draw();
  }
  );
}
