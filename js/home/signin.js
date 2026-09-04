// v50: 每日签到 badge (navbar 右上角小图标)
import { GET, POST } from './util.js?v=20260905-v50-0';

export async function loadSigninBadge() {
  try {
    const d = await GET('/api/signin/status');
    renderBadge(d);
  } catch (e) { /* 未登录静默 */ }
}

export function openSigninModal() {
  const m = document.getElementById('signinMask');
  if (m) m.style.display = '';
}

function renderBadge(d) {
  const slot = document.getElementById('navUserSlot');
  if (!slot) return;
  if (!d || !d.player_id) return; // 未登录不显示
  if (d.done) {
    slot.insertAdjacentHTML('beforeend', `<span class="signin-badge signin-badge-done" title="今日已签到">✓</span>`);
  } else {
    const btn = document.createElement('button');
    btn.className = 'signin-badge';
    btn.title = '点击签到';
    btn.textContent = '📅 签到';
    btn.onclick = doSignin;
    slot.appendChild(btn);
  }
}

async function doSignin() {
  try {
    await POST('/api/signin', {});
    if (window._toast) window._toast('签到成功', 'success');
    setTimeout(() => location.reload(), 500);
  } catch (e) {
    if (window._toast) window._toast('失败: ' + e.message, 'error');
  }
}
