// v45 重写: profile 子页 - 通行密钥管理 (list / register / test / delete)
// 敏感 WebAuthn 字节转换逻辑零修改, 跟 home/auth.js 同步
import { $, escHtml, POST } from '../util.js';

function bufToB64url(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBuf(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function setMsg(text, kind) {
  const el = $('#passkeyMsg');
  if (!el) return;
  el.textContent = text;
  el.className = 'passkey-msg ' + (kind || 'muted');
}

async function loadPasskeys() {
  const list = $('#passkeyList');
  if (!list) return;
  try {
    const d = await POST('/api/init?action=passkey-list', {});
    if (d.error) throw new Error(d.error || '获取失败');
    const ks = d.passkeys || [];
    if (!ks.length) {
      list.innerHTML = '<p class="passkey-empty">还没有通行密钥。点击下方按钮添加。</p>';
      return;
    }
    list.innerHTML = ks.map(k => {
      const lastUsed = k.last_used_at ? '上次使用: ' + k.last_used_at : '尚未使用';
      return `<div class="passkey-item">
        <div class="passkey-item-info">
          <div class="passkey-item-name">🔑 ${escHtml(k.name)}</div>
          <div class="passkey-item-detail">注册于 ${k.created_at} · ${lastUsed}</div>
          <div class="passkey-item-cred">cred_id: ${escHtml((k.credential_id || '').slice(0, 16))}…</div>
        </div>
        <div class="passkey-item-actions">
          <button type="button" data-pkcred="${escHtml(k.credential_id || '')}" class="pk-test-btn">🧪 测试</button>
          <button type="button" data-pkid="${k.id}" class="pk-del-btn">🗑</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.pk-del-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('确认删除此通行密钥？删除后无法再用它登录。')) return;
        try {
          const d2 = await POST('/api/init?action=passkey-delete', { id: parseInt(btn.dataset.pkid, 10) });
          if (d2.error) throw new Error(d2.error || '删除失败');
          setMsg('✓ 已删除', 'success');
          setTimeout(() => setMsg('', 'muted'), 2000);
          loadPasskeys();
        } catch (e) { setMsg('✗ ' + e.message, 'error'); }
      };
    });
    list.querySelectorAll('.pk-test-btn').forEach(btn => {
      btn.onclick = async () => {
        const credId = btn.dataset.pkcred;
        if (!credId) { setMsg('✗ 该密钥无 credential_id', 'error'); return; }
        const orig = btn.textContent;
        btn.disabled = true; btn.textContent = '⏳ 验证中…';
        setMsg('正在验证通行密钥, 请触摸指纹/Face ID...', 'muted');
        try {
          const d1 = await POST('/api/init?action=passkey-test-start', { credential_id: credId });
          if (d1.error) throw new Error(d1.error || '获取挑战失败');
          const opts = d1.publicKey;
          opts.challenge = b64urlToBuf(opts.challenge);
          if (opts.allowCredentials) {
            opts.allowCredentials = opts.allowCredentials.map(c => ({ ...c, id: b64urlToBuf(c.id) }));
          }
          const cred = await navigator.credentials.get({ publicKey: opts });
          if (!cred) throw new Error('未选择凭据');
          const d2 = await POST('/api/init?action=passkey-test-finish', {
            challenge_token: d1.challenge_token,
            credential: {
              id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type,
              response: {
                clientDataJSON: bufToB64url(cred.response.clientDataJSON),
                authenticatorData: bufToB64url(cred.response.authenticatorData),
                signature: bufToB64url(cred.response.signature),
              }
            }
          });
          if (!d2.ok) throw new Error(d2.error || '验证失败');
          setMsg('✓ 通行密钥有效! ' + (d2.message || ''), 'success');
          setTimeout(() => setMsg('', 'muted'), 4000);
          loadPasskeys();
        } catch (e) {
          setMsg('✗ ' + e.message, 'error');
          setTimeout(() => setMsg('', 'muted'), 5000);
        } finally {
          btn.disabled = false; btn.textContent = orig;
        }
      };
    });
  } catch (e) {
    list.innerHTML = '<p class="passkey-msg error">✗ 加载失败: ' + escHtml(e.message) + '</p>';
  }
}

async function registerPasskey() {
  const addBtn = $('#addPasskeyBtn');
  if (!window.PublicKeyCredential) { alert('您的浏览器不支持通行密钥'); return; }
  const name = prompt('给这个通行密钥起个名字（例：iPhone 15、MacBook）：', '我的设备');
  if (!name) return;
  addBtn.disabled = true;
  const orig = addBtn.textContent;
  addBtn.textContent = '⏳ 请触摸指纹/Face ID...';
  setMsg('', 'muted');
  try {
    const d1 = await POST('/api/init?action=passkey-register-start', {});
    if (d1.error) throw new Error(d1.error || '获取 challenge 失败');
    const opts = d1.publicKey;
    opts.challenge = b64urlToBuf(opts.challenge);
    opts.user.id = b64urlToBuf(opts.user.id);
    const cred = await navigator.credentials.create({ publicKey: opts });
    if (!cred) throw new Error('未创建凭据');
    const d2 = await POST('/api/init?action=passkey-register-finish', {
      challenge_token: d1.challenge_token, name,
      credential: {
        id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type,
        response: {
          clientDataJSON: bufToB64url(cred.response.clientDataJSON),
          attestationObject: bufToB64url(cred.response.attestationObject),
          transports: cred.response.getTransports ? cred.response.getTransports() : [],
        },
      },
    });
    if (d2.error) throw new Error(d2.error || '保存失败');
    setMsg('✓ 通行密钥已添加！', 'success');
    setTimeout(() => setMsg('', 'muted'), 3000);
    loadPasskeys();
  } catch (e) {
    setMsg('✗ ' + e.message, 'error');
    setTimeout(() => setMsg('', 'muted'), 5000);
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = orig;
  }
}

export function bindPasskey() {
  const card = $('#passkeyCard');
  if (card) card.style.display = '';
  $('#addPasskeyBtn')?.addEventListener('click', registerPasskey);
  loadPasskeys();
}
