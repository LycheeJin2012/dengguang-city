/**
 * Shared record-card component.
 *
 * v81 起新增：
 *   - opts.density  'compact' / 'spacious'（v80 `.card.compact` / `.card.spacious`）
 *
 * 旧签名保持向后兼容。
 */

import { escapeHtml as esc } from './html.js';

// Body / metadata / actions are trusted templates from page adapters; titles are data.
export function recordCard({ title, body = '', meta = '', actions = '', media = '', className = 'card', density }) {
  const densityClass =
    density === 'compact' ? ' compact' : density === 'spacious' ? ' spacious' : '';
  return `<article class="${esc(className)}${densityClass}">${media}<header class="card-heading">${meta}<h3>${esc(
    title
  )}</h3></header><div class="card-content">${body}</div>${
    actions ? `<div class="actions">${actions}</div>` : ''
  }</article>`;
}