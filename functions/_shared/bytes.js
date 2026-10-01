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
 *
 * v88.8 修：视图分支原来写的是 `new Uint8Array(buf.buffer || buf)` ——
 * 也就是**丢掉 byteOffset 和 length**，把整个底层 ArrayBuffer 编进去。
 * 上面那段注释当时就写着「必须用 buf.buffer 再带上视图自身的偏移去切」，
 * 但代码没照做。它一直侥幸没炸，只是因为现有调用方传的全是
 * `Uint8Array.prototype.slice()` 的结果 —— slice 会复制出新 buffer，偏移量恒为 0。
 * 而 cborDecode 返回的 `new Uint8Array(data.buffer, offset, len)` 是**视图**，
 * 一旦有人直接传进来，编出来的就是整个底层 buffer：在通行密钥那条链路上，
 * 那等于把 32 字节的公钥坐标换成了一整块 attestationObject，格式还完全合法、
 * 从外表看不出来。宁可多拷一次字节，也不能让这个函数在某个调用方上悄悄返回错的东西。
 */
export function bytesToB64url(buf) {
  let bytes;
  if (buf instanceof ArrayBuffer) {
    bytes = new Uint8Array(buf);
  } else if (ArrayBuffer.isView(buf)) {
    // 视图：只取自己那一段。buffer + byteOffset + byteLength 三个都要。
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } else {
    bytes = new Uint8Array(buf);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// hexToBytes 只在模块内部用，导出是因为 auth.js 的 hashPassword 要动态 import 它
export { hexToBytes };
