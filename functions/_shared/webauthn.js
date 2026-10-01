// v45 重写: WebAuthn (Passkey) 完整实现 - 2026-08-17
// 仅支持 ES256 (alg=-7), attestation=none
// 从 _shared.js L309-790 拆出
import { bytesToB64url, b64urlToBytes } from './bytes.js';
import { randomToken } from './auth.js';
import { createSession } from './session.js';

// 最小 CBOR 解码器（支持 WebAuthn 需要的子集：uint / text / bytes / array / map）
function cborDecode(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  function readUint(v, info) {
    if (info < 24) return info;
    if (info === 24) { offset++; return v.getUint8(offset - 1); }
    if (info === 25) { const n = v.getUint16(offset); offset += 2; return n; }
    if (info === 26) { const n = v.getUint32(offset); offset += 4; return n; }
    if (info === 27) { const n = Number(v.getBigUint64(offset)); offset += 8; return n; }
    throw new Error('CBOR: 不支持的 uint 长度 ' + info);
  }
  function readItem() {
    const b = v.getUint8(offset++);
    const major = b >> 5;
    const info = b & 0x1f;
    if (major === 0) return readUint(v, info);
    if (major === 1) {
      const n = readUint(v, info);
      return -1 - n;
    }
    if (major === 2) {
      const len = readUint(v, info);
      const out = new Uint8Array(data.buffer, data.byteOffset + offset, len);
      offset += len;
      return out;
    }
    if (major === 3) {
      const len = readUint(v, info);
      const out = new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset + offset, len));
      offset += len;
      return out;
    }
    if (major === 4) {
      const len = readUint(v, info);
      const arr = [];
      for (let i = 0; i < len; i++) arr.push(readItem());
      return arr;
    }
    if (major === 5) {
      const len = readUint(v, info);
      const obj = {};
      for (let i = 0; i < len; i++) {
        const k = readItem();
        const val = readItem();
        obj[k] = val;
      }
      return obj;
    }
    throw new Error('CBOR: 不支持的 major 类型 ' + major);
  }
  return readItem();
}

// COSE EC2 公钥 (raw bytes) -> JWK
//
// v88.8 修：原来这里是 slice 固定偏移（x = b[10:42]、y = b[45:77]），
// 注释写着「v17.10.3 简化: 不依赖 cborDecode」。那个简化有三个站不住的假定：
//
//   1. 长度固定 77 字节 —— COSE_Key 可以带 kid(2) / key_ops(4) 等可选字段，
//      各家认证器带的东西不一样，于是「首字节不是 0xa5」就把**合法**密钥拒了。
//   2. 字段顺序固定 —— CBOR map 无序，y 排在 x 前面完全合法。实测这一条
//      最狠：旧实现不报错，而是把 alg/crv 的头字节当成了 x 坐标，
//      拼出一个格式合法、能存进库的 JWK —— 这个通行密钥从此永远登不进去。
//   3. kty/alg/crv 一定是 EC2/ES256/P-256 —— 原实现根本不读这三个值，
//      kty=OKP 的密钥照样按 EC2 收下。
//
// 同一个文件里本来就有 cborDecode（断言路径一直在用），所以这里直接复用，
// 不引新依赖、不自己再写一个 CBOR 解析器。
//
// 坐标长度改为严格 32 字节：原来的 pad32 会把 31 字节左补成 32、把 33 字节
// 原样放过，两种都会产出错误的公钥。P-256 坐标必须正好 32 字节，对不上就拒。
const COSE_P256_COORD_BYTES = 32;

