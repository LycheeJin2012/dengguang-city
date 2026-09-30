/**
 * 私信消息里的「依据」链接。
 *
 * knowledge_sources 存的是 JSON 字符串，形如
 *   [{"id":1,"kind":"hotel","title":"树屋酒店"}]
 * 这段以前内联在 chat/index.js 顶部，跟八件事挤在同一行里。
 * 单独拎出来是因为它有独立的失败模式：后端塞了脏数据进来时
 * JSON.parse 会抛，必须自己吞掉，不能连带炸掉整个线程渲染。
 */

import { esc } from '../../core.js';

/** kind → 可点的站内地址。未知 kind 一律不给链接，宁可少一个入口也不引错路。 */
const ROUTES = {
  hotel: (id) => '/hotel.html',
  personal: () => '/affairs.html',
  place: (id) => `/map.html#place-${id}`,
  knowledge: (id) => `/knowledge.html?id=${id}`,
};

export function sourceLinks(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    return '';
  }
  if (!Array.isArray(parsed)) return '';

  const items = parsed
    .filter((s) => s && Number.isSafeInteger(s.id) && ROUTES[s.kind])
    .map((s) => {
      const href = ROUTES[s.kind](s.id);
      return `<a href="${href}">依据：${esc(s.title)}</a>`;
    });

  return items.join('<br>');
}
