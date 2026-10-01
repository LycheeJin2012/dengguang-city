// 守门：bytesToB64url 对 TypedArray 视图必须只编码自己那一段。
//
// ── 这个 bug 是怎么暴露的 ──────────────────────────────────────────────
// 修 webauthn.js 的 COSE 解析时（原来写死 slice(10,42) 固定偏移），
// 改用同文件里现成的 cborDecode —— 它返回的是
// `new Uint8Array(data.buffer, offset, len)`，也就是**视图**。
// 于是存进 passkeys 的公钥坐标 x 变成了 77 字节的整个 COSE_Key：
// 格式完全合法、能通过 JSON 序列化、存得进库，但 verifyEs256 用
// crypto.subtle.importKey('jwk') 导入时必然抛 Invalid EC key，
// 补救分支的 pad32b64 也救不回来 —— 也就是**这个通行密钥永远登不进去**。
//
// 根因在 bytesToB64url：
//
//   new Uint8Array(buf.buffer || buf)     ← 丢掉 byteOffset 和 length
//
// 它自己的注释就写着「必须用 buf.buffer 再带上视图自身的偏移去切」。
// 这条契约一直没人实现，只是**侥幸**没炸：现有调用方传的全是
// `Uint8Array.prototype.slice()` 的结果，而 slice 会复制出新 buffer，
// 偏移量恒为 0。parseAuthData 也是全用 slice，所以 rpIdHash / aaguid /
// credentialId 都没被牵连。
//
// 所以这份测试守的不只是「今天对不对」，而是「明天有人传个视图进来时
// 会不会静默产出错的东西」—— 这类 bug 从外表完全看不出来。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToB64url, bytesToHex, b64urlToBytes } from '../functions/_shared/bytes.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');

test('视图入参：只编码自己那一段，不是整个底层 buffer', () => {
  // 故意在前后各放哨兵字节，编错的话一眼能看出来多了东西
  const backing = new Uint8Array([0xaa, 0xbb, 1, 1, 1, 1, 1, 1, 1, 1, 0xcc, 0xdd]);
  const view = new Uint8Array(backing.buffer, 2, 8);

  assert.equal(view.byteOffset, 2, '前提：这个视图的偏移量确实不为 0');
  assert.equal(bytesToB64url(view), b64([1, 1, 1, 1, 1, 1, 1, 1]), '视图必须只编自己那 8 字节');

  const decoded = b64urlToBytes(bytesToB64url(view));
  assert.equal(decoded.length, 8, '解码回来必须是 8 字节');
  assert.deepEqual([...decoded], [1, 1, 1, 1, 1, 1, 1, 1]);
});

test('视图入参：非 Uint8Array 的 TypedArray 视图同样要按 offset/length 切', () => {
  // Uint16Array 视图：byteLength 是**字节**数，length 是元素数，两者不能混用。
  // 本机是小端，所以 0x0102 在内存里是 02 01 —— 期望值按内存字节序写，
  // 不按人读的数值顺序写，免得这条测试自己写错。
  //
  // 这里必须自己 new ArrayBuffer：V8 对小 ArrayBuffer 走内存池，
  // `new Uint16Array([...])` 背后的 buffer 可能比数据本身大，
  // 拿它 .buffer 再按偏移切会读到池里的邻居，测试就成了假随机。
  const ab = new ArrayBuffer(8);
  const words = new Uint16Array(ab);
  words[0] = 0xdead;
  words[1] = 0x0102;
  words[2] = 0xbeef;
  words[3] = 0x0304;

  const view = new Uint16Array(ab, 2, 2);
  assert.equal(view.byteLength, 4, '前提：这个视图覆盖 4 个字节');
  assert.equal(view.byteOffset, 2, '前提：偏移量不为 0');
  // byteOffset 是**字节**偏移 2，所以覆盖的是第 2~5 字节 = words[1] 和 words[2]
  // 的内存表示（小端：0x0102 → 02 01，0xbeef → ef be）。
  assert.equal(bytesToB64url(view), b64([0x02, 0x01, 0xef, 0xbe]), '只编自己那 2 个元素（4 字节）');
  assert.notEqual(bytesToB64url(view), bytesToB64url(new Uint8Array(ab)), '不得退化成整块 8 字节');
});

test('slice 结果、整块 Uint8Array、ArrayBuffer 三种入参结果一致', () => {
  const backing = new Uint8Array([0xaa, 0xbb, 9, 8, 7, 6, 5, 4, 3, 2, 0xcc, 0xdd]);
  const want = b64([9, 8, 7, 6, 5, 4, 3, 2]);

  assert.equal(bytesToB64url(backing.slice(2, 10)), want, 'slice（复制）本来就对');
  assert.equal(bytesToB64url(new Uint8Array(backing.buffer, 2, 8)), want, '视图现在也要对');
  assert.equal(bytesToB64url(new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2])), want, '独立数组');
});

test('空视图编出空串，不得回退到整个 buffer', () => {
  const backing = new Uint8Array([1, 2, 3, 4]);
  assert.equal(bytesToB64url(new Uint8Array(backing.buffer, 2, 0)), '');
  assert.equal(bytesToB64url(new Uint8Array(0)), '');
});

test('bytesToHex 不受同一类问题影响（它是 new Uint8Array(buf)，会复制元素）', () => {
  // 一起钉住，免得以后有人「顺手统一」两个 helper 的写法时把正确的那个改坏
  const backing = new Uint8Array([0xaa, 0xbb, 0x0f, 0x10]);
  assert.equal(bytesToHex(new Uint8Array(backing.buffer, 2, 2)), '0f10');
});

test('判据自检：这些断言在旧实现下必须是红的', () => {
  // 旧实现：new Uint8Array(buf.buffer || buf)
  const oldImpl = (buf) => {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const backing = new Uint8Array([0xaa, 0xbb, 1, 1, 1, 1, 1, 1, 1, 1, 0xcc, 0xdd]);
  const view = new Uint8Array(backing.buffer, 2, 8);

  // 旧实现会把这 12 字节整块编出来（含首尾的哨兵 0xaa/0xbb/0xcc/0xdd）
  assert.equal(oldImpl(view), b64([...backing]), '旧实现确实编了整块');
  assert.notEqual(oldImpl(view), b64([1, 1, 1, 1, 1, 1, 1, 1]), '旧实现与正确值不同 —— 上面的断言有牙');
  assert.notEqual(oldImpl(new Uint8Array(backing.buffer, 2, 0)), '', '旧实现把空视图编成了整块');
});
