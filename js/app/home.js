/**
 * 首页工作区 —— 兼容转发层。
 *
 * v79 起 home.js 拆到 js/app/pages/home/ 下：
 *   pages/home/index.js   render 与各 section 的内部函数
 *   pages/home/signup.js  报名弹窗（kart / circuit / license）
 *   pages/home/signin.js  每日签到弹窗
 *
 * v84：entry.js 与 pages/profile/ 已改成直接 import 上面这些真实模块，
 * 本文件只为兼容旧路径而留着。
 *
 * ⚠️ 转发时一律**直接从真实出处**再导出，不要经由别的中转文件。
 *    同一个模块出现两条加载路径时，调试栈里会多出一段没有信息量的中转帧，
 *    排查问题时很难看出问题到底在哪一层。
 */

export { render } from './pages/home/index.js';
export { signup } from './pages/home/signup.js';
export { signin } from './pages/home/signin.js';