function coseToJwk(coseBytes) {
  if (!coseBytes || !coseBytes.length) {
    throw new Error('COSE: 空字节');
  }
  const raw = coseBytes instanceof Uint8Array ? coseBytes : new Uint8Array(coseBytes);

  let map;
  try {
    map = cborDecode(raw);
  } catch (e) {
    // 解码失败一律 fail closed。宁可拒绝登录，也不能拿半个 map 去拼公钥。
    throw new Error('COSE: CBOR 解析失败, ' + (e.message || e));
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error('COSE: 不是 CBOR map');
  }

  // 标签取值必须真的对上，不能假定。错一个就是另一套算法/曲线，
  // 按 P-256 解出来的公钥是彻底错误的公钥。
  if (map['1'] !== 2) throw new Error('COSE: kty 不是 EC2(2), 实际 ' + map['1']);
  if (map['3'] !== -7) throw new Error('COSE: alg 不是 ES256(-7), 实际 ' + map['3']);
  if (map['-1'] !== 1) throw new Error('COSE: crv 不是 P-256(1), 实际 ' + map['-1']);

  // 判字节串**不能**用 instanceof Uint8Array：
  // shared-equiv 那个守门测试是在 node:vm 沙箱里加载本模块的，沙箱里的
  // Uint8Array 与本 realm 的不是同一个原型对象，instanceof 恒为 false ——
  // 结果就是所有通行密钥注册都被误拒。鸭子类型跨 realm 才安全。
  // BYTES_PER_ELEMENT === 1 顺带排除了 DataView（它没有这个属性）。
  const isBytes = (v) => v != null && ArrayBuffer.isView(v) && v.BYTES_PER_ELEMENT === 1;

  const coord = (label, value) => {
    if (!isBytes(value)) throw new Error('COSE: 坐标 ' + label + ' 不是字节串');
    if (value.length !== COSE_P256_COORD_BYTES) {
      throw new Error('COSE: 坐标 ' + label + ' 应为 ' + COSE_P256_COORD_BYTES + ' 字节, 实际 ' + value.length);
    }
    // 复制一份再编码：cborDecode 给的是**视图**（指向整个 COSE_Key 的
    // 底层 buffer），万一编码那一步只看 .buffer 而不看 offset/length，
    // 编出来的就会是整块密钥而不是这 32 字节。少依赖一个隐含约定。
    return new Uint8Array(value);
  };

  return {
    kty: 'EC',
    crv: 'P-256',
    alg: 'ES256',
    ext: false,
    x: bytesToB64url(coord('x', map['-2'])),
    y: bytesToB64url(coord('y', map['-3'])),
  };
}

// 解析 authenticatorData
export function parseAuthData(authData) {
  if (authData.length < 37) throw new Error('authData 太短');
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const signCount = new DataView(authData.buffer, authData.byteOffset, authData.byteLength).getUint32(33);
  let offset = 37;
  let attestedCredentialData = null;
  if (flags & 0x40) {
    const aaguid = authData.slice(offset, offset + 16);
    offset += 16;
    const credIdLen = (authData[offset] << 8) | authData[offset + 1];
    offset += 2;
    const credentialId = authData.slice(offset, offset + credIdLen);
    offset += credIdLen;
    const coseBytes = authData.slice(offset);
    const cosePubKey = cborDecode(coseBytes);
    attestedCredentialData = { aaguid, credentialId, cosePubKey };
  }
  return { rpIdHash, flags, signCount, attestedCredentialData };
}

// DER -> raw r||s (P-256 = 64 bytes)
function derToRawSig(der) {
  if (der[0] !== 0x30) throw new Error('DER: 缺少 SEQUENCE 头');
  let p = 2;
  if (der[p++] !== 0x02) throw new Error('DER: 缺少 INTEGER (r)');
  let rLen = der[p++];
  let r = der.slice(p, p + rLen); p += rLen;
  if (der[p++] !== 0x02) throw new Error('DER: 缺少 INTEGER (s)');
  let sLen = der[p++];
  let s = der.slice(p, p + sLen);
  if (r.length === 33 && r[0] === 0) r = r.slice(1);
  if (s.length === 33 && s[0] === 0) s = s.slice(1);
  // Web Crypto 只吃固定 32 字节的 r/s, DER 里可能是 31(前导 0 被去)也可能更长
  if (r.length < 32) r = new Uint8Array([...new Array(32 - r.length).fill(0), ...r]);
  if (s.length < 32) s = new Uint8Array([...new Array(32 - s.length).fill(0), ...s]);
  const out = new Uint8Array(64);
  out.set(r.slice(-32), 0);
  out.set(s.slice(-32), 32);
  return out;
}

