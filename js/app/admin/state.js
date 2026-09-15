/**
 * Admin workspace shared state.
 *
 * admin.js 把所有 tab 都塞进一个文件（v51~v76），active/view/root 三个全局
 * 变量在所有 tab 函数之间共享。重构后这些状态仍然只能住在一处，否则多个
 * tab 并存时会互相覆盖。这里抽出来是为了让 index.js 之外的辅助文件能读写。
 *
 * 只持有变量；不持有方法。这样 import 端只看到数据，不会触发任何副作用。
 */

export const adminContext = {
  active: 'tickets',
  view: undefined,
  root: undefined,
  historyBound: false,
};

/**
 * 切换 active 时同步 hash + 触发刷新。
 * load() 是 index.js 里的 loadActive()，避免循环依赖。
 */
export function setActive(key, load) {
  adminContext.active = key;
  load();
}