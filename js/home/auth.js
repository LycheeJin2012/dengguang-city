// v50: 登录 / 注册 / passkey (modal 控制)
import { $, esc, POST, GET } from './util.js?v=20260905-v50-0';
import { invalidatePlayerCache, refreshUserState } from './auth-helpers.js?v=20260905-v50-0';

let _loginMode = 'login';

export function bindAll() {
  const form = $('#loginForm');
  if (!form) return;
  form.addEventListener('submit', onSubmit);
  $('#loginModeLogin')?.addEventListener('click', () => setMode('login'));
  $('#loginModeRegister')?.addEventListener('click', () => setMode('register'));
  $('#loginPasskey')?.addEventListener('click', onPasskey);
  setMode('login');
}

function setMode(m) {
  _loginMode = m;
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
  setMode(mode === 'register' ? 'register' : 'login');
  mask.style.display = '';
  mask.classList.remove('v49-pop');
  void mask.offsetWidth;
  mask.classList.add('v49-pop');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#loginUsername')?.focus(), 50);
}

function closeLoginModal() {
  const mask = $('#loginMask');
  if (mask) mask.style.display = 'none';
  document.body.style.overflow = '';
}

async function onSubmit(e) {
  e.preventDefault();
  const submit = $('#loginSubmit');
  const username = $('#loginUsername').value.trim();
  const password = $('#loginPassword').value;
  const email = $('#loginEmail')?.value.trim();
  if (!username || !password) {
    if (window._toast) window._toast('请填写账号和密码', 'error');
    return;
  }
  submit.disabled = true;
  try {
    if (_loginMode === 'register') {
      await POST('/api/register', { username, password, email });
    } else {
      await POST('/api/login', { username, password });
    }
    if (window._toast) window._toast('登录成功', 'success');
    invalidatePlayerCache();
    await refreshUserState();
    closeLoginModal();
  } catch (err) {
    if (window._toast) window._toast('失败: ' + err.message, 'error');
  } finally {
    submit.disabled = false;
  }
}

async function onPasskey() {
  if (window._toast) window._toast('通行密钥登录: 请在 Passkey 弹窗中确认', 'info');
  try {
    const challengeR = await GET('/api/passkey/challenge');
    if (!challengeR.challenge) {
      if (window._toast) window._toast('尚未注册通行密钥，请先在主页用 Touch ID 注册', 'error');
      return;
    }
    // v50 stub: 实际接 webauthn
    if (window._toast) window._toast('Passkey 登录功能开发中, 请用账号密码', 'info');
  } catch (e) {
    if (window._toast) window._toast('失败: ' + e.message, 'error');
  }
}
