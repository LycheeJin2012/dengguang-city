// v50: 共享 helpers barrel
// 所有 functions/*.js 从这里 import 统一接口

// HTTP 响应 + CORS
export { json, ok, err, handleOptions } from './_shared/http.js';
// 字节/Base64/十六进制
export { bytesToHex, hexToBytes, bytesToB64url, b64urlToBytes } from './_shared/bytes.js';
// 密码 + token (PBKDF2-SHA256)
export { randomToken, hashPassword, verifyPassword } from './_shared/auth.js';
// Session (D1 sessions 表)
export {
  readToken, cookieFor, createSession, getSession, destroySession,
  mergeAccount, unmergeAccount,
} from './_shared/session.js';
// 字段验证 + 限流 + HTML 转义
export { rateLimit, isNonEmpty, isEmail, isUsername, stripHtml } from './_shared/validators.js';
// 工单 helper (双写)
export {
  createTicket, ticketFromMessage, ticketFromBooking,
  ticketFromLicense, ticketFromCircuit, ticketFromKart,
} from './_shared/tickets.js';
