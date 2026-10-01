/**
 * 共享工具的对外出口（barrel）。
 *
 * 早期 _shared.js 是一个 791 行的单文件，现在按职责拆到 _shared/ 下：
 *   http.js        响应封装
 *   bytes.js       字节 / Base64 / 十六进制
 *   auth.js        密码哈希、随机 token
 *   session.js     会话读写、账号合并与拆分
 *   validators.js  字段校验、限流
 *   ai.js          AI 自动回复、灯灯这个 system 玩家
 *   webauthn.js    Passkey（WebAuthn）注册与校验
 *
 * 本文件只做 re-export，让调用方继续写 `import { x } from '../_shared.js'`，
 * 不用跟着拆分改路径。新增能力请加到对应的子文件里，不要堆到这里。
 */

// 响应
export { json, err, ok } from './_shared/http.js';
// 字节 / Base64 / 十六进制
export { bytesToHex, b64urlToBytes, bytesToB64url } from './_shared/bytes.js';
// 密码 + token
export { randomToken, hashPassword, verifyPassword } from './_shared/auth.js';
// 会话 + 合并账号
export { createSession, mergeAccount, unmergeAccount, getSession, destroySession, readToken } from './_shared/session.js';
// 字段验证 + 限流
export { rateLimit, isNonEmpty, isEmail, isUsername, stripHtml } from './_shared/validators.js';
// AI 自动回复 + 灯灯 system 玩家
export { aiAutoReply, getOrCreateAiBot } from './_shared/ai.js';
// Passkey（WebAuthn）完整实现
export {
  parseAuthData,
  verifyEs256,
  verifyClientData,
  expectedRpIdHash,
  passkeyRegisterStart,
  passkeyRegisterFinish,
  passkeyLoginStart,
  passkeyLoginFinish,
  listPasskeys,
  deletePasskey
} from './_shared/webauthn.js';
