// v45 重写: 登录 modal + 密码登录 + WebAuthn 通行密钥登录 + 注册通行密钥引导
// 原 main.js L1305-1854 拆出来, 关键 WebAuthn 逻辑逐字保留 (bug 历史敏感, 别动)
// 关联: openLoginModal 会被 header.js / forms.js / messages.js 等调用
import { $, escHtml, POST, GET } from './util.js?v=v45-fix-401';
import { invalidatePlayerCache, refreshUserState } from './header.js';

const _toast = (msg, type) => window._toast && window._toast(msg, type);

// ============== 登录 Modal 控制 ==============
let loginMode = 'login';

function setLoginMode(m) {
  loginMode = m;
  const t = $('#loginTitle');
  const eRow = $('#loginEmailRow');
  const submit = $('#loginSubmit');
  const mLogin = $('#loginModeLogin');
  const mReg = $('#loginModeRegister');
  const msg = $('#loginMsg');
  if (m === 'login') {
    if (t) t.textContent = '玩家登录';
    if (eRow) eRow.style.display = 'none';
    if (submit) submit.textContent = '登录';
    if (mLogin) mLogin.style.display = 'none';
    if (mReg) mReg.style.display = '';
  } else {
    if (t) t.textContent = '注册玩家账号';
    if (eRow) eRow.style.display = '';
    if (submit) submit.textContent = '注册并登录';
    if (mLogin) mLogin.style.display = '';
    if (mReg) mReg.style.display = 'none';
  }
  if (msg) msg.textContent = '';
}

export function openLoginModal(reason, mode) {
  const mask = $('#loginMask');
  if (!mask) return;
  const msg = $('#loginMsg');
  if (reason && msg) msg.textContent = reason;
  setLoginMode(mode === 'register' ? 'register' : 'login');
  mask.style.display = '';
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#loginUsername')?.focus(), 50);
}

function closeLoginModal() {
  const mask = $('#loginMask');
  if (!mask) return;
  mask.style.display = 'none';
  document.body.style.overflow = '';
}

function bindLoginModal() {
  const mask = $('#loginMask');
  $('#loginClose')?.addEventListener('click', closeLoginModal);
  if (mask) mask.addEventListener('click', e => { if (e.target === mask) closeLoginModal(); });
  $('#loginModeLogin')?.addEventListener('click', e => { e.preventDefault(); setLoginMode('login'); });
  $('#loginModeRegister')?.addEventListener('click', e => { e.preventDefault(); setLoginMode('register'); });
}

// ============== 密码登录 / 注册 ==============
function bindLoginSubmit() {
  const form = $('#loginForm');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const username = $('#loginUsername')?.value.trim();
    const password = $('#loginPassword')?.value;
    if (!username || !password) { $('#loginMsg').textContent = '请填写用户名和密码'; return; }
    const submit = $('#loginSubmit');
    submit.disabled = true;
    submit.textContent = loginMode === 'login' ? '登录中...' : '注册中...';
    const msg = $('#loginMsg');
    msg.textContent = '';
    try {
      let data, res;
      if (loginMode === 'login') {
        res = await fetch('/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password })
        });
      } else {
        const email = $('#loginEmail')?.value.trim();
        if (!email) { msg.textContent = '请填写邮箱'; submit.disabled = false; submit.textContent = '注册并登录'; return; }
        res = await fetch('/api/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, email, password })
        });
      }
      data = await res.json();
      if (res.ok && data.ok) {
        if (data.role && data.role !== 'player') {
          msg.textContent = '这是管理员账号，请去 /admin.html 登录';
          submit.disabled = false;
          submit.textContent = loginMode === 'login' ? '登录' : '注册并登录';
          return;
        }
        if (data.user && data.user.status === 'pending') {
          msg.textContent = '✓ ' + (data.message || '注册申请已提交，等审批');
          msg.style.color = 'var(--c-gold, #d6a300)';
          setTimeout(() => { closeLoginModal(); msg.style.color = ''; form.reset(); }, 1800);
          return;
        }
        msg.textContent = '✓ 成功！';
        msg.style.color = 'var(--c-emerald)';
        setTimeout(async () => {
          closeLoginModal();
          msg.style.color = '';
          await postLogin();
        }, 600);
      } else {
        msg.textContent = '✗ ' + (data.error || '失败');
      }
    } catch (err) {
      msg.textContent = '网络错误：' + err.message;
    } finally {
      submit.disabled = false;
      submit.textContent = loginMode === 'login' ? '登录' : '注册并登录';
    }
  });
}

