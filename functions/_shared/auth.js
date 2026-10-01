// v45 重写: 密码 PBKDF2 哈希 + 随机 token
// 从 _shared.js L29-65 拆出
import { bytesToHex } from './bytes.js';

const enc = new TextEncoder();

/**
 * 生成 n 字节的随机 token，返回 2n 位的 hex。
 *
 * 用 crypto.getRandomValues 而不是 Math.random：这是会话令牌、密码重置链接，
 * 必须不可预测。返回 hex 而不是 base64url 是因为要直接落进 TEXT 列。
 */
export function randomToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

// PBKDF2-SHA256 哈希密码（Web Crypto，零依赖）
//
// ⚠️ 下面 deriveBits 的三个参数是**安全原语，逐字不能动**：
//    iterations=100000、hash='SHA-256'、输出 256 位。
//    迭代数一降，存量 password_hash 的抗爆破强度就跟着降，而且降了之后
//    老哈希仍然能通过校验 —— 不会有任何报错，只会在某天被彩虹表一次打穿。
//    盐的长度（16 字节 = 32 hex）同理。改这三个数必须配针对性测试。
export async function hashPassword(password, saltHex = null) {
  // 动态 import 是为了不把 hexToBytes 拉进模块顶层的静态依赖图
  const { hexToBytes } = await import('./bytes.js');
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

/**
 * 校验密码。
 *
 * 注意它不直接比 hash，而是**重新按传入的 salt 算一遍**再比：
 * 这样库里存的 salt 就成了唯一凭据的一半，攻击者拿到 hash 也无法离线爆破
 * （不同的库/不同的用户用不同盐，同一个密码的 hash 完全不同）。
 */
export async function verifyPassword(password, storedHash, saltHex) {
  const { hash } = await hashPassword(password, saltHex);
  return timingSafeEqual(hash, storedHash);
}

/**
 * 定长字符串的恒定时间比较。
 *
 * 逐字符累积异或差值、最后一次性判断，而不是中途 return：
 * 提前返回的耗时差会被用来一位一位地猜出正确 hash。
 * 长度不同直接 false —— 长度本身不是秘密。
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
