/**
 * Affairs page workspace — backward-compatible forwarder.
 *
 * v79-5 起，affairs.js 拆分到 js/app/pages/affairs/。
 * 本文件保留为转发层，让 entry.js 的 `import('./affairs.js')` 路径不变。
 */

export { render } from './pages/affairs/index.js';