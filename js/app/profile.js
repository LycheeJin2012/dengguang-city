/**
 * Profile page workspace — backward-compatible forwarder.
 *
 * v79-4 起，profile.js 拆分到 js/app/pages/profile/：
 *   - pages/profile/index.js     render + 6 个 tab 路由
 *   - pages/profile/security.js  账号与登录（密码 / 通行密钥）
 *   - 其余 5 个 tab 仍在 index.js 里，下个迭代再拆
 *
 * 本文件保留为转发层，让 entry.js 的 `import('./profile.js')` 路径不变，
 * 外部 `import { render } from './profile.js'` 也能继续工作。
 */

export { render } from './pages/profile/index.js';