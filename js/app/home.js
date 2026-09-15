/**
 * Home page workspace — backward-compatible forwarder.
 *
 * v79 起，home.js 拆分到 js/app/pages/home/：
 *   - pages/home/index.js   render + section 内部函数
 *   - pages/home/signup.js  报名弹窗（kart / circuit / license）
 *   - pages/home/signin.js  每日签到弹窗
 *
 * 本文件保留为转发层，让 entry.js 的 `import('./home.js')` 路径不变，
 * 外部代码继续 `import { render } from './home.js'` 也能工作。
 */

export { render, signup, signin } from './pages/home/index.js';