// 登录成功后的副作用 (refreshUserState + 弹 passkey 引导)
export async function postLogin() {
  invalidatePlayerCache();
  await refreshUserState();
  try {
    const m = await import('./messages.js');
    await m.loadPublicMessages();
  } catch (e) {}
  // passkey offer (失败静默)
  try {
    const d = await GET('/api/login');
    const uid = (d && (d.user_id || (d.user && d.user.id))) || null;
    await maybeOfferPasskey(uid);
  } catch (e) {}
}

// ============== WebAuthn 工具 ==============
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

// ============== 通行密钥 (Passkey) 登录 ==============
function bindPasskeyLogin() {
  const btn = $('#passkeyLoginBtn');
  if (!btn) return;
  if (!window.PublicKeyCredential) {
    btn.disabled = true;
    btn.textContent = '⚠ 当前浏览器不支持通行密钥';
    btn.title = '请用最新版 Chrome / Safari / Edge 桌面端主浏览器';
  } else if (!window.isSecureContext) {
    btn.disabled = true;
    btn.textContent = '⚠ 需要 HTTPS 安全连接';
    btn.title = '请直接在 https://dengguang-city.pages.dev 打开 (非内嵌)';
  }
  btn.addEventListener('click', async () => {
    if (!window.PublicKeyCredential) {
      alert('您的浏览器不支持通行密钥 (WebAuthn)。\n\n请用最新版 Chrome / Safari / Edge 桌面端。');
      return;
    }
    if (!window.isSecureContext) {
      alert('通行密钥需要 HTTPS 安全连接。');
      return;
    }
    const username = $('#loginUsername')?.value.trim() || '';
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '⏳ 准备中...';
    const msg = $('#loginMsg');
    let timeoutId = setTimeout(() => {
      btn.disabled = false;
      btn.textContent = origText;
      if (msg) { msg.textContent = '✗ 操作超时, 请重试'; msg.style.color = 'var(--c-red, #c33)'; }
      setTimeout(() => { if (msg) msg.style.color = ''; }, 4000);
    }, 30000);
    try {
      const r1 = await fetch('/api/init?action=passkey-login-start', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const d1 = await r1.json();
      if (!r1.ok || d1.error) throw new Error(d1.error || 'challenge 失败');
      if (!d1.publicKey) throw new Error('服务器未返回 challenge');
      const opts = d1.publicKey;
      opts.challenge = b64urlToBuf(opts.challenge);
      if (opts.allowCredentials) {
        opts.allowCredentials = opts.allowCredentials.map(c => ({ ...c, id: b64urlToBuf(c.id) }));
      }
      btn.textContent = '⏳ 请触摸指纹/Face ID...';
      let cred;
      try {
        cred = await navigator.credentials.get({ publicKey: opts, mediation: 'optional' });
      } catch (we) {
        if (we.name === 'NotAllowedError') throw new Error('已取消, 请重试');
        throw we;
      }
      if (!cred) throw new Error('未获得凭据 (设备无注册密钥?)');
      btn.textContent = '⏳ 验证中...';
      const r2 = await fetch('/api/init?action=passkey-login-finish', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_token: d1.challenge_token,
          credential: {
            id: cred.id,
            rawId: bufToB64url(cred.rawId),
            type: cred.type,
            response: {
              clientDataJSON: bufToB64url(cred.response.clientDataJSON),
              authenticatorData: bufToB64url(cred.response.authenticatorData),
              signature: bufToB64url(cred.response.signature),
              userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : null,
            },
          },
        }),
      });
      const d2 = await r2.json();
      if (!r2.ok || d2.error) throw new Error(d2.error || '验证失败');
      clearTimeout(timeoutId);
      if (msg) { msg.textContent = '✓ 通行密钥登录成功！'; msg.style.color = 'var(--c-emerald)'; }
      // 强制 reload (Set-Cookie 必须 reload 才生效)
      setTimeout(() => { location.reload(); }, 600);
    } catch (e) {
      clearTimeout(timeoutId);
      const m = e.name === 'NotAllowedError' ? '已取消' :
                e.name === 'SecurityError' ? '环境不安全 (需要 HTTPS)' :
                e.name === 'NetworkError' ? '网络错误' :
                (e.message || String(e));
      if (msg) { msg.textContent = '✗ 通行密钥失败: ' + m; msg.style.color = 'var(--c-red, #c33)'; }
      setTimeout(() => { if (msg) msg.style.color = ''; }, 5000);
    } finally {
      clearTimeout(timeoutId);
      btn.disabled = false;
      btn.textContent = origText;
    }
  });
}

