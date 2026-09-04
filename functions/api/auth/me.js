// v50: 公开 alias — /api/auth/me 返回当前玩家登录态
// 等价于 GET /api/login, 但用更 RESTful 路径
// 前端 auth-helpers.js 用 /api/auth/me
import { onRequestGet as loginGet } from '../login.js';

export const onRequestGet = loginGet;
