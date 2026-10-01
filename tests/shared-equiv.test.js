// _shared/ 8 个文件重写的等价性守门。
//
// 背景：v88.7 把 functions/_shared/ 的 8 个文件（ai/auth/bytes/http/session/
// tickets/validators/webauthn）从「手工压缩写法」重写成可读代码。这些文件是全后端
// 的地基：session 管登录态、webauthn 管通行密钥、validators 的 rateLimit 管留言限流、
// auth 的 PBKDF2 管密码哈希。任何一个字节的改动都不会编译报错，只会在线上表现成
// 「用户登不进去」「passkey 突然全废」「限流失效」这种极难定位的问题。
//
// 所以这里对每个文件做两件事：
//
//   1. export 名单必须一致（别的文件在 import，改了就断链）
//   2. **拿真 SQLite / 真 Web Crypto 跑两版**，比对真实落库结果与真实验签结果
//
// 为什么用真库真签名而不是打桩：
// 假 DB 只能记录「发了什么 SQL」，而这里的风险恰恰是「SQL 一样但语义不同」——
// 比如 mergeAccount 少了个「已绑给别人就不许覆盖」的判断、或者 challenge 被消费了
// 两次。真库会直接把「第二次登录竟然成功了」暴露出来。
// 假签名同理：verifyEs256 如果被改成恒返回 true，打桩的假签名照样「通过」。
// 这里用真 P-256 密钥真签名，并额外断言篡改后必须变 false ——
// 恒 true 和恒 false 都会被抓到。
//
// 基线是重构前的提交（下面 BASELINE），从 git 动态提取，不依赖任何磁盘副本，
// 所以任何干净的 checkout 都能复现。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { database } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';

const BASELINE = '06e9595';
const SHARED_DIR = 'functions/_shared';

