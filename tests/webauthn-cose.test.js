// WebAuthn 注册路径上的 COSE_Key 解析：为什么不能用固定偏移 slice。
//
// ── 背景 ────────────────────────────────────────────────────────────────
// functions/_shared/webauthn.js 的 coseToJwk() 原本是：
//
//   x = b.slice(10, 42);   y = b.slice(45, 77)
//
// 也就是假定 COSE_Key 永远是 77 字节、字段顺序永远是 kty/alg/crv/x/y、
// 且 kty 一定是 EC2、alg 一定是 ES256、crv 一定是 P-256。注释里写着
// 「v17.10.3 简化: 不依赖 cborDecode, 直接 slice 固定偏移」。
//
// 这三个假定在真实世界都不成立：
//   1. **长度不固定** —— COSE_Key 可以带 kid(2) / key_ops(4) / x5c(-1 之外)
//      等可选字段，字节数随认证器而变。Windows Hello、1Password、Bitwarden
//      各自带的东西都不一样。
//   2. **顺序不固定** —— CBOR map 无序，y 排在 x 前面完全合法。
//   3. **类型不固定** —— kty/alg/crv 的值是能被读出来的，原实现却根本不读。
//
// 后果不是「读不出公钥」而是「读出**错误的**公钥」：偏移量落到别的字段上，
// 照样拼出一个格式合法的 JWK 存进库，于是这个通行密钥从此登不进去，
// 而且日志里什么都看不出来。
//
// ── 本文件怎么证明它有牙 ────────────────────────────────────────────────
// 文件里保留了一份 OLD 固定偏移实现（oldSlice）作为对照，直接断言
// 「旧实现在这些输入上给出错误的 x/y」。没有这一步，一份只测新实现
// 全绿的测试完全可能是空壳。
//
// 规范 77 字节那种布局，新旧实现输出**完全一致** —— 所以 shared-equiv 里
// 现有的往返用例不受影响，本轮不需要登记任何「有意差异」。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { database } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';
import { passkeyRegisterStart, passkeyRegisterFinish } from '../functions/_shared/webauthn.js';

const RP_ID = 'local.test';
const ORIGIN = { type: 'webauthn.create', origin: 'https://local.test' };
const AAGUID = new Uint8Array(16).fill(7);
const CRED_ID = new TextEncoder().encode('cose-parse-test-credential');

const utf8 = (s) => new TextEncoder().encode(s);
const bytesToB64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

// ── CBOR 编码（要比 shared-equiv 里那份多支持负数：COSE 标签 -1/-2/-3）──

function head(major, n) {
  const m = major << 5;
  if (n < 24) return [m | n];
  if (n < 0x100) return [m | 24, n];
  if (n < 0x10000) return [m | 25, (n >> 8) & 0xff, n & 0xff];
  return [m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
const int = (n) => (n >= 0 ? head(0, n) : head(1, -1 - n));
const bstr = (b) => [...head(2, b.length), ...b];

/**
 * 按**给定的标签顺序**拼一个 COSE_Key，这样才能造出「非规范但合法」的编码。
 * @param {Array<[number, number|Uint8Array|Array]>} pairs 标签与值，按此顺序写入
 */
function coseKey(pairs) {
  const parts = head(5, pairs.length);
  for (const [label, value] of pairs) {
    parts.push(...int(label));
    if (typeof value === 'number') parts.push(...int(value));
    else if (Array.isArray(value)) {
      parts.push(...head(4, value.length));
      for (const item of value) parts.push(...int(item));
    } else parts.push(...bstr(value));
  }
  return new Uint8Array(parts);
}

const coord = (fill) => new Uint8Array(32).fill(fill);

/** 规范 77 字节布局，现有测试夹具用的就是这一种 */
const canonical = (x, y) => coseKey([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]);
const KID = utf8('a-kid-that-shifts-every-offset');

/** 旧实现：固定偏移。留在这里当对照，不是生产代码。 */
function oldSlice(b) {
  if (!b || b.length < 77) throw new Error('COSE: 太短或空, len=' + (b ? b.length : 0));
  if (b[0] !== 0xa5) throw new Error('COSE: 首字节不是 map(0xa5)');
  const pad32 = (v) => {
    if (v.length === 32) return v;
    if (v.length < 32) {
      const out = new Uint8Array(32);
      out.set(v, 32 - v.length);
      return out;
    }
    return v;
  };
  return {
    x: bytesToB64u(pad32(b.slice(10, 42))),
    y: bytesToB64u(pad32(b.slice(45, 77))),
  };
}

// ── 走真实的注册接口 ─────────────────────────────────────────────────────

const DB = database();
const env = { DB };
const SUBJECT = { kind: 'player', id: 1, username: 'citizen' };

before(async () => {
  await ensureDatabase(DB);
  await DB.prepare(
    "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds) VALUES(1,'citizen','c@example.invalid','x','x','active',0)"
  ).run();
});

// 必须关掉 sqlite-bridge 的 python 子进程，否则 node 进程不退出、
// 整份测试文件会「跑完但永远不打印结果」（shared-equiv 也有同一条）。
after(() => {
  try {
    DB.close();
  } catch {
    // 幂等：关两次不炸
  }
});

async function buildAuthData(cose, credId = CRED_ID) {
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(RP_ID)));
  const head_ = new Uint8Array(37 + 16 + 2 + credId.length + cose.length);
  head_.set(rpIdHash, 0);
  head_[32] = 0x45; // UP | UV | AT
  new DataView(head_.buffer).setUint32(33, 1);
  head_.set(AAGUID, 37);
  head_[53] = (credId.length >> 8) & 0xff;
  head_[54] = credId.length & 0xff;
  head_.set(credId, 55);
  head_.set(cose, 55 + credId.length);
  return head_;
}

