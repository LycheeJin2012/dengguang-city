/**
 * Home page workspace — backward-compatible forwarder.
 *
 * v79 起，home.js 拆分到 js/app/pages/home/：
 *   - pages/home/index.js   render + section 内部函数
 *   - pages/home/signup.js  报名弹窗（kart / circuit / license）
 *   - pages/home/signin.js  每日签到弹窗
 *
 * v84：entry.js 与 pages/profile/ 已改为直连 pages/home/* 真实模块，本文件
 * 只作为对外兼容层保留，且每个符号直接来自其真实出处。
 */

export { render } from './pages/home/index.js';
export { signup } from './pages/home/signup.js';
export { signin } from './pages/home/signin.js';
