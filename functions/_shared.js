// v45 重写: _shared.js 变成 barrel re-export
// 原 791 行单文件 → 7 个职责清晰子文件 (functions/_shared/*)
// 保持 `import { x } from '../_shared.js'` 的兼容, 调用方不需要改

// http 响应
export { json, err, ok } from './_shared/http.js';
// 字节/Base64/十六进制
export { bytesToHex, b64urlToBytes, bytesToB64url } from './_shared/bytes.js';
// 密码 + token
export { randomToken, hashPassword, verifyPassword } from './_shared/auth.js';
// Session + 合并账号
export {
  createSession, mergeAccount, unmergeAccount,
  getSession, destroySession, readToken
} from './_shared/session.js';
// 字段验证 + 限流
export { rateLimit, isNonEmpty, isEmail, isUsername, stripHtml } from './_shared/validators.js';
// AI 自动回复 + 灯灯 system 玩家
export { aiAutoReply, getOrCreateAiBot } from './_shared/ai.js';
// WebAuthn (Passkey) 完整实现
export {
  parseAuthData, verifyEs256, verifyClientData, expectedRpIdHash,
  passkeyRegisterStart, passkeyRegisterFinish,
  passkeyLoginStart, passkeyLoginFinish,
  listPasskeys, deletePasskey
} from './_shared/webauthn.js';
