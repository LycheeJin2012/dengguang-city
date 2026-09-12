import {escapeHtml as esc} from './html.js';
// Body/metadata/actions are trusted templates from page adapters; titles are data.
export function recordCard({title,body='',meta='',actions='',media='',className='card'}){return `<article class="${esc(className)}">${media}<header class="card-heading">${meta}<h3>${esc(title)}</h3></header><div class="card-content">${body}</div>${actions?`<div class="actions">${actions}</div>`:''}</article>`;}
