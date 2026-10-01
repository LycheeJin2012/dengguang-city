/**
 * 个人中心工作区 —— 兼容转发层。
 *
 * v79-4 起 profile.js 拆到 js/app/pages/profile/ 下：
 *   pages/profile/index.js     render 与 6 个 tab 的路由
 *   pages/profile/security.js  账号与登录（改密码 / 通行密钥）
 *
 * 其余 5 个 tab 目前仍在 index.js 里，等下个迭代再拆。
 *
 * 本文件只为兼容旧路径而留着：entry.js 的 `import('./profile.js')` 和外部的
 * `import { render } from './profile.js'` 都还要能用。
 */

export { render } from './pages/profile/index.js';
