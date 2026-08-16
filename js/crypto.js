/* ============================================
   灯光市 v4 · 客户端加密层
   - 密码：bcrypt + HMAC-SHA256(pepper) 双层哈希
   - 留言：AES-GCM 加密后存 localStorage
   - 关键常量 base64 编码 + 短变量名（轻度混淆）
   ============================================ */
(function () {
  'use strict';

  // === 关键常量：base64 编码后内嵌（避免明文 grep） ===
  const _K1 = 'YCLc/oVQCTSZIx+1SJxDOZflu1vkduoizh8vG/SnC9U=';  // pwd pepper
  const _K2 = 'W0EmssVx5haLycJFP0CHgLOHneavr2lPtPk84LeWVfU=';  // msg AES key
  const _V  = 'lc-v4-2026';

  // === Web Crypto 基础工具 ===
  const _td = new TextDecoder();
  const _te = new TextEncoder();
  const _b64d = s => { const x = atob(s); const a = new Uint8Array(x.length); for (let i = 0; i < x.length; i++) a[i] = x.charCodeAt(i); return a; };
  const _b64e = a => btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(a))));
  const _hex  = a => Array.from(new Uint8Array(a)).map(b => b.toString(16).padStart(2, '0')).join('');

  async function _hk(raw, alg, ops) { return await crypto.subtle.importKey('raw', raw, alg, false, ops); }

  // === 第二层：HMAC-SHA256(pepper, firstLayerHash) ===
  async function _l2(firstHash) {
    const k = await _hk(_b64d(_K1), { name: 'HMAC', hash: 'SHA-256' }, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', k, _te.encode(firstHash));
    return _hex(sig);
  }

  // === 双层密码哈希 ===
  async function hashPassword(plain) {
    if (typeof bcrypt === 'undefined') throw new Error('bcrypt not loaded');
    const l1 = bcrypt.hashSync(plain, 10);
    const l2 = await _l2(l1);
    return { v: _V, l1, l2 };
  }

  // === 验证密码（双层） ===
  async function verifyPassword(plain, stored) {
    if (typeof bcrypt === 'undefined' || !stored || !stored.l1) return false;
    let ok1 = false;
    try { ok1 = bcrypt.compareSync(plain, stored.l1); } catch (e) { return false; }
    if (!ok1) return false;
    const l2 = await _l2(stored.l1);
    return l2 === stored.l2;
  }

  // === 留言加密：AES-GCM(随机 IV) ===
  async function encryptContent(plain) {
    const k = await _hk(_b64d(_K2), { name: 'AES-GCM' }, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, _te.encode(String(plain || '')));
    return { v: _V, iv: _b64e(iv), ct: _b64e(ct) };
  }

  // === 留言解密 ===
  async function decryptContent(enc) {
    if (!enc || !enc.iv || !enc.ct) return '';
    try {
      const k = await _hk(_b64d(_K2), { name: 'AES-GCM' }, ['decrypt']);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _b64d(enc.iv) }, k, _b64d(enc.ct));
      return _td.decode(pt);
    } catch (e) { return '[解密失败]'; }
  }

  // 暴露到 window（短名 + 命名空间）
  window.LCC = {
    hp: hashPassword,
    vp: verifyPassword,
    en: encryptContent,
    de: decryptContent,
    V:  _V
  };
})();
