/**
 * Shared table primitive.
 *
 * v82 起新增 tableFrame() 第三参 opts：
 *   - opts.density: 'compact' | 'spacious' （CSS `.responsive-table.compact` 等）
 *
 * 旧调用 `tableFrame(headers, rows)` 仍然可用。.
 */

import { escapeHtml as esc } from './html.js';

export function tableCell(label, html, className = '') {
  return `<td role="cell" class="${esc(className)}"><span class="cell-label" aria-hidden="true">${esc(label)}</span><div class="cell-value">${html}</div></td>`;
}

export function tableFrame(headers, rows, { density } = {}) {
  const densityClass =
    density === 'compact' ? ' compact' : density === 'spacious' ? ' spacious' : '';
  return `<div class="table-wrap"><table class="responsive-table${densityClass}" role="table"><thead><tr role="row">${headers
    .map((label) => `<th scope="col">${esc(label)}</th>`)
    .join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}