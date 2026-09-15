/**
 * Admin workspace entry — backward-compatible forwarder.
 *
 * v51~v76 把 admin 后台整个塞进 admin.js 一个文件（521 行）。v77 起把代码
 * 拆到 admin/ 目录：
 *   - admin/state.js    共享状态（active / view / root / historyBound）
 *   - admin/shared.js   共用工具（table / toolbar / refreshStats / 资源定义…）
 *   - admin/index.js    路由层（render / switchTab / loadActive）+ tab 函数
 *   - admin/tabs/       v78 计划：把 tab 函数拆到独立文件
 *
 * 本文件保留为转发层，让 entry.js 的 `import('./admin.js')` 路径不变。
 * 外部（tests 等）继续 `import { render } from './admin.js'` 也能工作。
 */

export { render } from './admin/index.js';