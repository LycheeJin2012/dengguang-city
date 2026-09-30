/**
 * 管理后台的跨 tab 共享状态。
 *
 * v51~v76 把所有 tab 都塞进一个文件，active / view / root 三个变量在所有
 * tab 函数之间共享。重构后这些状态仍然只能住一处，否则多个 tab 并存时
 * 会互相覆盖。抽出来是为了让 index.js 之外的辅助文件（tabs/、shared.js）
 * 也能读写。
 *
 * 四个字段各自的含义：
 *   active         当前 tab key。tab 之间靠它区分视图（dispatch 复用 tickets）
 *   view           当前内容容器（#admin-view）。每次 switchTab 都会被换掉
 *   root           整个后台根容器。统计面板和侧栏在它上面
 *   historyBound   hashchange 是否已绑定。整个生命周期只绑一次
 *
 * ⚠️ 只持有变量，不持有方法。这样 import 端只看到数据，
 *    不会因为 import 就触发任何副作用。
 */

export const adminContext = {
  active: 'tickets',
  view: undefined,
  root: undefined,
  historyBound: false,
};

/**
 * 切换 active 时同步 hash + 触发刷新。
 *
 * load() 是 index.js 里的 loadActive()，作为参数传进来而不是直接 import ——
 * 那样会形成 state.js ↔ index.js 的循环依赖。
 *
 * ⚠️ 全仓库目前没有调用方：index.js 的 switchTab() 是直接改 adminContext.active
 *    再调 loadActive()，没走这个包装。保留是因为它是 export 的一部分，
 *    删掉属于改接口。想合并这两条路径时记得先确认没有外部 import。
 */
export function setActive(key, load) {
  adminContext.active = key;
  load();
}