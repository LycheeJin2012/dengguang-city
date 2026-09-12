import {escapeHtml as esc} from './html.js';
export function pageHeading(title,eyebrow=''){return `<header class="page-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1></div></header>`;}
export function sectionHeading(title,eyebrow='LIGHT CITY'){return `<header class="section-head"><h2>${esc(title)}</h2><span class="eyebrow">${esc(eyebrow)}</span></header>`;}
export function mountWorkspace(navigation,label){
 const main=document.querySelector('main');if(document.querySelector('.app-workspace'))return;
 const frame=document.createElement('div');frame.className='app-workspace';
 const rail=document.createElement('aside');rail.className='site-rail';rail.innerHTML=`<nav id="navigation" aria-label="${esc(label)}">${navigation}</nav>`;
 main.before(frame);frame.append(rail,main);
}
export function tabsMarkup(items,active,{id='',label='',panelPrefix='',panelId=''}={}){return `<div class="tabs" ${id?`id="${esc(id)}"`:''} role="tablist" aria-label="${esc(label)}">${items.map(i=>`<button type="button" role="tab" ${id?`id="${esc(id)}-${esc(i.key)}"`:""} ${panelId||panelPrefix?`aria-controls="${esc(panelId||panelPrefix+i.key)}"`:""} data-tab-key="${esc(i.key)}" aria-selected="${i.key===active}" tabindex="${i.key===active?0:-1}">${esc(i.label)}</button>`).join('')}</div>`;}
export function bindTabs(root,onSelect){const buttons=[...root.querySelectorAll('[data-tab-key]')];function select(button){buttons.forEach(b=>{b.setAttribute('aria-selected',String(b===button));b.tabIndex=b===button?0:-1;});return onSelect(button.dataset.tabKey);}buttons.forEach((b,i)=>{b.onclick=()=>select(b);b.onkeydown=e=>{const next=e.key==='ArrowRight'?(i+1)%buttons.length:e.key==='ArrowLeft'?(i+buttons.length-1)%buttons.length:e.key==='Home'?0:e.key==='End'?buttons.length-1:null;if(next!==null){e.preventDefault();buttons[next].focus();select(buttons[next]);}};});}
