import {escapeHtml as esc} from './html.js';
export function tableCell(label,html,className=''){return `<td role="cell" class="${esc(className)}"><span class="cell-label" aria-hidden="true">${esc(label)}</span><div class="cell-value">${html}</div></td>`;}
export function tableFrame(headers,rows){return `<div class="table-wrap"><table class="responsive-table" role="table"><thead><tr role="row">${headers.map(label=>`<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;}
