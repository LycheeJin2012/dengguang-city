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
// v17.10.3 简化: 不依赖 cborDecode, 直接 slice 固定偏移拿 x/y 坐标
// WebAuthn COSE_Key EC2 布局 (固定 77 字节):
//   offset 0:    a5 (CBOR map of 5 items)
//   offset 1-9:  kty(1)+val(2)+alg(3)+val(26 20)+crv(-1=20)+val(1)+x(-2=21)+header(58 20)
//   offset 10-41: x 坐标 (32 字节, 大端)
//   offset 42-44: y header (22 58 20)
//   offset 45-76: y 坐标 (32 字节, 大端)
function coseToJwk(coseBytes) {
  if (!coseBytes || coseBytes.length < 77) {
    throw new Error('COSE: 太短或空, len=' + (coseBytes ? coseBytes.length : 0));
  }
  const b = coseBytes instanceof Uint8Array ? coseBytes : new Uint8Array(coseBytes);
  if (b[0] !== 0xa5) {
    throw new Error('COSE: 首字节不是 map(0xa5), 实际 0x' + b[0].toString(16));
  }
  const x = b.slice(10, 42);
  const y = b.slice(45, 77);
  const pad32 = (b) => {
    if (b.length === 32) return b;
    if (b.length < 32) {
      const out = new Uint8Array(32);
      out.set(b, 32 - b.length);
      return out;
    }
    return b;
  };
  return { kty: 'EC', crv: 'P-256', alg: 'ES256', ext: false,
           x: bytesToB64url(pad32(x)), y: bytesToB64url(pad32(y)) };
}

// 解析 authenticatorData
export function parseAuthData(authData) {
  if (authData.length < 37) throw new Error('authData 太短');
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const signCount = (authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36];
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
        userVerification: 'preferred',
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
    "SELECT challenge, expires_at FROM webauthn_challenges WHERE token = ? AND purpose = 'register'"
  ).bind(challengeToken).first();
  if (!ch) throw new Error('challenge 无效');
  if (new Date(ch.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();
    throw new Error('challenge 已过期');
  }
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();

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
  if (!(parsed.flags & 0x40)) throw new Error('AT 标志缺失');

  // v17.10.3: coseToJwk 接受 raw bytes, 这里需要从 authData 重新切出 COSE_Key bytes
  const authData = att.authData;
  let _off = 37 + 16 + 2;
  const _credIdLen = (authData[_off - 2] << 8) | authData[_off - 1];
  _off += _credIdLen;
  const coseBytes = authData.slice(_off);
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
    userVerification: 'preferred',
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
export async function passkeyLoginFinish(env, body, rpId, expectedOrigin) {
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
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?').bind(challengeToken).run();

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
  if (_player && !_admin) {
    const _link = await env.DB.prepare("SELECT a.id, a.username, a.role FROM players p LEFT JOIN admins a ON a.id = p.linked_admin_id WHERE p.id = ?").bind(_player.id).first();
    if (_link && _link.id) _admin = _link;
  }
  if (_admin && !_player) {
    const _link = await env.DB.prepare("SELECT p.id, p.username, p.status FROM admins a LEFT JOIN players p ON p.id = a.linked_player_id WHERE a.id = ?").bind(_admin.id).first();
    if (_link && _link.id && _link.status === 'active') _player = _link;
  }
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

// v17.5: listPasskeys 接受 subject (kind + id) 或旧的 playerId
export async function listPasskeys(env, subjectOrPlayerId) {
  let kind, id;
  if (typeof subjectOrPlayerId === 'object' && subjectOrPlayerId !== null) {
    kind = subjectOrPlayerId.kind; id = subjectOrPlayerId.id;
  } else {
    kind = 'player'; id = subjectOrPlayerId;
  }
  const where = kind === 'admin' ? 'admin_id = ?' : 'player_id = ?';
  return await env.DB.prepare(
    `SELECT id, credential_id, name, created_at, last_used_at, aaguid FROM passkeys WHERE ${where} ORDER BY created_at DESC`
  ).bind(id).all();
}

export async function deletePasskey(env, subjectOrPlayerId, passkeyId) {
  let kind, id;
  if (typeof subjectOrPlayerId === 'object' && subjectOrPlayerId !== null) {
    kind = subjectOrPlayerId.kind; id = subjectOrPlayerId.id;
  } else {
    kind = 'player'; id = subjectOrPlayerId;
  }
  const where = kind === 'admin' ? 'id = ? AND admin_id = ?' : 'id = ? AND player_id = ?';
  return await env.DB.prepare(
    `DELETE FROM passkeys WHERE ${where}`
  ).bind(passkeyId, id).run();
}
