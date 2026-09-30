/**
 * 工单预览：在一堆工单里挑出「最近的一单」，给工单墙首页那一张预览卡用。
 *
 * 原来整个文件就一行，排序规则全挤在比较函数里。这里只把规则拆开写，
 * 不改算法。两个不能动的点：
 *
 *   1. id 带 `m:` 前缀的是老数据 —— 后端把 messages 表里的旧工单并进工单列表时
 *      统一加了 `m:`（见 functions/_core/ticket-policy.js 的 ticketReference）。
 *      比较前必须把这个前缀去掉，否则 `Number('m:12')` 是 NaN，排序会整个失效。
 *   2. 先比 created_at、同秒再比 id。两个都拿不到（空数组、或字段全缺）时返回 null，
 *      调用方（features/ticket-center/index.js）拿 null 去画「暂无工单」的空态。
 */

/**
 * 挑出最新的一单。
 * @param {Array<{id: string|number, created_at?: string}>} items
 * @returns {object|null} 最新的一条；没有数据时返回 null
 */
export function newestTicket(items) {
  // 复制一份再排：直接 sort() 会改调用方传进来的数组，preview() 里那个
  // Promise.all 的结果数组后面还要用。
  return (
    [...items].sort(
      (a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
        // 同一秒递交的两单，用 id 大小定先后（id 越大越晚建）
        Number(String(b.id).replace('m:', '')) - Number(String(a.id).replace('m:', ''))
    )[0] || null
  );
}