// 验签 ES256
export async function verifyEs256(env, pk, jwk, signature, authData, clientDataJSON) {
  const pad32b64 = (s) => {
    try {
      let bin = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      if (bin.length === 32) return s;
      const out = new Uint8Array(32);
      out.set(bin, 32 - bin.length);
      let bin2 = '';
      for (let i = 0; i < out.length; i++) bin2 += String.fromCharCode(out[i]);
      return btoa(bin2).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (_) { return s; }
  };
  let _pubKey;
  let _fixed = null;
  try {
    _pubKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch (e) {
    if (!/Invalid EC key/i.test(String(e?.message || e))) throw e;
    _fixed = { ...jwk, x: pad32b64(jwk.x), y: pad32b64(jwk.y) };
    try {
      _pubKey = await crypto.subtle.importKey('jwk', _fixed, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    } catch (e2) {
      throw new Error('EC 公钥 x/y 长度异常, 即使补齐仍失败: ' + (e2?.message || e2));
    }
    if (env && pk && pk.id) {
      try {
        await env.DB.prepare('UPDATE passkeys SET public_key_jwk = ? WHERE id = ?')
          .bind(JSON.stringify(_fixed), pk.id).run();
        console.log('passkey: 已修复 jwk (id=' + pk.id + ')');
      } catch (e3) {
        console.warn('passkey: jwk UPDATE 失败 (id=' + pk.id + '): ' + (e3?.message || e3));
      }
    }
  }
  const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(new Uint8Array(clientDataHash), authData.length);
  const rawSig = derToRawSig(signature);
  return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, _pubKey, rawSig, signed);
}

export function verifyClientData(clientDataBytes, expectedChallenge, expectedOrigin) {
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
  if (clientData.type !== expectedOrigin.type) throw new Error('clientData.type 不匹配');
  if (clientData.origin !== expectedOrigin.origin) throw new Error('clientData.origin 不匹配: ' + clientData.origin);
  if (clientData.challenge !== expectedChallenge) throw new Error('clientData.challenge 不匹配');
  return clientData;
}

export async function expectedRpIdHash(rpId) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId));
  return new Uint8Array(buf);
}

// === 高层 API ===

// 注册开始 (v17.5: 支持 player 和 admin)
// subject = { kind: 'player'|'admin', id: number, username: string }
export async function passkeyRegisterStart(env, subject, rpId) {
  const { kind, id, username } = subject;
  if (!kind || !id || !username) throw new Error('subject 必填 (kind/id/username)');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const challengeB64 = bytesToB64url(challenge);
  const token = randomToken(24);
  const expires = new Date(Date.now() + 300_000).toISOString();
  const subjectKey = `${kind}:${id}`;
  await env.DB.prepare(
    "INSERT OR REPLACE INTO webauthn_challenges (token, challenge, purpose, player_id, expires_at) VALUES (?, ?, 'register', ?, ?)"
  ).bind(token, challengeB64, subjectKey, expires).run();
  return {
    challenge_token: token,
    publicKey: {
      challenge: challengeB64,
      rp: { id: rpId, name: '灯光市' },
      user: {
        id: bytesToB64url(new TextEncoder().encode(`${kind}:${id}`)),
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
        authenticatorAttachment: 'platform',
      },
      attestation: 'none',
      timeout: 60000,
    },
  };
}

