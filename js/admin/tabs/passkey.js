// v44 重写: 通行密钥引导 (登录后弹窗, 邀请添加 Passkey)
import { GET, POST, esc } from '../core.js';

export async function maybeOfferAdminPasskey(adminId) {
  if (!adminId) return;
  if (!window.PublicKeyCredential) return;
  if (!window.isSecureContext) return;
  const dismissKey = 'lc_admin_passkey_offer_dismissed_' + adminId;
  const last = parseInt(localStorage.getItem(dismissKey) || '0', 10);
  if (last && (Date.now() - last) < 7 * 24 * 60 * 60 * 1000) return;
  // 检查该 admin 是否已有 passkey
  try {
    const d = await GET('/api/init?action=passkey-list');
    const keys = d.passkeys || [];
    if (keys.length > 0) {
      // 已有 passkey, 不再提示
      localStorage.removeItem(dismissKey);
      return;
    }
    showPasskeyOffer(adminId, dismissKey);
  } catch (e) {
    // 静默
  }
}

function showPasskeyOffer(adminId, dismissKey) {
  let bd = document.getElementById('passkeyOfferBackdrop');
  if (bd) bd.remove();
  bd = document.createElement('div');
  bd.id = 'passkeyOfferBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  bd.innerHTML = `
    <div style="background:#fff;border:3px solid #000;box-shadow:6px 6px 0 #000;padding:24px;max-width:480px;width:100%">
      <h3 style="margin:0 0 12px">🔑 添加通行密钥 (推荐)</h3>
      <p style="font-size:14px;line-height:1.6;color:#333">
        通行密钥 (Passkey) 用 Touch ID / Face ID / Windows Hello 登录，<b>无需输密码</b>，抗钓鱼。
      </p>
      <p style="font-size:13px;color:#888">下次登录直接指纹, 不再忘记密码。</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button id="pkDismiss" style="background:#888;color:#fff;border:none;padding:9px 16px;cursor:pointer;font-size:13px">7 天内不再提示</button>
        <button id="pkLater" style="background:#aaa;color:#fff;border:none;padding:9px 16px;cursor:pointer;font-size:13px">稍后</button>
        <button id="pkAdd" style="background:#6cf;color:#000;border:none;padding:9px 16px;cursor:pointer;font-weight:bold;font-size:13px">🔑 立即添加</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  bd.querySelector('#pkDismiss').onclick = () => { localStorage.setItem(dismissKey, String(Date.now())); bd.remove(); };
  bd.querySelector('#pkLater').onclick = () => bd.remove();
  bd.querySelector('#pkAdd').onclick = () => addPasskey(adminId, bd);
}

async function addPasskey(adminId, bd) {
  try {
    const r1 = await POST('/api/init?action=passkey-register-start', {});
    const opts = r1.publicKey;
    opts.challenge = b64urlToBuf(opts.challenge);
    opts.user.id = b64urlToBuf(opts.user.id);
    const cred = await navigator.credentials.create({ publicKey: opts });
    if (!cred) throw new Error('未创建凭据');
    await POST('/api/init?action=passkey-register-finish', {
      challenge_token: r1.challenge_token,
      credential: {
        id: cred.id,
        rawId: b64urlToBuf(cred.rawId),
        type: cred.type,
        response: {
          clientDataJSON: b64urlToBuf(cred.response.clientDataJSON),
          attestationObject: b64urlToBuf(cred.response.attestationObject),
        }
      }
    });
    if (window._toast) window._toast('✓ 通行密钥已添加', 'success');
    bd.remove();
  } catch (e) {
    if (window._toast) window._toast('添加失败: ' + e.message, 'error');
  }
}

function b64urlToBuf(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