const show = (path) =>
  execSync(`git show ${BASELINE}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 28 });
const read = (p) => readFileSync(p, 'utf8');

const normSql = (s) => String(s).replace(/\s+/g, ' ').trim();

/** 基线里有、现在还在、且确实被改动过的文件 */
const changedSharedFiles = () =>
  execSync(`git ls-tree -r --name-only ${BASELINE} -- ${SHARED_DIR}/`, { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && f.endsWith('.js') && existsSync(f) && show(f) !== read(f));

const exportNames = (src) =>
  [...src.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)]
    .map((m) => m[1])
    .concat(
      [...src.matchAll(/export\s*\{([^}]*)\}/g)]
        .flatMap((m) => m[1].split(',').map((p) => p.trim().split(/\s+as\s+/).pop().trim()))
        .filter(Boolean)
    )
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

/**
 * 本进程创建过的临时副本路径。
 *
 * 清理时**只认这个集合**，不去全仓库扫文件名匹配。
 * 坑：早先的 cleanupTmpFiles 用正则 /\.equiv-\d+-\d+-.*\.mjs$/ 扫全仓库，
 * 于是会把**其他并发进程**正在用的副本一起删掉 —— 那些 worker import 到一半
 * 文件没了，报 Cannot find module，看起来像代码坏了，其实是清理越界。
 */
const ownedTmpFiles = new Set();

let tmpSeq = 0;
async function loadBoth(path) {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.js$/, '');
  // 文件名必须与原模块不同：ESM 按绝对路径缓存，同名会让 B 和 N 拿到同一个模块对象，
  // 差分直接白做。
  const name = `.equiv-${process.pid}-${++tmpSeq}-${base}.mjs`;
  const rel = `${SHARED_DIR}/${name}`;
  // 两个路径基准不一样，别混：
  //   writeFileSync / unlinkSync —— 相对 **cwd**（仓库根），所以直接用 rel
  //   import()                 —— 相对**本文件**（tests/），所以要加 '../'
  // 副本必须写在原目录，它内部的 './bytes.js' 相对 import 才成立。
  writeFileSync(rel, show(path));
  ownedTmpFiles.add(rel);
  const oldM = await import('../' + rel);
  const newM = await import('../' + path);
  return {
    oldM,
    newM,
    cleanup: () => {
      try { unlinkSync(rel); } catch {}
      ownedTmpFiles.delete(rel);
    },
  };
}

/** 进程退出时只清理本进程登记过的副本 */
function cleanupTmpFiles() {
  for (const f of ownedTmpFiles) {
    try { unlinkSync(f); } catch {}
  }
  ownedTmpFiles.clear();
}

process.on('exit', cleanupTmpFiles);
process.on('uncaughtException', (e) => {
  cleanupTmpFiles();
  throw e;
});

/**
 * 记录每一条发出去的 SQL 的代理 DB。
 *
 * 「两版行为一致」不能只看返回值 —— 返回值一样但 SQL 序列不同（比如多查了一次、
 * 少了一个 WHERE），风险就已经变了。这里把 prepare 到的 SQL 逐条记下来比对。
 * 坑：Statement.first() 内部会调 all()，所以要包一层而不是直接透传，
 * 否则一条 first() 会被记成两次。
 */
function traceDb(DB, log) {
  const wrap = (st) => ({
    sql: st.sql,
    bind: (...p) => wrap(st.bind(...p)),
    all: () => { log.push(normSql(st.sql)); return st.all(); },
    run: () => { log.push(normSql(st.sql)); return st.run(); },
    first: (c) => { log.push(normSql(st.sql)); return st.first(c); },
  });
  return {
    prepare: (sql) => wrap(DB.prepare(sql)),
    batch: (items) => DB.batch(items),
  };
}

/**
 * 建一份全新的真库，塞进 _shared 测试需要的最小数据。
 *
 * 返回的 close() 幂等，且**每条用例都必须在 finally 里调用它** ——
 * 这是上一版脚本挂死 280 秒被 kill 的根因：
 * database() 会 fork 一个 python3 SQLite 子进程（tests/sqlite-bridge.py），
 * 子进程不退，node 进程就不退，于是 test runner 永远等不到结束。
 * 只挂 process.on('exit') 兜底是没用的：那个钩子要等进程即将退出才跑，
 * 而恰恰是这些活着的子进程阻止了退出 —— 死锁。
 * 所以改用逐条 finally 显式 closeDb(DB)，不用 process.exit
 * （process.exit 会吞掉 TAP reporter 的输出，让通过/失败都看不见）。
 */
async function seeded() {
  const DB = database();
  await ensureDatabase(DB);

  // 三名玩家：1/2 正常、3 已封禁（mergeAccount 与 passkey 登录都要查 status）
  await DB.prepare(
    "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds) VALUES(1,'citizen','c1@example.invalid','x','x','active',1000)"
  ).run();
  await DB.prepare(
    "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds) VALUES(2,'citizen2','c2@example.invalid','x','x','active',500)"
  ).run();
  await DB.prepare(
    "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds) VALUES(3,'banned','c3@example.invalid','x','x','banned',0)"
  ).run();
  await DB.prepare("INSERT INTO admins(id,username,role,password_hash,salt) VALUES(1,'super','super','x','x')").run();
  await DB.prepare("INSERT INTO admins(id,username,role,password_hash,salt) VALUES(2,'wzc','admin','x','x')").run();

  const trace = [];
  let closed = false;
  return {
    DB,
    trace,
    env: { DB: traceDb(DB, trace) },
    // 幂等：close 两次不会炸，也允许调用方在 finally 里无条件调
    close: () => {
      if (closed) return;
      closed = true;
      try { DB.close(); } catch {}
    },
  };
}

/** 逐个版本跑同一个场景，收集结果后比对 —— B 与 N 各拿一份全新的库 */
async function bothVersions(path, body) {
  const { oldM, newM, cleanup } = await loadBoth(path);
  try {
    const results = [];
    for (const mod of [oldM, newM]) {
      const f = await seeded();
      try {
        results.push(await body(mod, f));
      } finally {
        f.close();
      }
    }
    const [a, b] = results;
    return { a, b };
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// 测试侧的 WebAuthn 造物
//
// 下面这些编码器是**按 WebAuthn/COSE 规范独立写的**，不是从被测模块抄的 ——
// 如果从模块里抄，模块改错了测试也跟着错，就成了自证清白。
// base64url 走 Buffer 而不是模块的 bytesToB64url，同理。
// ---------------------------------------------------------------------------

const b64uToBytes = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const bytesToB64u = (b) => Buffer.from(b).toString('base64url');
const utf8 = (s) => new TextEncoder().encode(s);
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};

/** 最小 CBOR 编码器（uint / text / bytes / array / map）—— 造 fmt=none 的 attestation */
function cborEncode(value) {
  const head = (major, n) => {
    const m = major << 5;
    if (n < 24) return [m | n];
    if (n < 0x100) return [m | 24, n];
    if (n < 0x10000) return [m | 25, (n >> 8) & 0xff, n & 0xff];
    return [m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  };
  const parts = [];
  const write = (v) => {
    if (typeof v === 'number') { parts.push(head(0, v)); return; }
    if (typeof v === 'string') { const b = utf8(v); parts.push(head(3, b.length), b); return; }
    if (v instanceof Uint8Array) { parts.push(head(2, v.length), v); return; }
    if (Array.isArray(v)) { parts.push(head(4, v.length)); v.forEach(write); return; }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      parts.push(head(5, keys.length));
      for (const k of keys) { write(k); write(v[k]); }
      return;
    }
    throw new Error('cborEncode 不支持 ' + typeof v);
  };
  write(value);
  return concat(parts);
}

/**
 * 造一个 77 字节的 ES256 COSE_Key。
 * 布局按 COSE_Key / RFC 8152 的 P-256 固定写法，x 在 [10,42)、y 在 [45,77)。
 */
function coseKeyFromJwk(jwk) {
  const x = b64uToBytes(jwk.x);
  const y = b64uToBytes(jwk.y);
  const out = new Uint8Array(77);
  // a5 | kty=1 | EC2=2 | alg=3 | -7 | crv=P-256 | -2 (x) | bstr(32) ...
  out.set([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x22, 0x58, 0x20], 0);
  out.set(x, 10);
  out.set([0x22, 0x58, 0x20], 42);
  out.set(y, 45);
  return out;
}

/** rpIdHash(32) + flags(1) + signCount(4) + [aaguid(16) + credIdLen(2) + credId + COSE] */
async function buildAuthData({ rpId, flags, signCount, aaguid, credId, cose }) {
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(rpId)));
  const head = new Uint8Array(37 + 16 + 2 + credId.length);
  head.set(rpIdHash, 0);
  head[32] = flags;
  new DataView(head.buffer).setUint32(33, signCount);
  head.set(aaguid, 37);
  head[53] = (credId.length >> 8) & 0xff;
  head[54] = credId.length & 0xff;
  head.set(credId, 55);
  return concat([head, cose]);
}

/** Web Crypto 的 ECDSA 签名是 raw r||s，被测模块吃的是 DER —— 这里做 raw→DER */
function rawToDer(raw) {
  const int = (bytes) => {
    let s = bytes;
    let i = 0;
    while (i < s.length - 1 && s[i] === 0) i++;
    s = s.slice(i);
    if (s[0] & 0x80) s = Uint8Array.from([0, ...s]);
    return Uint8Array.from([0x02, s.length, ...s]);
  };
  const body = concat([int(raw.slice(0, 32)), int(raw.slice(32, 64))]);
  return Uint8Array.from([0x30, body.length, ...body]);
}

/** WebAuthn 签名输入 = authenticatorData || SHA-256(clientDataJSON) */
async function signAssertion(privKey, authData, clientDataJSON) {
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(clientDataHash, authData.length);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, signed));
  return rawToDer(raw);
}

/** 造一对真 P-256 密钥，返回 { privKey, jwk } */
async function newP256() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { privKey: kp.privateKey, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
}

const ORIGIN = { type: 'webauthn.create', origin: 'https://local.test' };
const ORIGIN_LOGIN = { type: 'webauthn.get', origin: 'https://local.test' };
const RP_ID = 'local.test';
const AAGUID = new Uint8Array(16).fill(7);
const CRED_ID = utf8('equivalence-test-credential-id');

// ===========================================================================
// 1. export 名单
// ===========================================================================

test(`_shared 重写没改任何 export 名单（对照 ${BASELINE}）`, () => {
  const files = changedSharedFiles();
  assert.ok(files.length > 0, '基线之后 _shared 应当有被改动的文件，否则这个测试形同虚设');
  const problems = [];
  for (const path of files) {
    const before = exportNames(show(path));
    const after = exportNames(read(path));
    const lost = before.filter((n) => !after.includes(n));
    const added = after.filter((n) => !before.includes(n));
    if (lost.length || added.length) {
      problems.push(`${path}: 少了 [${lost.join(' ')}]，多了 [${added.join(' ')}]`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
  // 防假绿：名单全空（比如正则一个都没匹配上）也算「一致」
  const sample = exportNames(read(`${SHARED_DIR}/webauthn.js`));
  assert.ok(sample.length >= 8, `export 名单解析异常，只认出 ${sample.length} 个：${sample.join(' ')}`);
});

// ===========================================================================
// 2. validators 纯函数
// ===========================================================================

test('validators：4 个纯函数在 40+ 组输入上两版逐个一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(`${SHARED_DIR}/validators.js`);
  try {
    const NON_EMPTY = [
      '', ' ', '\t\n', 'x', '你好', 'a'.repeat(2000), 'a'.repeat(2001), 'a'.repeat(5000),
      null, undefined, 0, 1, true, false, [], {}, ['x'], { toString: () => 'y' },
    ];
    const EMAILS = [
      'a@b.co', 'a@b', 'a@b.c', 'a b@c.co', '@b.co', 'a@.co', 'a@b.', 'a@@b.co',
      'a'.repeat(250) + '@b.co', 'a'.repeat(250) + 'x@b.co', '灯灯@市.co', '', null, undefined, 42,
    ];
    const USERNAMES = [
      'ab', 'a', '灯灯', 'a_b-c.d e', '灯灯客服', 'AI_BOT', 'ai_bot', 'Ai_Bot',
      'a@b', 'ab\ncd', 'ab\tcd', 'ab cd', '  ab  ', '', 'a'.repeat(32), 'a'.repeat(33),
      '  灯灯客服  ', null, undefined, 7, {},
    ];
    const HTML = [
      '<script>alert(1)</script>', 'a<b>c</b>', `"双引"`, "it's", '<img src=x onerror=y>',
      '正常文字', '', null, undefined, 123, 'a'.repeat(2100), '<>', '<<>>', '&amp;',
    ];

    const run = (m, name, input, arg2) => {
      try { return { v: m[name](input, arg2) }; }
      catch (e) { return { throw: e.message }; }
    };

    const diffs = [];
    for (const [name, cases, withArg] of [
      ['isNonEmpty', NON_EMPTY, true],
      ['isEmail', EMAILS, false],
      ['isUsername', USERNAMES, false],
      ['stripHtml', HTML, false],
    ]) {
      for (const input of cases) {
        const args = withArg ? [input, undefined] : [input];
        const ra = run(oldM, name, ...args);
        const rb = run(newM, name, ...args);
        if (JSON.stringify(ra) !== JSON.stringify(rb)) {
          diffs.push(`${name}(${JSON.stringify(input)}): 原 ${JSON.stringify(ra)} ≠ 新 ${JSON.stringify(rb)}`);
        }
      }
    }
    // isNonEmpty 的 max 参数也要两版一致（默认 2000 vs 被重写成别的）
    for (const max of [1, 2, 5, 2000, 2001]) {
      for (const s of ['', 'a', 'ab', 'abc', 'a'.repeat(50)]) {
        if (oldM.isNonEmpty(s, max) !== newM.isNonEmpty(s, max)) {
          diffs.push(`isNonEmpty(${JSON.stringify(s)}, ${max}) 不一致`);
        }
      }
    }
    assert.deepEqual(diffs, [], diffs.join('\n'));

    // 防假绿：锁住已知答案，参数被改（比如保留名检查、254 上限、2000 截断）就会炸
    assert.equal(newM.isNonEmpty('你好', 2000), true);
    assert.equal(newM.isNonEmpty('a'.repeat(2001)), false, '2000 字上限必须还在');
    assert.equal(newM.isEmail('a@b.co'), true);
    assert.equal(newM.isEmail('a b@c.co'), false, '不能含空格');
    assert.equal(newM.isEmail('a'.repeat(250) + 'x@b.co'), false, '254 上限必须还在');
    assert.equal(newM.isUsername('灯灯客服'), false, '内置 AI bot 保留名');
    assert.equal(newM.isUsername('AI_BOT'), false, '保留名要大小写不敏感');
    assert.equal(newM.isUsername('a@b'), false, '用户名不能含 @');
    assert.equal(newM.isUsername('中文名'), true);
    assert.equal(newM.stripHtml('<b>粗体</b>'), '粗体', '标签要被剥掉');
    assert.equal(newM.stripHtml('<>&"\''), '&&quot;&#39;', '整段标签被剥掉后残留的裸字符要转义');
    assert.equal(newM.stripHtml('a < b'), 'a &lt; b', '不构成标签的裸 < 要转义而不能被吞掉');
    assert.equal(newM.stripHtml('x'.repeat(2100)).length, 2000, '2000 字截断必须还在');
    assert.equal(newM.stripHtml(123), '', '非字符串返回空串而不是崩');
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 3. PBKDF2 参数
// ===========================================================================

test('auth：PBKDF2 参数逐字未动（对照独立算出的 100000/SHA-256 参考值）', async () => {
  const { oldM, newM, cleanup } = await loadBoth(`${SHARED_DIR}/auth.js`);
  try {
    // 测试自己按规范算一遍参考值 —— 不复用被测模块的 hexToBytes，
    // 否则模块改了盐的解析方式，参考值会跟着一起错。
    const hexToBytesIndependent = (hex) => {
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    };
    const bytesToHexIndependent = (buf) =>
      [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const reference = async (password, saltHex, iterations, hash) => {
      const key = await crypto.subtle.importKey('raw', utf8(password), { name: 'PBKDF2' }, false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: hexToBytesIndependent(saltHex), iterations, hash },
        key,
        256
      );
      return bytesToHexIndependent(bits);
    };

    const SALT = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
    const PASSWORD = 'correct horse battery staple 中文密码';
    const expected = await reference(PASSWORD, SALT, 100_000, 'SHA-256');

    for (const [label, mod] of [['原', oldM], ['新', newM]]) {
      const r = await mod.hashPassword(PASSWORD, SALT);
      assert.equal(r.hash, expected, `${label}：hash 与 100000 次 SHA-256 的参考值不符 —— 参数被改了`);
      assert.equal(r.salt, SALT, `${label}：传入的盐必须原样使用`);
      assert.equal(r.hash.length, 64, `${label}：SHA-256 应为 32 字节 = 64 hex`);
    }

    // 两版逐字相同
    assert.equal(
      (await oldM.hashPassword(PASSWORD, SALT)).hash,
      (await newM.hashPassword(PASSWORD, SALT)).hash
    );

    // 防假绿：迭代数/哈希算法被换掉时，上面第一条就会挂；这里再确认 verifyPassword 真的在用哈希
    for (const [label, mod] of [['原', oldM], ['新', newM]]) {
      assert.equal(await mod.verifyPassword(PASSWORD, expected, SALT), true, `${label}：正确密码应通过`);
      assert.equal(await mod.verifyPassword(PASSWORD + 'x', expected, SALT), false, `${label}：错误密码必须拒绝`);
      assert.equal(await mod.verifyPassword(PASSWORD, expected, 'a'.repeat(64)), false, `${label}：换盐必须失败`);
    }

    // randomToken：长度与字符集两版一致
    for (const [label, mod] of [['原', oldM], ['新', newM]]) {
      for (const len of [16, 24, 32, 64]) {
        const t = mod.randomToken(len);
        assert.equal(t.length, len * 2, `${label}：randomToken(${len}) 长度不对`);
        assert.match(t, /^[0-9a-f]+$/, `${label}：randomToken 必须是小写 hex`);
      }
    }
    assert.notEqual(newM.randomToken(32), newM.randomToken(32), 'randomToken 必须每次不同');
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 4. bytes 往返
// ===========================================================================

test('bytes：hex / base64url 双向转换在边界值上两版一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(`${SHARED_DIR}/bytes.js`);
  try {
    const SAMPLES = [
      new Uint8Array(0),
      new Uint8Array([0]),
      new Uint8Array([0xff]),
      new Uint8Array([0x00, 0x0f, 0xff]),
      Uint8Array.from({ length: 32 }, (_, i) => i * 8),
      Uint8Array.from({ length: 256 }, (_, i) => i),
      crypto.getRandomValues(new Uint8Array(32)),
      // 会让 base64 出现 + / 的字节，专门压 b64url 替换分支
      new Uint8Array([0xfb, 0xff, 0xbe, 0x00, 0x3e, 0x3f]),
    ];

    for (const s of SAMPLES) {
      const hex = oldM.bytesToHex(s);
      assert.equal(hex, newM.bytesToHex(s), `bytesToHex 长度 ${s.length} 不一致`);
      // hex 往返
      assert.deepEqual([...newM.hexToBytes(hex)], [...s], `hex 往返丢了数据（len=${s.length}）`);
      // b64url 往返
      const b64 = oldM.bytesToB64url(s);
      assert.equal(b64, newM.bytesToB64url(s), `bytesToB64url 长度 ${s.length} 不一致`);
      assert.deepEqual([...newM.b64urlToBytes(b64)], [...s], `b64url 往返丢了数据（len=${s.length}）`);
    }

    // ArrayBuffer 入参（bytesToB64url 里 `new Uint8Array(buf.buffer || buf)` 的分支）
    const ab = new Uint8Array([1, 2, 3, 250, 251, 252]).buffer;
    assert.equal(newM.bytesToB64url(ab), newM.bytesToB64url(new Uint8Array(ab)), 'ArrayBuffer 与其视图应等价');

    // 防假绿：锁死已知答案
    assert.equal(newM.bytesToHex(new Uint8Array([0x00, 0x0f, 0xff])), '000fff', 'hex 必须补零到两位');
    assert.equal(newM.bytesToHex(new Uint8Array(0)), '', '空数组应得空串');
    assert.deepEqual([...newM.hexToBytes('000fff')], [0, 15, 255]);
    assert.equal(newM.bytesToB64url(Uint8Array.from([251, 255, 190])), '-_--', '+ / 必须换成 - _ 且去掉 =');
    assert.match(newM.bytesToB64url(crypto.getRandomValues(new Uint8Array(32))), /^[A-Za-z0-9_-]+$/, 'b64url 不能出现 + / =');

    // hexToBytes 对奇数长度 / 非 hex 的行为两版一致（不要求正确，只要求一致）
    for (const bad of ['', 'a', 'abc', 'zz', '00ff11', 'ff ']) {
      const ra = (() => { try { return [...oldM.hexToBytes(bad)]; } catch (e) { return 'THROW:' + e.message; } })();
      const rb = (() => { try { return [...newM.hexToBytes(bad)]; } catch (e) { return 'THROW:' + e.message; } })();
      assert.deepEqual(rb, ra, `hexToBytes(${JSON.stringify(bad)}) 行为不一致`);
    }
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 5. tickets.createTicket
// ===========================================================================

test('tickets：createTicket 真的落库，两版 SQL 序列与落库结果一致', async () => {
  const { a, b } = await bothVersions(`${SHARED_DIR}/tickets.js`, async (mod, f) => {
    const ticket = await mod.createTicket(f.env, {
      player_id: 1,
      category: 'message',
      source_table: 'messages',
      source_id: 42,
      title: '等价性测试工单',
      body: '正文内容',
      priority: 'high',
    });
    const row = await f.DB.prepare(
      'SELECT id,player_id,category,source_table,source_id,title,body,status,priority FROM tickets ORDER BY id'
    ).all();
    return { ticket, rows: row.results, sql: f.trace };
  });

  assert.deepEqual(b.sql, a.sql, 'SQL 序列不一致');
  assert.deepEqual(b.rows, a.rows, '工单落库结果不一致');

  // 防假绿：返回的 id 必须是真实的、且行真的在库里
  // （基线实现只发一条 INSERT，所以这里断言 >= 1 而不是 >= 2）
  assert.ok(a.sql.length >= 1, 'createTicket 至少要发出一条 SQL');
  assert.equal(a.sql.filter((s) => s.startsWith('INSERT INTO tickets')).length, 1, '应恰好一条 tickets INSERT');
  assert.equal(a.ticket, 1, '新库里的第一张工单 id 应为 1');
  assert.equal(a.rows.length, 1, '工单应真的落库（1 行）');
  assert.equal(a.rows[0].id, a.ticket, '返回的 id 必须指向真实落库的那行');
  assert.equal(a.rows[0].title, '等价性测试工单');
  assert.equal(a.rows[0].priority, 'high', 'priority 必须真的传进 SQL');
  assert.equal(a.rows[0].source_id, 42);
  assert.equal(a.rows[0].status, 'open', 'status 应取表默认值');

  // 各种拒收路径：两版都必须返回 null 且不发 SQL
  const { a: ga, b: gb } = await bothVersions(`${SHARED_DIR}/tickets.js`, async (mod, f) => {
    const out = [];
    for (const opts of [
      { title: '没有 category' },
      { category: 'message' },
      { category: '', title: '空 category' },
      { category: 'message', title: '' },
    ]) {
      out.push({ id: await mod.createTicket(f.env, opts) });
    }
    out.push({ id: await mod.createTicket({}, { category: 'message', title: '没有 env.DB' }) });
    out.push({ id: await mod.createTicket(undefined, { category: 'message', title: 'env 是 undefined' }) });
    const rows = (await f.DB.prepare('SELECT COUNT(*) AS n FROM tickets').first()).n;
    return { out, rows, sql: f.trace };
  });
  assert.deepEqual(gb.sql, ga.sql, '拒收路径的 SQL 序列不一致');
  assert.deepEqual(gb.out, ga.out, '拒收路径的返回值不一致');
  assert.deepEqual(ga.out.map((o) => o.id), [null, null, null, null, null, null], '缺参/无 DB 都应返回 null');
  assert.equal(ga.rows, 0, '被拒的请求不能留下任何工单');

  // ticketFromMessage：连带验证 messages 的必填列 fixture（name/contact/type/content）
  const { a: ha, b: hb } = await bothVersions(`${SHARED_DIR}/tickets.js`, async (mod, f) => {
    await f.DB.prepare(
      "INSERT INTO messages(id,player_id,name,contact,type,content) VALUES(7,1,'市民小李','13800000000','留言','路灯不亮')"
    ).run();
    f.trace.length = 0; // 只记录 createTicket 之后的
    const msg = (await f.DB.prepare('SELECT * FROM messages WHERE id=7').first());
    const id = await mod.ticketFromMessage(f.env, msg, 7);
    const row = await f.DB.prepare('SELECT id,player_id,category,source_table,source_id,title,body FROM tickets').first();
    return { id, row, sql: f.trace };
  });
  assert.deepEqual(hb.sql, ha.sql, 'ticketFromMessage 的 SQL 序列不一致');
  assert.deepEqual(hb.row, ha.row, 'ticketFromMessage 落库结果不一致');
  assert.equal(ha.id, 1);
  assert.equal(ha.row.category, 'message');
  assert.equal(ha.row.source_table, 'messages');
  assert.equal(ha.row.source_id, 7, 'source_id 必须回填原表 id');
  assert.equal(ha.row.title, '路灯不亮', 'title 应取 content');
  assert.equal(ha.row.body, '路灯不亮', 'body 应为完整 content');
});

// ===========================================================================
// 6. rateLimit SQL 序列
// ===========================================================================

test('validators：rateLimit 的 SQL 序列与放行/拦截判定两版一致', async () => {
  // 造 n 条留言。messages 的 name/contact/type/content 是 NOT NULL，少一列整条 INSERT 就炸。
  const seed = (f, n) =>
    f.DB.batch(
      Array.from({ length: n }, (_, i) =>
        f.DB.prepare(
          "INSERT INTO messages(player_id,name,contact,type,content) VALUES(1,'市民','13800000000','留言',?)"
        ).bind('第 ' + i + ' 条留言')
      )
    );

  const { a, b } = await bothVersions(`${SHARED_DIR}/validators.js`, async (mod, f) => {
    await seed(f, 5);
    f.trace.length = 0;
    const out = [];
    // 恰好卡在 limit 上：baseline 是 n >= limit 就拦，所以 5 条 / limit 5 必须拦
    out.push({ step: '满额', r: await mod.rateLimit(f.env, 'msg:player:1', 5, 60), sql: f.trace.splice(0) });
    out.push({ step: '换个玩家', r: await mod.rateLimit(f.env, 'msg:player:999', 5, 60), sql: f.trace.splice(0) });
    out.push({ step: '提高 limit', r: await mod.rateLimit(f.env, 'msg:player:1', 6, 60), sql: f.trace.splice(0) });
    out.push({ step: '非 player 类型', r: await mod.rateLimit(f.env, 'msg:ip:1.2.3.4', 1, 60), sql: f.trace.splice(0) });
    out.push({ step: 'scope 不认识', r: await mod.rateLimit(f.env, 'chat:player:1', 1, 60), sql: f.trace.splice(0) });
    out.push({ step: '空 key', r: await mod.rateLimit(f.env, '', 1, 60), sql: f.trace.splice(0) });
    out.push({ step: '无 DB', r: await mod.rateLimit({}, 'msg:player:1', 1, 60), sql: f.trace.splice(0) });
    out.push({ step: 'env 为 null', r: await mod.rateLimit(null, 'msg:player:1', 1, 60), sql: f.trace.splice(0) });
    return { out };
  });

  assert.deepEqual(
    b.out.map((o) => o.r),
    a.out.map((o) => o.r),
    'rateLimit 返回值不一致'
  );
  for (let i = 0; i < a.out.length; i++) {
    assert.deepEqual(b.out[i].sql, a.out[i].sql, `${a.out[i].step}：SQL 序列不一致`);
  }

  const byStep = Object.fromEntries(a.out.map((o) => [o.step, o]));

  // 防假绿：必须真的数了库
  assert.equal(byStep['满额'].r.allowed, false, '5 条留言 / limit 5 应被拦截（n >= limit）');
  assert.equal(byStep['满额'].r.count, 5, '应数出 5 条');
  assert.equal(byStep['满额'].r.limit, 5);
  assert.equal(byStep['满额'].r.retryAfter, 60, 'retryAfter 应回 windowSec');
  // 拦截分支要多查一次「最早一条」—— 这条查出来的值没人用（见 validators.js 里的疑点注释），
  // 但它属于 SQL 序列的一部分，删掉/加上都要让本测试报警
  assert.equal(byStep['满额'].sql.length, 2, '拦截时应发 2 条 SQL（计数 + 查最早一条）');
  assert.match(byStep['满额'].sql[0], /SELECT COUNT\(\*\) AS n FROM messages/);
  assert.match(byStep['满额'].sql[1], /ORDER BY created_at ASC LIMIT 1/);
  assert.equal(byStep['提高 limit'].r.allowed, true, 'limit 提高到 6 就该放行');
  assert.equal(byStep['提高 limit'].r.count, 5);
  assert.equal(byStep['提高 limit'].sql.length, 1, '放行时只应发 1 条 SQL');
  assert.equal(byStep['换个玩家'].r.allowed, true, '没留言的玩家应放行');
  assert.equal(byStep['换个玩家'].r.count, 0);
  // 不认识的 scope/type 一律放行，且**一条 SQL 都不该发**
  for (const step of ['非 player 类型', 'scope 不认识', '空 key', '无 DB', 'env 为 null']) {
    assert.equal(byStep[step].r.allowed, true, `${step}：应放行`);
    assert.equal(byStep[step].sql.length, 0, `${step}：不该发任何 SQL`);
  }

  // 时间窗口：造一条 10 分钟前的留言 + limit 1，窗口 60 秒时应放行
  const { a: wa, b: wb } = await bothVersions(`${SHARED_DIR}/validators.js`, async (mod, f) => {
    await f.DB.prepare(
      "INSERT INTO messages(player_id,name,contact,type,content,created_at) VALUES(1,'市民','138','留言','十分钟前',datetime('now','-10 minutes'))"
    ).run();
    f.trace.length = 0;
    return { r: await mod.rateLimit(f.env, 'msg:player:1', 1, 60), sql: f.trace };
  });
  assert.deepEqual(wb.r, wa.r, '窗口外的留言不应计入');
  assert.equal(wa.r.allowed, true, '10 分钟前的留言不该触发 60 秒窗口的限流');
  assert.equal(wa.r.count, 0);
});

// ===========================================================================
// 7. session CRUD
// ===========================================================================

test('session：create/get/destroy 全链路两版一致，且过期会话会被顺手删掉', async () => {
  const { a, b } = await bothVersions(`${SHARED_DIR}/session.js`, async (mod, f) => {
    const created = await mod.createSession(f.env, 1, null, null);
    const got = await mod.getSession(f.env, created.token);
    // 显式塞一条已过期的会话，走「过期即删」那条分支
    await f.DB.prepare(
      "INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('stale',1,NULL,'2000-01-01 00:00:00')"
    ).run();
    // 再塞一条 expires_at 非法的
    await f.DB.prepare(
      "INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('garbage',1,NULL,'not-a-date')"
    ).run();
    f.trace.length = 0;
    const stale = await mod.getSession(f.env, 'stale');
    const garbage = await mod.getSession(f.env, 'garbage');
    const missing = await mod.getSession(f.env, 'never-existed');
    const empty = await mod.getSession(f.env, '');
    const nullTok = await mod.getSession(f.env, null);
    // 只看固定名字的那几条：created 的 token 是随机的，不能进比对结果
    const afterExpiry = (await f.DB.prepare(
      "SELECT token FROM sessions WHERE token IN ('stale','garbage','never-existed') ORDER BY token"
    ).all()).results;
    const adminSession = await mod.createSession(f.env, null, 2, null);
    const hotelSession = await mod.createSession(f.env, 1, null, 9);
    const aliveRaw = (await f.DB.prepare(
      "SELECT token,player_id,admin_id,hotel_owner_id FROM sessions WHERE token IN (?,?) ORDER BY token"
    ).bind(adminSession.token, hotelSession.token).all()).results;
    // token 是随机的，只留身份三列进比对结果
    const alive = aliveRaw.map((r) => [r.player_id, r.admin_id, r.hotel_owner_id]).sort();
    await mod.destroySession(f.env, created.token);
    await mod.destroySession(f.env, ''); // 空 token 应静默返回
    await mod.destroySession(f.env, null);
    // 剩下的两条是随机 token，只比条数与「被销毁的那条确实没了」
    const finalTokens = (await f.DB.prepare('SELECT token FROM sessions ORDER BY token').all()).results;
    return {
      // token 与 expires_at 是随机/时间相关的，比对时用形状代替
      tokenShape: /^[0-9a-f]{48}$/.test(created.token),
      expiresInHours: Math.round((+new Date(created.expires_at) - Date.now()) / 3600_000),
      got: got && { player_id: got.player_id, admin_id: got.admin_id, hotel_owner_id: got.hotel_owner_id ?? null },
      stale, garbage, missing, empty, nullTok,
      afterExpiry: afterExpiry.map((r) => r.token),
      alive,
      finalCount: finalTokens.length,
      destroyedGone: !finalTokens.some((r) => r.token === created.token),
      sql: f.trace,
    };
  });

  assert.deepEqual(b.sql, a.sql, 'SQL 序列不一致');
  assert.deepEqual(b, a, 'session 行为不一致');

  // 防假绿
  assert.equal(a.tokenShape, true, 'createSession 的 token 应是 24 字节 = 48 hex');
  assert.equal(a.expiresInHours, 8, '会话有效期必须是 8 小时');
  assert.equal(a.got.player_id, 1, '建出来的会话必须能被 getSession 读回');
  assert.equal(a.got.admin_id, null);
  assert.equal(a.stale, null, '过期会话必须读成 null');
  assert.equal(a.garbage, null, 'expires_at 非法的会话必须读成 null');
  assert.equal(a.missing, null, '不存在的 token 必须是 null');
  assert.equal(a.empty, null, '空 token 必须是 null');
  assert.equal(a.nullTok, null, 'null token 必须是 null');
  // 过期和非法两条都应被顺手 DELETE 掉
  assert.deepEqual(a.afterExpiry, [], '过期/非法/不存在的会话都应被删掉或本就不在库里');
  assert.equal(a.alive.length, 2, 'admin 会话与 hotel_owner 会话都应落库');
  assert.deepEqual(
    a.alive,
    [[1, null, 9], [null, 2, null]].sort(),
    'player/admin/hotel_owner 三种身份要正确落到各自的列'
  );
  // destroy 之后原 token 必须真的没了，另两条还在
  assert.equal(a.finalCount, 2, 'destroySession 后应只剩 admin 与 hotel_owner 两条');
  assert.equal(a.destroyedGone, true, 'destroySession 必须真的删掉那条会话');
});

// ===========================================================================
// 8. mergeAccount
// ===========================================================================

test('session：mergeAccount 的双向绑定与三条拒绝分支两版一致', async () => {
  const { a, b } = await bothVersions(`${SHARED_DIR}/session.js`, async (mod, f) => {
    const read = () => f.DB.prepare(
      'SELECT p.linked_admin_id AS plink, a.linked_player_id AS alink FROM players p, admins a WHERE p.id=1 AND a.id=1'
    ).first();
    const before = await read();
    const ok = await mod.mergeAccount(f.env, 1, 1);
    const after = await read();

    // 拒绝分支。每个都必须 await —— 不 await 的话 SQL trace 会在函数 return
    // 之后才被继续写入，比对时就变成「两版 SQL 序列不同」的假故障。
    const conflictPlayer = await run(() => mod.mergeAccount(f.env, 2, 1));   // 玩家已绑给别的管理员
    const conflictAdmin = await run(() => mod.mergeAccount(f.env, 1, 2));    // 管理员已绑给别的玩家
    const noPlayer = await run(() => mod.mergeAccount(f.env, 1, 999));       // 玩家不存在
    const banned = await run(() => mod.mergeAccount(f.env, 1, 3));           // 玩家已封禁
    const noAdmin = await run(() => mod.mergeAccount(f.env, 999, 1));        // 管理员不存在
    const noArgs = await run(() => mod.mergeAccount(f.env, null, 1));        // 缺参
    // 重复合并同一个组合应幂等（已绑给自己不算冲突）
    const again = await run(() => mod.mergeAccount(f.env, 1, 1));

    const links = await f.DB.prepare(
      'SELECT id,linked_admin_id FROM players ORDER BY id'
    ).all();
    const alinks = await f.DB.prepare(
      'SELECT id,linked_player_id FROM admins ORDER BY id'
    ).all();
    return { before, ok, after, conflictPlayer, conflictAdmin, noPlayer, banned, noAdmin, noArgs, again, links: links.results, alinks: alinks.results, sql: f.trace };
  });

  assert.deepEqual(b.sql, a.sql, 'SQL 序列不一致');
  assert.deepEqual(b, a, 'mergeAccount 行为不一致');

  // 防假绿：绑定必须真的写进两个方向
  assert.equal(a.before.plink, null, '初始应未绑定');
  assert.deepEqual(a.ok, { admin_id: 1, player_id: 1, admin_username: 'super', player_username: 'citizen' });
  assert.equal(a.after.plink, 1, 'players.linked_admin_id 必须被写上');
  assert.equal(a.after.alink, 1, 'admins.linked_player_id 必须被写上（双向）');
  assert.equal(a.links.find((r) => r.id === 1).linked_admin_id, 1);
  assert.equal(a.alinks.find((r) => r.id === 1).linked_player_id, 1);

  // 冲突必须抛错，且报错信息里要点名被占用的 id
  assert.match(a.conflictPlayer.error, /已绑定其他管理员 \(id=1\)/, '玩家被别人占了要报错并点名');
  assert.match(a.conflictAdmin.error, /已绑定其他玩家 \(id=1\)/, '管理员被别人占了要报错并点名');
  assert.equal(a.noPlayer.error, '玩家不存在或未激活');
  assert.equal(a.banned.error, '玩家不存在或未激活', '封禁玩家不能合并');
  assert.equal(a.noAdmin.error, '管理员不存在');
  assert.equal(a.noArgs.error, 'mergeAccount: adminId 和 playerId 必填');
  assert.equal(a.again.v.admin_id, 1, '重复合并同一组合应幂等成功');
});

async function run(fn) {
  try { return { v: await fn() }; }
  catch (e) { return { error: e.message }; }
}

// ===========================================================================
// 9. readToken
// ===========================================================================

test('session：readToken 的 header/cookie 优先级两版一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(`${SHARED_DIR}/session.js`);
  try {
    const req = (headers) => new Request('https://local.test/api/x', { headers });
    const CASES = [
      ['X-Session-Token 优先', { 'X-Session-Token': 'from-header', Authorization: 'Bearer from-auth', Cookie: 'lc_session=from-cookie' }],
      ['X-Session-Token 压过裸 Authorization', { 'X-Session-Token': 'from-header', Authorization: 'raw-auth' }],
      ['Bearer 去掉前缀', { Authorization: 'Bearer tok123' }],
      ['裸 Authorization 原样返回', { Authorization: 'tok456' }],
      ['Bearer 大小写敏感', { Authorization: 'bearer tok789' }],
      ['只有 cookie', { Cookie: 'lc_session=c1' }],
      ['cookie 在中间', { Cookie: 'a=1; lc_session=c2; b=2' }],
      ['cookie 在开头', { Cookie: 'lc_session=c3; a=1' }],
      ['cookie 在末尾', { Cookie: 'a=1; lc_session=c4' }],
      ['同名 cookie 多个取第一个', { Cookie: 'lc_session=first; lc_session=second' }],
      ['相似名字不算', { Cookie: 'xlc_session=nope; my_lc_session=nope2' }],
      ['空 cookie 值', { Cookie: 'lc_session=' }],
      ['空 Cookie 头', { Cookie: '' }],
      ['什么都没有', {}],
      ['只有别的 cookie', { Cookie: 'theme=dark' }],
    ];
    const diffs = [];
    for (const [label, headers] of CASES) {
      const a = oldM.readToken(req(headers));
      const b = newM.readToken(req(headers));
      if (a !== b) diffs.push(`${label}: 原 ${JSON.stringify(a)} ≠ 新 ${JSON.stringify(b)}`);
    }
    assert.deepEqual(diffs, [], diffs.join('\n'));

    // 防假绿：锁死已知答案
    const t = (h) => newM.readToken(req(h));
    assert.equal(t({ 'X-Session-Token': 'from-header', Authorization: 'Bearer from-auth', Cookie: 'lc_session=from-cookie' }), 'from-header');
    assert.equal(t({ 'X-Session-Token': 'from-header', Authorization: 'raw-auth' }), 'from-header');
    assert.equal(t({ Authorization: 'Bearer tok123' }), 'tok123', 'Bearer 前缀要去掉');
    assert.equal(t({ Authorization: 'tok456' }), 'tok456', '裸 Authorization 原样返回');
    assert.equal(t({ Authorization: 'bearer tok789' }), 'bearer tok789', 'bearer 小写不该被当成前缀剥掉');
    assert.equal(t({ Cookie: 'a=1; lc_session=c2; b=2' }), 'c2', 'cookie 在中间也要认');
    assert.equal(t({ Cookie: 'xlc_session=nope' }), null, '前缀不匹配不能误认');
    assert.equal(t({ Cookie: 'lc_session=first; lc_session=second' }), 'first');
    assert.equal(t({}), null);
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 10. parseAuthData
// ===========================================================================

test('webauthn：parseAuthData 的字段切分与 AT 段解析两版一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth(`${SHARED_DIR}/webauthn.js`);
  try {
    const COSE = coseKeyFromJwk({ x: 'A'.repeat(43), y: 'B'.repeat(43) });
    const build = (flags, signCount, withAT) => {
      const base = new Uint8Array(37);
      for (let i = 0; i < 32; i++) base[i] = i;
      base[32] = flags;
      new DataView(base.buffer).setUint32(33, signCount);
      if (!withAT) return base;
      return concat([base, AAGUID, Uint8Array.from([0, CRED_ID.length]), CRED_ID, COSE]);
    };

    // [标签, 数据, 是否应解析出 AT 段, 是否应抛错]
    const CASES = [
      ['只有基础段 UP+UV', build(0x05, 0, false), false, false],
      ['带 AT', build(0x45, 0, true), true, false],
      ['全标志 UP|UV|AT|UV2', build(0x4d, 7, true), true, false],
      ['signCount 大值', build(0x45, 0xdeadbeef, true), true, false],
      ['signCount 0xffffffff', build(0x45, 0xffffffff, true), true, false],
      ['完全没有标志', build(0x00, 0, false), false, false],
      ['AT 标志但数据被截断', build(0x45, 0, true).slice(0, 50), false, true],
      ['刚好 37 字节且带 AT 标志', build(0x45, 0, false), false, true],
      ['太短 36 字节', build(0x05, 0, false).slice(0, 36), false, true],
      ['空', new Uint8Array(0), false, true],
    ];

    // 注意：cosePubKey 是**再解一次 CBOR** 得到的对象（不是字节），
    // 所以只能按 key/value 取值，不能当数组展开。
    const normalize = (r) => r.attestedCredentialData && {
      aaguid: [...r.attestedCredentialData.aaguid],
      credentialId: [...r.attestedCredentialData.credentialId],
      cose: Object.entries(r.attestedCredentialData.cosePubKey)
        .map(([k, v]) => `${k}=${v instanceof Uint8Array ? [...v] : String(v)}`)
        .sort(),
    };
    const call = (m, data) => {
      try {
        const r = m.parseAuthData(data);
        return {
          rpIdHash: [...r.rpIdHash], flags: r.flags, signCount: r.signCount,
          at: normalize(r), hasAT: !!r.attestedCredentialData,
        };
      } catch (e) { return { throw: e.message }; }
    };

    for (const [label, data, hasAT, shouldThrow] of CASES) {
      const a = call(oldM, data);
      const b = call(newM, data);
      assert.deepEqual(b, a, `${label}：两版解析结果不一致`);
      // 防假绿：要么按预期解析出 AT 段，要么按预期报错，
      // 但不能「既没报错、也没 AT」地蒙过去
      if (shouldThrow) {
        assert.ok(a.throw, `${label}：应当抛错，实际却返回了结果`);
        continue;
      }
      assert.equal(a.throw, undefined, `${label}：本该解析成功却报错了 ${a.throw}`);
      assert.equal(a.hasAT, hasAT, `${label}：attestedCredentialData 存在性不对`);
    }
    // 截断 / 过短的缓冲必须真的报错，而不是静默返回半个结果
    for (const [label, data] of CASES.filter(([, , , t]) => t)) {
      assert.ok(call(newM, data).throw, `${label}：应当抛错`);
    }

    // 防假绿：锁死已知切分
    const full = call(newM, build(0x4d, 7, true));
    assert.deepEqual(full.rpIdHash, [...Array(32).keys()], 'rpIdHash 应是前 32 字节');
    assert.equal(full.flags, 0x4d, 'flags 应是第 33 字节');
    assert.equal(full.signCount, 7, 'signCount 应是第 34-37 字节大端');
    assert.deepEqual(full.at.aaguid, [...AAGUID], 'aaguid 应在 offset 37 起的 16 字节');
    assert.deepEqual(full.at.credentialId, [...CRED_ID], 'credId 长度由 offset 53 起的 2 字节决定');
    assert.ok(full.at.cose.length > 0, 'COSE 应被再解一次 CBOR 并留下条目');
    assert.equal(call(newM, build(0x05, 0, false)).at, null, '没有 AT 标志时应为 null');
    assert.equal(call(newM, new Uint8Array(10)).throw, 'authData 太短', '短缓冲要报同样的错');
    assert.equal(call(newM, new Uint8Array(36)).throw, 'authData 太短', '36 字节也要报同样的错');
  } finally {
    cleanup();
  }
});

// ===========================================================================
// 11. verifyEs256 真签名
// ===========================================================================

test('webauthn：verifyEs256 对真签名返回 true、篡改后返回 false（两版一致）', async () => {
  const { privKey, jwk } = await newP256();
  const clientDataJSON = utf8(JSON.stringify({
    type: 'webauthn.get', challenge: 'chal', origin: 'https://local.test',
  }));
  const authData = await buildAuthData({
    rpId: RP_ID, flags: 0x05, signCount: 9, aaguid: AAGUID, credId: CRED_ID,
    cose: coseKeyFromJwk(jwk),
  });
  const signature = await signAssertion(privKey, authData, clientDataJSON);

  // 防假绿的前置检查：造出来的签名必须先被 node 自己验过，
  // 否则「两版都返回 false」会被我误当成一致通过。
  const rawToRsv = (der) => {
    let p = 2, r, s;
    if (der[p++] !== 0x02) throw new Error('bad der');
    let n = der[p++]; r = der.slice(p, p + n); p += n;
    if (der[p++] !== 0x02) throw new Error('bad der');
    n = der[p++]; s = der.slice(p, p + n);
    const fix = (b) => (b.length === 33 && b[0] === 0 ? b.slice(1) : b);
    return new Uint8Array([...fix(r), ...fix(s)]);
  };
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signed = concat([authData, clientDataHash]);
  const selfOk = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
    rawToRsv(signature),
    signed
  );
  assert.equal(selfOk, true, '自造的 DER 签名必须先被 node 的 Web Crypto 认可，否则整个用例无意义');

  const { a, b } = await bothVersions(`${SHARED_DIR}/webauthn.js`, async (mod, f) => {
    const tamperedAuthData = Uint8Array.from(authData);
    tamperedAuthData[40] ^= 0x01; // 改 authData 里的一字节 → 签名不再对得上
    const tamperedClientData = utf8(JSON.stringify({
      type: 'webauthn.get', challenge: 'chal-改', origin: 'https://local.test',
    }));
    const tamperedSig = Uint8Array.from(signature);
    tamperedSig[10] ^= 0xff; // 改签名本身

    // pk 传 { id: 1 }：一旦 JWK 需要「修复」，模块会尝试 UPDATE passkeys，
    // 顺带验证那条修复路径不会误触发。
    const call = async (...args) => {
      try { return { v: await mod.verifyEs256(f.env, { id: 1 }, ...args) }; }
      catch (e) { return { throw: e.message }; }
    };
    const r = {
      valid: await call(jwk, signature, authData, clientDataJSON),
      tamperedAuth: await call(jwk, signature, tamperedAuthData, clientDataJSON),
      tamperedClient: await call(jwk, signature, authData, tamperedClientData),
      tamperedSig: await call(jwk, tamperedSig, authData, clientDataJSON),
      noPk: await call(jwk, signature, authData, clientDataJSON),
    };
    return { r, sql: f.trace };
  });

  assert.deepEqual(b.sql, a.sql, 'SQL 序列不一致（JWK 合法时不应有任何写库动作）');
  assert.deepEqual(b.r, a.r, 'verifyEs256 行为不一致');
  assert.equal(a.sql.length, 0, 'JWK 本来就合法，不该触发任何 SQL');

  // 防假绿：合法 → true，三种篡改 → false。恒 true 或恒 false 都会被下面这几条抓住
  assert.equal(a.r.valid.v, true, '真签名必须验签通过');
  assert.equal(a.r.tamperedAuth.v, false, '篡改 authData 必须验签失败');
  assert.equal(a.r.tamperedClient.v, false, '篡改 clientDataJSON 必须验签失败');
  assert.equal(a.r.tamperedSig.v, false, '篡改签名本身必须验签失败');
  assert.equal(a.r.noPk.v, true, '不传 pk 时也应正常验签通过');
  assert.equal(a.r.valid.v !== false, true);
});

// ===========================================================================
// 12. passkeyRegisterStart / passkeyLoginStart
// ===========================================================================

test('webauthn：passkeyRegisterStart / passkeyLoginStart 的下发参数与落库两版一致', async () => {
  const { a, b } = await bothVersions(`${SHARED_DIR}/webauthn.js`, async (mod, f) => {
    // 玩家 1 名下挂一把 passkey（供 loginStart 填 allowCredentials）
    await f.DB.prepare(
      "INSERT INTO passkeys(player_id,admin_id,name,credential_id,public_key_jwk,transports,sign_count,aaguid) VALUES(1,NULL,'我的通行密钥','cred-1','{\"kty\":\"EC\"}','[\"internal\"]',5,'aaguid-1')"
    ).run();
    await f.DB.prepare(
      "INSERT INTO passkeys(player_id,admin_id,name,credential_id,public_key_jwk,transports,sign_count,aaguid) VALUES(2,NULL,'别人的','cred-2','{\"kty\":\"EC\"}','[]',0,NULL)"
    ).run();

    f.trace.length = 0;
    const reg = await mod.passkeyRegisterStart(f.env, { kind: 'player', id: 1, username: 'citizen' }, RP_ID);
    const regRow = await f.DB.prepare(
      "SELECT purpose,player_id,expires_at FROM webauthn_challenges WHERE token=?"
    ).bind(reg.challenge_token).first();

    const regSql = f.trace.splice(0);
    const login = await mod.passkeyLoginStart(f.env, 'citizen', RP_ID);
    const loginSql = f.trace.splice(0);
    const unknown = await mod.passkeyLoginStart(f.env, 'nobody', RP_ID);
    const unknownSql = f.trace.splice(0);
    const noName = await mod.passkeyLoginStart(f.env, '', RP_ID);
    const noNameSql = f.trace.splice(0);
    const adminLogin = await mod.passkeyLoginStart(f.env, 'super', RP_ID);
    const adminSql = f.trace.splice(0);

    const loginRow = await f.DB.prepare(
      "SELECT purpose,player_id FROM webauthn_challenges WHERE token=?"
    ).bind(login.challenge_token).first();
    const allRows = (await f.DB.prepare(
      'SELECT purpose,player_id FROM webauthn_challenges ORDER BY id'
    ).all()).results;

    // challenge / token / expires_at 是随机和时间相关的，比对时抹掉
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (
      k === 'challenge' || k === 'challenge_token' || k === 'expires_at' ? '<volatile>' : v
    )));
    return {
      reg: strip(reg), regRow: { purpose: regRow.purpose, player_id: regRow.player_id },
      regChallengeShape: /^[A-Za-z0-9_-]{43}$/.test(reg.publicKey.challenge),
      regTokenShape: /^[0-9a-f]{48}$/.test(reg.challenge_token),
      login: strip(login), loginRow,
      unknown: strip(unknown), noName: strip(noName), adminLogin: strip(adminLogin),
      allRows, regSql, loginSql, unknownSql, noNameSql, adminSql,
    };
  });

  assert.deepEqual(b, a, 'passkey 起始阶段两版行为不一致');

  // --- 注册起始 ---
  assert.equal(a.regChallengeShape, true, 'challenge 应是 32 字节的 base64url（43 字符，无补位）');
  assert.equal(a.regTokenShape, true, 'challenge_token 应是 24 字节 hex');
  assert.equal(a.reg.publicKey.rp.id, RP_ID);
  assert.equal(a.reg.publicKey.rp.name, '灯光市');
  assert.equal(a.reg.publicKey.user.name, 'citizen');
  assert.equal(a.reg.publicKey.user.displayName, 'citizen');
  assert.deepEqual(a.reg.publicKey.pubKeyCredParams, [{ type: 'public-key', alg: -7 }], '必须只支持 ES256(alg=-7)');
  assert.equal(a.reg.publicKey.attestation, 'none');
  assert.equal(a.reg.publicKey.authenticatorSelection.userVerification, 'required');
  assert.equal(a.reg.publicKey.timeout, 60000);
  assert.equal(a.regRow.purpose, 'register', 'challenge 行必须是 register 用途');
  assert.equal(a.regRow.player_id, 'player:1', 'challenge 行要带上主体键');
  assert.match(a.regSql[0], /INSERT OR REPLACE INTO webauthn_challenges/);
  assert.equal(a.regSql.length, 1, '注册起始应只发一条 SQL');

  // --- 登录起始：已知玩家 ---
  assert.equal(a.login.publicKey.rpId, RP_ID, '登录起始的 rpId 必须是裸字符串');
  assert.equal(a.login.publicKey.userVerification, 'required');
  assert.equal(a.login.publicKey.timeout, 60000);
  assert.equal(a.login.publicKey.allowCredentials.length, 1, '玩家 1 名下应只列出 1 把 passkey');
  assert.equal(a.login.publicKey.allowCredentials[0].id, 'cred-1', '不该列出玩家 2 的 passkey');
  assert.equal(a.login.publicKey.allowCredentials[0].type, 'public-key');
  assert.deepEqual(a.login.publicKey.allowCredentials[0].transports, ['internal'], 'transports 必须被 JSON.parse 回来');
  assert.deepEqual(a.login.hint, { kind: 'player', id: 1, username: 'citizen' });
  assert.equal(a.loginRow.purpose, 'login');
  assert.equal(a.loginRow.player_id, 'player:1');

  // --- 未知用户名：usernameless，必须省略 allowCredentials 而不是给空数组 ---
  assert.equal(a.unknown.hint, null, '查不到人时 hint 应为 null');
  assert.ok(!('allowCredentials' in a.unknown.publicKey), '查不到人时应省略 allowCredentials 字段（不能传空数组）');
  assert.equal(a.unknownSql.filter((s) => s.startsWith('SELECT credential_id')).length, 0, '查不到人不该查 passkeys');
  assert.equal(a.unknownSql.length, 3, '查不到人：查 players + 查 admins + 插 challenge = 3 条');

  // --- 空用户名 ---
  assert.equal(a.noName.hint, null);
  assert.ok(!('allowCredentials' in a.noName.publicKey));
  assert.equal(a.noNameSql.length, 1, '空用户名应跳过两次查询，只插 challenge');

  // --- 管理员登录 ---
  assert.deepEqual(a.adminLogin.hint, { kind: 'admin', id: 1, username: 'super' });

  // --- 全部 challenge 都真的落库了 ---
  assert.equal(a.allRows.length, 5, '5 次起始应留下 5 条 challenge');
  assert.deepEqual(
    a.allRows.map((r) => r.purpose),
    ['register', 'login', 'login', 'login', 'login']
  );
  assert.deepEqual(
    a.allRows.map((r) => r.player_id),
    ['player:1', 'player:1', null, null, 'admin:1'],
    '查不到人与空用户名的 login challenge 不该挂主体，管理员的应挂 admin:1'
  );
});

// ===========================================================================
// 13. listPasskeys / deletePasskey
// ===========================================================================

test('webauthn：listPasskeys / deletePasskey 的归属校验两版一致', async () => {
  const { a, b } = await bothVersions(`${SHARED_DIR}/webauthn.js`, async (mod, f) => {
    const ins = (player_id, admin_id, name, cid) =>
      f.DB.prepare(
        'INSERT INTO passkeys(player_id,admin_id,name,credential_id,public_key_jwk,transports,sign_count,aaguid) VALUES(?,?,?,?,\'{}\',\'[]\',0,?)'
      ).bind(player_id, admin_id, name, cid, name).run();
    await ins(1, null, '玩家一甲', 'c-1');
    await ins(1, null, '玩家一乙', 'c-2');
    await ins(null, 1, '管理员甲', 'c-3');
    await ins(2, null, '玩家二甲', 'c-4');

    // 只取稳定列：created_at / last_used_at 是秒级时间戳，跨秒会 flaky
    const list = async (arg) => {
      const r = await mod.listPasskeys(f.env, arg);
      return r.results.map((x) => ({ id: x.id, credential_id: x.credential_id, name: x.name, aaguid: x.aaguid }));
    };
    f.trace.length = 0;
    const lists = {
      playerObj: await list({ kind: 'player', id: 1 }),
      playerLegacy: await list(1),
      adminObj: await list({ kind: 'admin', id: 1 }),
      otherPlayer: await list({ kind: 'player', id: 2 }),
      emptyPlayer: await list({ kind: 'player', id: 999 }),
    };
    const listSql = f.trace.splice(0);

    const del = async (...args) => (await mod.deletePasskey(f.env, ...args)).meta.changes;
    // 1) 越权删除：拿玩家 1 的身份去删管理员的 passkey
    const crossOwner = await del({ kind: 'player', id: 1 }, 3);
    // 2) 越权删除：拿管理员身份去删玩家的
    const crossOwner2 = await del({ kind: 'admin', id: 1 }, 1);
    // 3) 合法删除（新版 subject 形式）
    const own = await del({ kind: 'player', id: 1 }, 1);
    // 4) 合法删除（旧版裸 playerId 形式）
    const ownLegacy = await del(1, 2);
    // 5) 重复删除同一条
    const again = await del({ kind: 'player', id: 1 }, 1);
    // 6) 不存在的 id
    const missing = await del({ kind: 'player', id: 1 }, 999);

    const remaining = (await f.DB.prepare(
      'SELECT id,player_id,admin_id,name FROM passkeys ORDER BY id'
    ).all()).results;
    return { lists, listSql, delSql: f.trace, crossOwner, crossOwner2, own, ownLegacy, again, missing, remaining };
  });

  assert.deepEqual(b, a, 'listPasskeys / deletePasskey 两版行为不一致');

  // 防假绿：列表真的要按主体过滤
  assert.equal(a.lists.playerObj.length, 2, '玩家 1 名下应有 2 把');
  assert.deepEqual(a.lists.playerObj.map((x) => x.credential_id), ['c-1', 'c-2'], '应按 created_at DESC 排序');
  assert.deepEqual(a.lists.playerLegacy, a.lists.playerObj, '旧版裸 playerId 传法必须等价于 {kind:player,id}');
  assert.deepEqual(a.lists.adminObj.map((x) => x.credential_id), ['c-3'], '管理员视角只看到自己那把');
  assert.deepEqual(a.lists.otherPlayer.map((x) => x.credential_id), ['c-4'], '玩家 2 只看到自己的');
  assert.deepEqual(a.lists.emptyPlayer, [], '没有 passkey 时应返回空数组而不是 null');
  // 5 次 list：player / player(旧传法) / admin / player / player
  assert.equal(a.listSql.length, 5, '每次 listPasskeys 只发一条 SQL');
  assert.match(a.listSql[0], /WHERE player_id = \? ORDER BY created_at DESC/);
  assert.match(a.listSql[1], /WHERE player_id = \?/, '旧版裸 playerId 传法必须走 player_id 过滤');
  assert.match(a.listSql[2], /WHERE admin_id = \? ORDER BY created_at DESC/);
  assert.match(a.listSql[4], /WHERE player_id = \?/);

  // 防假绿：删除必须真的带归属校验
  assert.equal(a.crossOwner, 0, '拿玩家身份删管理员的 passkey 必须删 0 行');
  assert.equal(a.crossOwner2, 0, '拿管理员身份删玩家的 passkey 必须删 0 行');
  assert.equal(a.own, 1, '删自己的必须删掉 1 行');
  assert.equal(a.ownLegacy, 1, '旧版传法也必须删掉 1 行');
  assert.equal(a.again, 0, '重复删除同一条应删 0 行');
  assert.equal(a.missing, 0, '删不存在的 id 应删 0 行');
  assert.deepEqual(
    a.remaining.map((r) => r.credential_id ?? r.id),
    [3, 4],
    '越权删除不得影响任何行，合法删除后应只剩 c-3 与 c-4'
  );
});

// ===========================================================================
// 14. 完整注册登录往返
// ===========================================================================

test('webauthn：完整注册→登录往返两版一致，且 challenge 只能用一次', async () => {
  const { privKey, jwk } = await newP256();

  /** 造一份「浏览器」发来的注册响应 */
  const makeRegistration = async (challenge) => {
    const authData = await buildAuthData({
      rpId: RP_ID, flags: 0x45, signCount: 1, aaguid: AAGUID, credId: CRED_ID,
      cose: coseKeyFromJwk(jwk),
    });
    const clientDataJSON = utf8(JSON.stringify({
      type: 'webauthn.create', challenge, origin: 'https://local.test', crossOrigin: false,
    }));
    const attestationObject = cborEncode({ fmt: 'none', attStmt: {}, authData });
    return {
      id: bytesToB64u(CRED_ID),
      response: {
        clientDataJSON: bytesToB64u(clientDataJSON),
        attestationObject: bytesToB64u(attestationObject),
        transports: ['internal', 'hybrid'],
      },
    };
  };

  /** 造一份「浏览器」发来的登录断言 */
  const makeAssertion = async (challenge, signCount, { tamper = false } = {}) => {
    const authData = await buildAuthData({
      rpId: RP_ID, flags: 0x05, signCount, aaguid: AAGUID, credId: CRED_ID,
      cose: coseKeyFromJwk(jwk),
    });
    const clientDataJSON = utf8(JSON.stringify({
      type: 'webauthn.get', challenge, origin: 'https://local.test', crossOrigin: false,
    }));
    const signature = await signAssertion(privKey, authData, clientDataJSON);
    if (tamper) signature[signature.length - 1] ^= 0xff;
    return {
      id: bytesToB64u(CRED_ID),
      response: {
        clientDataJSON: bytesToB64u(clientDataJSON),
        authenticatorData: bytesToB64u(authData),
        signature: bytesToB64u(signature),
        userHandle: bytesToB64u(utf8('player:1')),
      },
    };
  };

  const { a, b } = await bothVersions(`${SHARED_DIR}/webauthn.js`, async (mod, f) => {
    const out = {};

    // ---- 注册 ----
    const regStart = await mod.passkeyRegisterStart(f.env, { kind: 'player', id: 1, username: 'citizen' }, RP_ID);
    const credential = await makeRegistration(regStart.publicKey.challenge);
    const regFinish = await mod.passkeyRegisterFinish(
      f.env, { challenge_token: regStart.challenge_token, credential, name: '我的手机' },
      { kind: 'player', id: 1, username: 'citizen' }, RP_ID, ORIGIN
    );
    out.regFinish = { id: regFinish.id, name: regFinish.name };
    out.passkeyRow = await f.DB.prepare(
      'SELECT player_id,admin_id,credential_id,public_key_jwk,sign_count,transports,name,aaguid FROM passkeys'
    ).first();

    // challenge 一次性消费：同一个 token 再注册一次必须失败
    out.replayRegister = await run(async () =>
      mod.passkeyRegisterFinish(
        f.env, { challenge_token: regStart.challenge_token, credential, name: 'x' },
        { kind: 'player', id: 1, username: 'citizen' }, RP_ID, ORIGIN
      )
    );
    // challenge 与账号不匹配
    const otherStart = await mod.passkeyRegisterStart(f.env, { kind: 'player', id: 2, username: 'citizen2' }, RP_ID);
    out.wrongAccount = await run(async () =>
      mod.passkeyRegisterFinish(
        f.env, { challenge_token: otherStart.challenge_token, credential, name: 'x' },
        { kind: 'player', id: 1, username: 'citizen' }, RP_ID, ORIGIN
      )
    );
    // 签名合法但 challenge 对不上（客户端被诱导用了别的 challenge）
    const mismatched = await makeRegistration('this-is-not-the-right-challenge');
    const goodStart = await mod.passkeyRegisterStart(f.env, { kind: 'player', id: 1, username: 'citizen' }, RP_ID);
    out.badChallenge = await run(async () =>
      mod.passkeyRegisterFinish(
        f.env, { challenge_token: goodStart.challenge_token, credential: mismatched, name: 'x' },
        { kind: 'player', id: 1, username: 'citizen' }, RP_ID, ORIGIN
      )
    );

    // ---- 登录 ----
    const loginStart = await mod.passkeyLoginStart(f.env, 'citizen', RP_ID);
    out.allowCredentials = loginStart.publicKey.allowCredentials;
    const assertion = await makeAssertion(loginStart.publicKey.challenge, 42);
    const loginFinish = await mod.passkeyLoginFinish(
      f.env, { challenge_token: loginStart.challenge_token, credential: assertion }, RP_ID, ORIGIN_LOGIN
    );
    out.loginFinish = {
      kind: loginFinish.kind,
      player: loginFinish.player && { id: loginFinish.player.id, username: loginFinish.player.username },
      admin: loginFinish.admin,
      tokenShape: /^[0-9a-f]{48}$/.test(loginFinish.token),
    };
    out.sessionRow = await f.DB.prepare(
      'SELECT player_id,admin_id FROM sessions WHERE token=?'
    ).bind(loginFinish.token).first();
    // last_used_at 是秒级时间戳（webauthn.js 每次成功登录都写 datetime('now')），
    // 基线跑和现版跑是先后两次，跨一秒就假失败 —— 实测全量并发下 5 次挂 1 次。
    // 只比 sign_count；「有没有被打上」由下面的 lastUsedSet 单独断言，那才是行为。
    out.signCountAfter = (await f.DB.prepare('SELECT sign_count FROM passkeys').first());
    out.lastUsedSet =
      (await f.DB.prepare('SELECT last_used_at FROM passkeys').first()).last_used_at !== null;

    // challenge 一次性消费：登录 challenge 重放必须失败
    const replayAssertion = await makeAssertion(loginStart.publicKey.challenge, 43);
    out.replayLogin = await run(async () =>
      mod.passkeyLoginFinish(
        f.env, { challenge_token: loginStart.challenge_token, credential: replayAssertion }, RP_ID, ORIGIN_LOGIN
      )
    );

    // 篡改签名：challenge 是新发的，但签名对不上
    const tamperStart = await mod.passkeyLoginStart(f.env, 'citizen', RP_ID);
    const badSig = await makeAssertion(tamperStart.publicKey.challenge, 44, { tamper: true });
    out.tampered = await run(async () =>
      mod.passkeyLoginFinish(
        f.env, { challenge_token: tamperStart.challenge_token, credential: badSig }, RP_ID, ORIGIN_LOGIN
      )
    );

    // 未注册的 credential
    const unknownStart = await mod.passkeyLoginStart(f.env, 'citizen', RP_ID);
    out.unknownCred = await run(async () =>
      mod.passkeyLoginFinish(
        f.env,
        { challenge_token: unknownStart.challenge_token, credential: { ...assertion, id: bytesToB64u(utf8('never-registered')) } },
        RP_ID, ORIGIN_LOGIN
      )
    );

    out.passkeyCount = (await f.DB.prepare('SELECT COUNT(*) AS n FROM passkeys').first()).n;
    out.challengeRows = (await f.DB.prepare(
      'SELECT purpose,player_id FROM webauthn_challenges ORDER BY id'
    ).all()).results;
    return out;
  });

  assert.deepEqual(b, a, '完整注册登录往返两版行为不一致');

  // --- 注册段 ---
  assert.equal(a.regFinish.id, bytesToB64u(CRED_ID), '注册应返回 credential id');
  assert.equal(a.regFinish.name, '我的手机');
  assert.equal(a.passkeyRow.player_id, 1, 'passkey 必须挂到玩家 1 上');
  assert.equal(a.passkeyRow.admin_id, null, '玩家注册不该凭空挂管理员');
  assert.equal(a.passkeyRow.credential_id, bytesToB64u(CRED_ID));
  assert.deepEqual(JSON.parse(a.passkeyRow.public_key_jwk), { kty: 'EC', crv: 'P-256', alg: 'ES256', ext: false, x: jwk.x, y: jwk.y },
    '落库的 JWK 必须是从 COSE 里切出来的 x/y');
  assert.equal(a.passkeyRow.sign_count, 1, '注册时的 signCount 要落库');
  assert.deepEqual(JSON.parse(a.passkeyRow.transports), ['internal', 'hybrid']);
  assert.equal(a.passkeyRow.name, '我的手机');
  assert.equal(a.passkeyRow.aaguid, bytesToB64u(AAGUID), 'aaguid 要落库');

  // --- challenge 一次性消费（本用例的核心安全性质）---
  assert.equal(a.replayRegister.error, 'challenge 无效', '注册 challenge 只能消费一次');
  assert.equal(a.replayLogin.error, 'challenge 无效', '登录 challenge 只能消费一次');
  assert.equal(a.passkeyCount, 1, '重放的注册不能再插一条 passkey');
  assert.equal(a.wrongAccount.error, 'challenge 与当前账号不匹配', 'challenge 不能跨账号使用');
  assert.equal(a.badChallenge.error, 'clientData.challenge 不匹配', '签名合法但 challenge 对不上必须拒绝');
  assert.equal(a.tampered.error, '签名验证失败', '篡改签名必须被 ES256 验签挡下');
  assert.equal(a.unknownCred.error, '该通行密钥未注册', '未注册的 credential 必须拒绝');

  // --- 登录段 ---
  assert.equal(a.allowCredentials.length, 1, '注册完就能被列出');
  assert.equal(a.allowCredentials[0].id, bytesToB64u(CRED_ID));
  assert.deepEqual(a.allowCredentials[0].transports, ['internal', 'hybrid']);
  assert.equal(a.loginFinish.kind, 'player');
  assert.deepEqual(a.loginFinish.player, { id: 1, username: 'citizen' });
  assert.equal(a.loginFinish.admin, null, '没绑管理员时 admin 应为 null');
  assert.equal(a.loginFinish.tokenShape, true, '登录必须发出一个真的 session token');
  assert.deepEqual(a.sessionRow, { player_id: 1, admin_id: null }, 'session 必须真的落库');
  assert.equal(a.signCountAfter.sign_count, 42, '登录后 signCount 必须被更新到断言里的值');
  assert.equal(a.lastUsedSet, true, 'last_used_at 必须被打上');
});