// 注册完成
export async function passkeyRegisterFinish(env, body, subject, rpId, expectedOrigin) {
  const { challenge_token: challengeToken, credential, name } = body;
  if (!challengeToken || !credential) throw new Error('缺少 challenge_token 或 credential');
  const ch = await env.DB.prepare(
    "SELECT challenge, player_id, expires_at FROM webauthn_challenges WHERE token = ? AND purpose = 'register'"
  ).bind(challengeToken).first();
  if (!ch) throw new Error('challenge 无效');
  if (ch.player_id !== `${subject.kind}:${subject.id}`) throw new Error('challenge 与当前账号不匹配');
  if (new Date(ch.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();
    throw new Error('challenge 已过期');
  }
  const consumed = await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();
  if (!consumed.meta.changes) throw new Error('challenge 已使用');

  const clientDataJSON = b64urlToBytes(credential.response.clientDataJSON);
  const attestationObject = b64urlToBytes(credential.response.attestationObject);
  verifyClientData(clientDataJSON, ch.challenge, expectedOrigin);

  const att = cborDecode(attestationObject);
  if (att.fmt !== 'none') throw new Error('仅支持 attestation=none，实际 ' + att.fmt);
  const parsed = parseAuthData(att.authData);
  if (!parsed.attestedCredentialData) throw new Error('attestedCredentialData 缺失');

  const expected = await expectedRpIdHash(rpId);
  if (bytesToB64url(parsed.rpIdHash) !== bytesToB64url(expected)) throw new Error('rpIdHash 不匹配');
  if (!(parsed.flags & 0x01)) throw new Error('用户在场标志缺失');
  if (!(parsed.flags & 0x04)) throw new Error('请完成设备身份验证');
  if (!(parsed.flags & 0x40)) throw new Error('AT 标志缺失');

  // v17.10.3: coseToJwk 接受 raw bytes, 这里需要从 authData 重新切出 COSE_Key bytes
  // AT 段固定布局: rpIdHash(32) + flags(1) + signCount(4) = 37, 再 + aaguid(16) + credIdLen(2)
  const authData = att.authData;
  let coseOffset = 37 + 16 + 2;
  const credIdLen = (authData[coseOffset - 2] << 8) | authData[coseOffset - 1];
  coseOffset += credIdLen;
  const coseBytes = authData.slice(coseOffset);
  const jwk = coseToJwk(coseBytes);
  const credId = parsed.attestedCredentialData.credentialId;
  const aaguid = parsed.attestedCredentialData.aaguid;
  const credIdB64 = bytesToB64url(credId);

  // v17.5/17.10: 写 passkey — 如果 subject 有关联的对端账号, 一并写入
  let _linkId = null;
  if (subject.kind === 'admin') {
    _linkId = await env.DB.prepare('SELECT linked_player_id FROM admins WHERE id = ?').bind(subject.id).first();
  } else {
    _linkId = await env.DB.prepare('SELECT linked_admin_id FROM players WHERE id = ?').bind(subject.id).first();
  }
  const _otherId = _linkId ? (subject.kind === 'admin' ? _linkId.linked_player_id : _linkId.linked_admin_id) : null;
  await env.DB.prepare(
    "INSERT INTO passkeys (player_id, admin_id, credential_id, public_key_jwk, sign_count, transports, name, aaguid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    subject.kind === 'player' ? subject.id : (_otherId || null),
    subject.kind === 'admin' ? subject.id : (_otherId || null),
    credIdB64,
    JSON.stringify(jwk),
    parsed.signCount,
    JSON.stringify(credential.response.transports || []),
    (name || 'My Passkey').slice(0, 50),
    bytesToB64url(aaguid),
  ).run();

  return { id: credIdB64, name: name || 'My Passkey' };
}

// 登录开始 (v17.5: 同时查 player 和 admin)
export async function passkeyLoginStart(env, username, rpId) {
  let subject = null;
  if (username) {
    const p = await env.DB.prepare(
      "SELECT id, username, status, linked_admin_id, 'player' AS kind FROM players WHERE username = ? OR email = ?"
    ).bind(username, username).first();
    if (p && p.status === 'active') {
      subject = p;
    } else {
      const a = await env.DB.prepare(
        "SELECT id, username, role, linked_player_id, 'admin' AS kind FROM admins WHERE username = ?"
      ).bind(username).first();
      if (a) subject = a;
    }
  }
  let allowCredentials = [];
  if (subject) {
    const _selfId = subject.id;
    const _peerId = subject.kind === 'player' ? subject.linked_admin_id : subject.linked_player_id;
    const _ids = _peerId ? [_selfId, _peerId] : [_selfId];
    const placeholders = _ids.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT credential_id, transports FROM passkeys WHERE player_id IN (${placeholders}) OR admin_id IN (${placeholders})`
    ).bind(..._ids, ..._ids).all();
    allowCredentials = rows.results.map((r) => ({
      id: r.credential_id,
      type: 'public-key',
      transports: JSON.parse(r.transports || '[]'),
    }));
  }
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const challengeB64 = bytesToB64url(challenge);
  const token = randomToken(24);
  const expires = new Date(Date.now() + 300_000).toISOString();
  const subjectKey = subject ? `${subject.kind}:${subject.id}` : null;
  await env.DB.prepare(
    "INSERT OR REPLACE INTO webauthn_challenges (token, challenge, purpose, player_id, expires_at) VALUES (?, ?, 'login', ?, ?)"
  ).bind(token, challengeB64, subjectKey, expires).run();
  // v47.2: usernameless 登录支持 — allowCredentials 为空时省略字段
  // WebAuthn 规范: 传 [] 跟 undefined 在多数浏览器都列所有, 但少数实现会拒绝空数组
  // 安全做法: 省略字段 (undefined = 列出该 RP 下所有可用 passkey)
  const publicKey = {
    challenge: challengeB64,
    rpId,
    userVerification: 'required',
    timeout: 60000,
  };
  if (allowCredentials && allowCredentials.length > 0) {
    publicKey.allowCredentials = allowCredentials;
  }
  return {
    challenge_token: token,
    publicKey,
    hint: subject ? { kind: subject.kind, id: subject.id, username: subject.username } : null,
  };
}

// 登录完成 (v17.5: 支持 player 和 admin)
// v47.5 修: 加 target 参数 ('admin' | 'player' | undefined)
//   target='admin'  → 用该 passkey 登 admin 后台 (即使 passkey 绑在 player 上, 也能登)
//   target='player' → 用该 passkey 登玩家端 (默认)
//   undefined        → 跟 v17.5 行为一致: 有 player 创 player session, 有 admin 创 admin session
// 之前只能二选一, 现在可以根据登录入口分流
export async function passkeyLoginFinish(env, body, rpId, expectedOrigin, target) {
  const { challenge_token: challengeToken, credential } = body;
  if (!challengeToken || !credential) throw new Error('缺少参数');
  const ch = await env.DB.prepare(
    "SELECT challenge, player_id, expires_at FROM webauthn_challenges WHERE token = ? AND purpose = 'login'"
  ).bind(challengeToken).first();
  if (!ch) throw new Error('challenge 无效');
  if (new Date(ch.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();
    throw new Error('challenge 已过期');
  }
  const consumed = await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();
  if (!consumed.meta.changes) throw new Error('challenge 已使用');

  const credId = credential.id;
  const pk = await env.DB.prepare(
    "SELECT * FROM passkeys WHERE credential_id = ?"
  ).bind(credId).first();
  if (!pk) throw new Error('该通行密钥未注册');

  const clientDataJSON = b64urlToBytes(credential.response.clientDataJSON);
  const authData = b64urlToBytes(credential.response.authenticatorData);
  const signature = b64urlToBytes(credential.response.signature);
  verifyClientData(clientDataJSON, ch.challenge, expectedOrigin);

  const parsed = parseAuthData(authData);
  const expected = await expectedRpIdHash(rpId);
  if (bytesToB64url(parsed.rpIdHash) !== bytesToB64url(expected)) throw new Error('rpIdHash 不匹配');
  if (!(parsed.flags & 0x01)) throw new Error('用户在场标志缺失');
  if (!(parsed.flags & 0x04)) throw new Error('请完成设备身份验证');

  const jwk = JSON.parse(pk.public_key_jwk);
  const ok = await verifyEs256(env, pk, jwk, signature, authData, clientDataJSON);
  if (!ok) throw new Error('签名验证失败');

  if (parsed.signCount > 0 && pk.sign_count > 0 && parsed.signCount <= pk.sign_count) {
    console.warn('passkey: signCount 未递增，疑似克隆', credId);
  }

  await env.DB.prepare(
    "UPDATE passkeys SET sign_count = ?, last_used_at = datetime('now') WHERE id = ?"
  ).bind(parsed.signCount, pk.id).run();

  let _admin = null, _player = null;
  if (pk.admin_id) {
    _admin = await env.DB.prepare("SELECT id, username, role FROM admins WHERE id = ?").bind(pk.admin_id).first();
    if (!_admin) throw new Error('管理员不存在');
  }
  if (pk.player_id) {
    _player = await env.DB.prepare("SELECT id, username, status FROM players WHERE id = ?").bind(pk.player_id).first();
    if (!_player) throw new Error('玩家不存在');
    if (_player.status !== 'active') throw new Error('账号已被禁用');
  }
  // 合并账号(v17.9): passkey 只绑一边时, 借 linked_* 反查出对端身份
  if (_player && !_admin) {
    const _link = await env.DB.prepare(
      "SELECT a.id, a.username, a.role FROM players p LEFT JOIN admins a ON a.id = p.linked_admin_id WHERE p.id = ?"
    ).bind(_player.id).first();
    if (_link && _link.id) _admin = _link;
  }
  if (_admin && !_player) {
    const _link = await env.DB.prepare(
      "SELECT p.id, p.username, p.status FROM admins a LEFT JOIN players p ON p.id = a.linked_player_id WHERE a.id = ?"
    ).bind(_admin.id).first();
    if (_link && _link.id && _link.status === 'active') _player = _link;
  }
  // v47.5: target 参数决定创建哪类 session
  // 之前: 有 player 创 player, 有 admin 创 admin (玩家用 passkey 只能登玩家端, 不能登 admin)
  // 现在:
  //   target='admin'  → 创建 admin session (passkey 绑在 player 但有 linked_admin 也 OK)
  //   target='player' → 创建 player session (默认)
  //   target=undefined → 老行为 (优先 player, 退化 admin)
  if (target === 'admin') {
    if (!_admin) throw new Error('该通行密钥未关联管理员账号 (或玩家未绑定管理员)');
    const { token, expires_at } = await createSession(env, null, _admin.id);
    return { admin: _admin, token, expires_at, kind: 'admin' };
  }
  if (target === 'player') {
    if (!_player) throw new Error('该通行密钥未关联玩家账号');
    const { token, expires_at } = await createSession(env, _player.id, null);
    return { player: _player, token, expires_at, kind: 'player', admin: _admin || null };
  }
  // 默认行为 (兼容老调用方)
  if (_player) {
    const { token, expires_at } = await createSession(env, _player.id, null);
    return { player: _player, token, expires_at, kind: 'player', admin: _admin || null };
  }
  if (_admin) {
    const { token, expires_at } = await createSession(env, null, _admin.id);
    return { admin: _admin, token, expires_at, kind: 'admin' };
  }
  throw new Error('该通行密钥未关联任何账号');
}

// listPasskeys / deletePasskey 两种传参: 新版传 {kind, id}, 旧调用方直接传 playerId
function resolveSubject(subjectOrPlayerId) {
  if (typeof subjectOrPlayerId === 'object' && subjectOrPlayerId !== null) {
    return { kind: subjectOrPlayerId.kind, id: subjectOrPlayerId.id };
  }
  return { kind: 'player', id: subjectOrPlayerId };
}

// v17.5: listPasskeys 接受 subject (kind + id) 或旧的 playerId
export async function listPasskeys(env, subjectOrPlayerId) {
  const { kind, id } = resolveSubject(subjectOrPlayerId);
  const where = kind === 'admin' ? 'admin_id = ?' : 'player_id = ?';
  return await env.DB.prepare(
    `SELECT id, credential_id, name, created_at, last_used_at, aaguid FROM passkeys WHERE ${where} ORDER BY created_at DESC`
  ).bind(id).all();
}

export async function deletePasskey(env, subjectOrPlayerId, passkeyId) {
  const { kind, id } = resolveSubject(subjectOrPlayerId);
  const where = kind === 'admin' ? 'id = ? AND admin_id = ?' : 'id = ? AND player_id = ?';
  return await env.DB.prepare(
    `DELETE FROM passkeys WHERE ${where}`
  ).bind(passkeyId, id).run();
}