// ============== Passkey 引导 (首次密码登录后) ==============
async function maybeOfferPasskey(userId) {
  if (!userId) return;
  if (!window.PublicKeyCredential) return;
  if (!window.isSecureContext) return;
  const dismissKey = 'lc_passkey_offer_dismissed_' + userId;
  const last = parseInt(localStorage.getItem(dismissKey) || '0', 10);
  if (last && (Date.now() - last) < 7 * 24 * 60 * 60 * 1000) return;
  let list = [];
  try {
    const r = await fetch('/api/init?action=passkey-list', { credentials: 'include' });
    const d = await r.json();
    if (r.ok && d.ok !== false) list = d.passkeys || [];
  } catch (e) { return; }
  if (list.length > 0) return;
  showPasskeyOffer(userId, dismissKey);
}

function showPasskeyOffer(userId, dismissKey) {
  const old = $('#passkeyOfferBackdrop');
  if (old) old.remove();
  const bd = document.createElement('div');
  bd.id = 'passkeyOfferBackdrop';
  bd.className = 'passkey-toast-mask';
  bd.innerHTML = `
    <div class="passkey-toast">
      <div class="passkey-toast-head">
        <span class="passkey-toast-icon">🔑</span>
        <div class="passkey-toast-body">
          <b class="passkey-toast-title">欢迎！要不要顺便注册通行密钥？</b>
          <div class="passkey-toast-sub">下次可指纹 / Face ID 一键登录，不用记密码</div>
        </div>
        <button type="button" id="pkoClose" class="passkey-toast-close">×</button>
      </div>
      <div class="passkey-toast-actions">
        <button type="button" id="pkoAdd" class="passkey-toast-btn-add">✅ 立即添加到通行密钥</button>
        <button type="button" id="pkoLater" class="passkey-toast-btn-later">⏭ 下次再说</button>
      </div>
      <div id="pkoMsg" class="passkey-toast-msg"></div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('#pkoClose').onclick = close;
  bd.querySelector('#pkoLater').onclick = () => {
    try { localStorage.setItem(dismissKey, String(Date.now())); } catch (e) {}
    close();
  };
  bd.querySelector('#pkoAdd').onclick = async () => {
    const addBtn = bd.querySelector('#pkoAdd');
    const msg = bd.querySelector('#pkoMsg');
    addBtn.disabled = true;
    addBtn.textContent = '⏳ 请触摸指纹/Face ID...';
    msg.textContent = '';
    let timeoutId = setTimeout(() => {
      addBtn.disabled = false;
      addBtn.textContent = '✅ 立即添加到通行密钥';
      msg.style.color = '#f99';
      msg.textContent = '✗ 操作超时, 请重试';
    }, 30000);
    try {
      const r1 = await fetch('/api/init?action=passkey-register-start', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const d1 = await r1.json();
      if (!r1.ok || d1.error) throw new Error(d1.error || '获取 challenge 失败');
      const opts = d1.publicKey;
      opts.challenge = b64urlToBuf(opts.challenge);
      opts.user.id = b64urlToBuf(opts.user.id);
      const cred = await navigator.credentials.create({ publicKey: opts });
      if (!cred) throw new Error('未创建凭据');
      const r2 = await fetch('/api/init?action=passkey-register-finish', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_token: d1.challenge_token,
          name: '我的设备',
          credential: {
            id: cred.id,
            rawId: bufToB64url(cred.rawId),
            type: cred.type,
            response: {
              clientDataJSON: bufToB64url(cred.response.clientDataJSON),
              attestationObject: bufToB64url(cred.response.attestationObject),
              transports: cred.response.getTransports ? cred.response.getTransports() : [],
            },
          },
        }),
      });
      const d2 = await r2.json();
      if (!r2.ok || d2.error) throw new Error(d2.error || '保存失败');
      clearTimeout(timeoutId);
      msg.style.color = '#9f9';
      msg.textContent = '✓ 已添加！下次直接用指纹/Face ID 登录。';
      setTimeout(() => close(), 1800);
      try { localStorage.setItem(dismissKey, String(Date.now())); } catch (e) {}
    } catch (e) {
      clearTimeout(timeoutId);
      addBtn.disabled = false;
      addBtn.textContent = '✅ 立即添加到通行密钥';
      msg.style.color = '#f99';
      if (e.name === 'NotAllowedError') {
        msg.textContent = '已取消 (没添加成功, 下次可再来)';
      } else {
        msg.textContent = '✗ ' + (e.message || '失败');
      }
    }
  };
}

export function bindAll() {
  bindLoginModal();
  bindLoginSubmit();
  bindPasskeyLogin();
}
