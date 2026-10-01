// v45 重写: 字节/Base64/十六进制 转换 helper
// 从 _shared.js L22, L315-330 拆出

/**
 * Uint8Array → 小写 hex 字符串。
 *
 * padStart(2,'0') 不能省：0x0f 必须写成 "0f" 而不是 "f"，否则 hex 变短、
 * 长度对不上，PBKDF2 的 hash 与 salt 会互相串位。
 */
export function bytesToHex(buf) {
  const arr = new Uint8Array(buf);
  let s = '';
  for (const b of arr) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * hex 字符串 → Uint8Array。
 *
 * 奇数长度或非 hex 字符的行为不在这里保证正确（parseInt 拿到 NaN 就写 NaN），
 * 只要求两版一致 —— 调用方给的都是自家 hexToBytes 产出的串。
 */
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * base64url → Uint8Array。
 *
 * 标准 base64 的 '+' '/' 换成 '-' '_'（URL 安全），末尾补 '=' 到 4 的倍数。
 * atob 对非 ASCII 会直接抛，所以调用方只应当传 base64url。
 */
export function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Uint8Array → base64url（无 padding）。
 *
 * buf 兼容两种入参：ArrayBuffer 本身，和带 byteOffset 的 TypedArray 视图。
 * 后者必须用 buf.buffer 再带上视图自身的偏移去切，否则拿的是整个底层
 * ArrayBuffer 的头几字节 —— 传切片进来时会读错数据。
 */
export function bytesToB64url(buf) {
  const bytes = buf instanceof ArrayBuffer
    ? new Uint8Array(buf)
    : new Uint8Array(buf.buffer || buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// hexToBytes 只在模块内部用，导出是因为 auth.js 的 hashPassword 要动态 import 它
export { hexToBytes };
