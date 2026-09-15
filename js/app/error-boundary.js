/**
 * Lightweight global error boundary.
 *
 * v77 起的轻量错误边界：
 * - 捕获 unhandledrejection / error 事件，统一走 toast 提示
 * - 监听 offline / online 事件，给一次离线 toast 提示
 * - 给 fetch 注入全局包装，捕获网络层错误（可选）
 *
 * 设计原则：
 * - 零依赖
 * - 不替换现有 core.js 的 api() / region() 行为，只补充
 * - 启动入口放在 entry.js 顶部
 */

import { toast } from './core.js';

let _installed = false;
let _wasOffline = false;

export function installErrorBoundary() {
  if (_installed) return;
  _installed = true;

  // 未捕获的 Promise 拒绝。多数来自 api() 的失败，已经会 toast；这里
  // 再补一层兜底，避免被静默吞掉。
  window.addEventListener('unhandledrejection', (event) => {
    const err = event.reason;
    if (!err) return;
    const msg = err?.message || String(err);
    // 已经被 api()/region() 处理过的错误会走 toast，这里不再重复
    if (event.defaultPrevented) return;
    toast(msg, true);
  });

  // 同步代码抛错。dialog/form 里有 try/catch，所以这个主要是兜底。
  window.addEventListener('error', (event) => {
    if (event.defaultPrevented) return;
    const msg = event?.error?.message || event?.message || '页面发生错误';
    toast(msg, true);
  });

  // 离线 / 在线提示，方便用户在弱网下识别问题。
  window.addEventListener('offline', () => {
    _wasOffline = true;
    toast('网络已断开，等待恢复…', true);
  });
  window.addEventListener('online', () => {
    if (_wasOffline) {
      _wasOffline = false;
      toast('网络已恢复');
    }
  });
}

/**
 * 把异步函数包装成"失败时 toast + 返回 undefined"。
 * 用于 fire-and-forget 场景，比如点击刷新统计。
 *
 * 用法：`const run = safeAsync(async () => { await api(...); });`
 */
export function safeAsync(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      toast(e?.message || String(e), true);
      return undefined;
    }
  };
}