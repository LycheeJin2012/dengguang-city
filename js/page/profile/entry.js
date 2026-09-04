// v50: profile 子页 entry
import { $, GET, renderSubpageUserSlot } from '../util.js?v=20260905-v50-0';
import { fetchProfile, renderProfile, setProfile, setSelf } from './info.js?v=20260905-v50-0';
import { bindPasskey } from './passkey.js?v=20260905-v50-0';
import { loadMyMessages, loadMyBookings } from './history.js?v=20260905-v50-0';
import { renderRaceCard } from './race-times.js?v=20260905-v50-0';
import { renderExamCard } from './exam-practice.js?v=20260905-v50-0';
import { renderSubCard } from './subscriptions.js?v=20260905-v50-0';
import { bindCitizenCard } from './citizen-card.js?v=20260905-v50-0';

const pBody = $('#pBody');
const pName = $('#pName');
const pAvatar = $('#pAvatar');

(async function boot() {
  // 1. nav toggle / 登录 modal 关闭
  const navToggle = $('#navToggle');
  const navLinks = $('#navLinks');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.addEventListener('click', e => {
      if (e.target.tagName === 'A' && window.innerWidth <= 768) navLinks.classList.remove('open');
    });
  }
  const loginMask = $('#loginMask');
  if (loginMask) {
    $('#loginClose')?.addEventListener('click', () => { loginMask.style.display = 'none'; document.body.style.overflow = ''; });
    loginMask.addEventListener('click', e => { if (e.target === loginMask) { loginMask.style.display = 'none'; document.body.style.overflow = ''; } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && loginMask.style.display !== 'none') { loginMask.style.display = 'none'; document.body.style.overflow = ''; } });
  }

  // 2. 当前登录态
  let me = null;
  let isCombined = false;
  try {
    const d = await GET('/api/login');
    if (d && d.ok && d.player) { me = d.player; isCombined = !!d.combined; }
  } catch (e) { console.warn('[profile] 查询登录态失败', e); }

  // 3. 顶栏
  await renderSubpageUserSlot();

  // 4. 决定查看谁
  const url = new URL(location.href);
  let viewUsername = url.searchParams.get('u');
  let isSelf = false;

  if (!viewUsername) {
    if (me) { viewUsername = me.username; isSelf = true; }
    else {
      if (pBody) pBody.innerHTML = `<p class="empty-state">请先登录后查看个人主页</p>`;
      return;
    }
  }

  setSelf(isSelf);
  const profile = await fetchProfile(viewUsername);
  if (!profile) {
    if (pBody) pBody.innerHTML = `<p class="empty-state">找不到玩家「${viewUsername}」</p>`;
    return;
  }
  setProfile(profile);
  renderProfile();
  if (pName) pName.textContent = profile.username || viewUsername;
  if (pAvatar) pAvatar.textContent = profile.avatar_emoji || '👤';

  // 5. 业务 (只在本人时显示)
  if (isSelf) {
    await loadMyMessages($('#myMessagesCard'), $('#myMessagesContent'));
    await loadMyBookings($('#myBookingsCard'), $('#myBookingsContent'));
    bindPasskey($('#passkeyCard'));
    await renderRaceCard($('#raceCard'), me);
    await renderExamCard($('#examCard'), me);
    await renderSubCard($('#subCard'), me);
    bindCitizenCard($('#citizenCard'), profile);
  }
})();
