/**
 * 管理后台入口的向后兼容转发层。
 *
 * v51~v76 把整个 admin 后台塞进 admin.js 一个文件（521 行）。v77 起把代码
 * 拆到 admin/ 目录：
 *   - admin/state.js    共享状态（active / view / root / historyBound）
 *   - admin/shared.js   共用工具（table / toolbar / refreshStats / 资源定义…）
 *   - admin/index.js    路由层（render / switchTab / loadActive）
 *   - admin/tabs/       各 tab 的实现
 *
 * 本文件**只做转发**，不含任何逻辑。存在的理由是让既有 import 路径继续可用：
 *   - entry.js 的 `import('./admin.js')`
 *   - 外部（tests 等）的 `import { render } from './admin.js'`
 *
 * ⚠️ 别在这里加逻辑，也别和 admin/index.js 各自实现一份 render。
 *    真正的实现在 admin/index.js。
 */

export { render } from './admin/index.js';