function cborEncodeAttestation(authData) {
  // { fmt:'none', attStmt:{}, authData:<bstr> } —— 3 项 map
  const parts = [...head(5, 3), 0x63, ...utf8('fmt'), 0x64, ...utf8('none')];
  parts.push(0x67, ...utf8('attStmt'), 0xa0);
  parts.push(0x68, ...utf8('authData'), ...bstr(authData));
  return new Uint8Array(parts);
}

/** 用给定的 COSE 字节走一遍注册，返回存进库的 JWK 或错误文案。 */
let credSeq = 0;
async function registerWith(cose) {
  // 每个用例换一个 credential id：passkeys.credential_id 上有唯一约束，
  // 复用同一个会让「本该被拒」的用例在更早一步就撞约束，测不到 COSE 解析。
  const credId = new TextEncoder().encode(`cose-parse-cred-${++credSeq}`);
  const start = await passkeyRegisterStart(env, SUBJECT, RP_ID);
  const authData = await buildAuthData(cose, credId);
  const clientDataJSON = utf8(
    // 注意：clientData.challenge 要的是 challengeB64（publicKey.challenge），
    // 不是 challenge_token —— 两者长得像但不是一回事。
    JSON.stringify({
      type: ORIGIN.type,
      challenge: start.publicKey.challenge,
      origin: ORIGIN.origin,
      crossOrigin: false,
    })
  );
  const credential = {
    id: bytesToB64u(credId),
    response: {
      clientDataJSON: bytesToB64u(clientDataJSON),
      attestationObject: bytesToB64u(cborEncodeAttestation(authData)),
      transports: ['internal'],
    },
  };
  try {
    await passkeyRegisterFinish(
      env,
      { challenge_token: start.challenge_token, credential, name: '测试密钥' },
      SUBJECT,
      RP_ID,
      ORIGIN
    );
    // credential_id 才是浏览器给的那串；id 是自增整数
    const row = await DB.prepare('SELECT public_key_jwk FROM passkeys WHERE credential_id=?')
      .bind(bytesToB64u(credId))
      .first();
    assert.ok(row, '注册返回成功但库里查不到 passkeys 行');
    return { ok: true, jwk: JSON.parse(row.public_key_jwk) };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

// ── 1. 规范布局：必须与旧实现逐字节一致 ──────────────────────────────────

test('规范 77 字节 COSE_Key：新实现与旧固定偏移输出一致', async () => {
  const x = coord(0x11);
  const y = coord(0x22);
  const r = await registerWith(canonical(x, y));
  assert.equal(r.ok, true, '规范布局必须能注册成功：' + r.error);
  assert.equal(r.jwk.x, bytesToB64u(x));
  assert.equal(r.jwk.y, bytesToB64u(y));
  assert.equal(r.jwk.kty, 'EC');
  assert.equal(r.jwk.crv, 'P-256');
  assert.equal(r.jwk.alg, 'ES256');

  // 这一条是「没有引入回归」的锚：旧实现在规范布局上本来就对
  const old = oldSlice(canonical(x, y));
  assert.equal(r.jwk.x, old.x);
  assert.equal(r.jwk.y, old.y);
});

// ── 2. 带可选字段 / 字段乱序：旧实现给错，新实现必须给对 ────────────────

test('带 kid / key_ops 等可选字段时，仍能取到正确的 x/y（旧实现在这里直接拒收）', async () => {
  const x = coord(0x33);
  const y = coord(0x44);
  // 标签 2 = kid（bstr），4 = key_ops（array）。两者都会把 x/y 往后推。
  const withExtras = coseKey([
    [1, 2], [2, KID], [3, -7], [4, [1, 2, 3]], [-1, 1], [-2, x], [-3, y],
  ]);
  assert.ok(withExtras.length > 77, '这个样本必须比 77 长，否则测不到偏移量问题');
  assert.equal(withExtras[0], 0xa7, '7 项 map 的首字节是 0xa7 —— 旧实现只认 0xa5');

  const r = await registerWith(withExtras);
  assert.equal(r.ok, true, '带可选字段的合法 COSE_Key 必须能注册：' + r.error);
  assert.equal(r.jwk.x, bytesToB64u(x), 'x 取错了');
  assert.equal(r.jwk.y, bytesToB64u(y), 'y 取错了');

  // 防假绿：旧实现在同一份字节上一定给不出正确的 x/y。
  // 两种坏法都算坏：
  //   · 直接抛错（首字节 0xa7 ≠ 0xa5）—— 意味着带可选字段的**合法**密钥登不进来
  //   · 静默取错 —— 见下一条（字段乱序），那更糟：格式合法、存得进库，
  //     但这个通行密钥从此永远登不进去
  let old = null;
  try {
    old = oldSlice(withExtras);
  } catch {
    old = null;
  }
  assert.equal(
    old === null || old.x !== r.jwk.x || old.y !== r.jwk.y,
    true,
    '旧实现在带可选字段时给出了正确的 x/y —— 这个样本测不到问题，换一个'
  );
});

test('字段顺序不是 kty/alg/crv/x/y 时，仍能取到正确的 x/y', async () => {
  const x = coord(0x55);
  const y = coord(0x66);
  const reordered = coseKey([[-3, y], [-2, x], [-1, 1], [3, -7], [1, 2]]);
  const r = await registerWith(reordered);
  assert.equal(r.ok, true, '乱序但合法的 COSE_Key 必须能注册：' + r.error);
  assert.equal(r.jwk.x, bytesToB64u(x));
  assert.equal(r.jwk.y, bytesToB64u(y));

  const old = oldSlice(reordered);
  assert.notEqual(old.x, r.jwk.x, '旧实现竟然取对了 x');
  assert.notEqual(old.y, r.jwk.y, '旧实现竟然取对了 y');
});

// ── 3. kty / alg / crv 必须被校验，而不是假定 ────────────────────────────

test('kty / alg / crv 不是 EC2 / ES256 / P-256 时必须拒绝', async () => {
  const x = coord(0x77);
  const y = coord(0x88);
  const cases = [
    ['kty=OKP(1)', coseKey([[1, 1], [3, -7], [-1, 1], [-2, x], [-3, y]])],
    ['alg=RS256(-257)', coseKey([[1, 2], [3, -257], [-1, 1], [-2, x], [-3, y]])],
    ['crv=P-384(2)', coseKey([[1, 2], [3, -7], [-1, 2], [-2, x], [-3, y]])],
  ];
  for (const [label, cose] of cases) {
    const r = await registerWith(cose);
    assert.equal(r.ok, false, `${label} 必须被拒绝，却注册成功了`);
    assert.match(r.error, /kty|alg|crv|EC2|ES256|P-256/i, `${label} 的错误文案要说清是哪个字段不对：${r.error}`);
  }
});

// ── 4. 坐标长度必须严格 32 字节，不能悄悄补齐或截断 ─────────────────────

test('x / y 不是 32 字节时必须拒绝（不能左补也不能截断）', async () => {
  const y = coord(0x99);
  const short = new Uint8Array(31).fill(0xaa);
  const long = new Uint8Array(33).fill(0xbb);
  for (const [label, x] of [['x 31 字节', short], ['x 33 字节', long]]) {
    const r = await registerWith(coseKey([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]));
    assert.equal(r.ok, false, `${label} 必须被拒绝，却注册成功了`);
    assert.match(r.error, /32|P-256|坐标|x|y/i, `${label} 的错误文案要说清：${r.error}`);
  }
});

// ── 5. 坏输入必须 fail closed ───────────────────────────────────────────

test('截断 / 非 map / 缺字段的 COSE_Key 必须报错而不是写库', async () => {
  const x = coord(0xcc);
  const y = coord(0xdd);
  const cases = [
    ['截断到 40 字节', canonical(x, y).slice(0, 40)],
    ['空数组', new Uint8Array(0)],
    ['不是 map 的首字节', new Uint8Array([0xa2, 0x01, 0x02])],
    ['缺 y 字段', coseKey([[1, 2], [3, -7], [-1, 1], [-2, x]])],
  ];
  for (const [label, cose] of cases) {
    const r = await registerWith(cose);
    assert.equal(r.ok, false, `${label} 必须被拒绝，却注册成功了`);
  }
});

// ── 6. 拒绝时不得留下 passkey 行 ─────────────────────────────────────────

test('被拒绝的 COSE_Key 不得在库里留下任何 passkey 行', async () => {
  const before = (await DB.prepare('SELECT COUNT(*) AS n FROM passkeys').first()).n;
  await registerWith(coseKey([[1, 1], [3, -7], [-1, 1], [-2, coord(1)], [-3, coord(2)]]));
  const after = (await DB.prepare('SELECT COUNT(*) AS n FROM passkeys').first()).n;
  assert.equal(after, before, '注册失败却写进了 passkeys');
});
