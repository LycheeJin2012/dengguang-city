import {esc} from './core.js';
// Real text labels keep cards usable without CSS-generated content.
export function tableCell(label,html,className=''){return `<td role="cell" class="${esc(className)}"><span class="cell-label" aria-hidden="true">${esc(label)}</span><div class="cell-value">${html}</div></td>`;}
