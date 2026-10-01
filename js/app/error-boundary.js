/**
 * 全局错误边界（v77 起）。
 *
 * 页面里任何一个没被接住的异常，最后都不该变成「点了没反应」或者白屏。
 * 这里在 window 上挂四个监听，把它们统统收成一条 toast。
 *
 * ## 边界在哪
 *
 * 故意**不**替换 core.js 里 api() / region() 的行为，只做补充：
 *   · api() 自己失败时已经 toast 过了
 *   · dialog / form 内部有各自的 try/catch
 *   · 这里只接最后那批漏网的
 *
 * 去重的办法是看 `event.defaultPrevented`：被下层处理过的错误，
 * 事件会被标记为已处理，这里就不再重复提示一次。
 *
 * ## 设计约束
 *
 * · 零依赖
 * · `installErrorBoundary()` 幂等：重复调用只装一次，不会叠加监听器
 * · 只提示、不吞掉 —— 不 preventDefault，不阻止控制台里的原始报错
 *
 * 启动入口在 entry.js 顶部。
 */

import { toast } from './core.js';

let installed = false;

/** 断过网没有 —— 用来决定「已恢复」要不要提示。 */
let wasOffline = false;

/** 已经被下层（api / region / form）处理过，就不要再说一遍。 */
const alreadyHandled = (event) => event.defaultPrevented;

/** 从任意 thrown 值里取一句能给人看的文案。 */
function describe(err) {
  return err?.message || String(err);
}

/**
 * 装上错误边界。重复调用无效。
 */
export function installErrorBoundary() {
  if (installed) return;
  installed = true;

  // 未捕获的 Promise 拒绝。多数来自 api()，那边已经 toast 过了；
  // 这里补一层兜底，免得被静默吞掉。
  window.addEventListener('unhandledrejection', (event) => {
    if (!event.reason) return;
    if (alreadyHandled(event)) return;
    toast(describe(event.reason), true);
  });

  // 同步代码抛错。dialog / form 里都有 try/catch，所以这里基本是兜底。
  window.addEventListener('error', (event) => {
    if (alreadyHandled(event)) return;
    // error 事件的文案有三个可能的来源，依次兜底
    toast(event?.error?.message || event?.message || '页面发生错误', true);
  });

  // 离线 / 恢复。弱网下让用户知道「不是页面坏了，是网断了」。
  window.addEventListener('offline', () => {
    wasOffline = true;
    toast('网络已断开，等待恢复…', true);
  });

  window.addEventListener('online', () => {
    // 只在真的断过之后才提示恢复，免得刚进页面就弹一条
    if (!wasOffline) return;
    wasOffline = false;
    toast('网络已恢复');
  });
}

/**
 * 把异步函数包成「失败时 toast 一次并返回 undefined」。
 *
 * 给 fire-and-forget 的场景用 —— 比如点了刷新统计之后就不管了，
 * 不需要每个调用点都写 try/catch。
 *
 * 用法：`const run = safeAsync(async () => { await api(...); });`
 *
 * 只吞掉「提示用户」这一步，返回值语义保持不变：成功时照常返回结果。
 */
export function safeAsync(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      toast(describe(e), true);
      return undefined;
    }
  };
}
