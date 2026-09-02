// v45 重写: profile 子页 entry (ES module)
import { $, GET, renderSubpageNav } from '../util.js?v=v46-fix-modules';
import { fetchProfile, renderProfile, setProfile, setSelf } from './info.js?v=v46-fix-modules';
import { bindPasskey } from './passkey.js?v=v46-fix-modules';
import { loadMyMessages, loadMyBookings } from './history.js?v=v46-fix-modules';
import { renderRaceCard } from './race-times.js?v=v46-fix-modules';
import { renderExamCard } from './exam-practice.js?v=v46-fix-modules';
import { renderSubCard } from './subscriptions.js?v=v46-fix-modules';
import { bindCitizenCard } from './citizen-card.js?v=v46-fix-modules';

const app = $('#app');
const pBody = $('#pBody');

(async function boot() {
  // 1. 当前登录态
  let me = null;
  let isCombined = false;
  try {
    const d = await GET('/api/login');
    if (d && d.ok && d.player) {
      me = d.player;
      isCombined = !!d.combined;
    }
  } catch (e) { console.warn('[profile] 查询登录态失败', e); }

  // 2. 顶栏
  renderSubpageNav($('#navUserSlot'), me, isCombined);

  // 3. 决定查看谁
  const url = new URL(location.href);
  let viewUsername = url.searchParams.get('u');
  let isSelf = false;

  if (!viewUsername) {
    if (me) {
      viewUsername = me.username;
      isSelf = true;
    } else {
      pBody.innerHTML = `
        <div class="profile-login-hint">
          <div class="big-icon">👤</div>
          <h2>请先登录查看个人主页</h2>
          <p>登录后自动跳转到你的个人主页</p>
          <a href="index.html" class="btn btn-primary" style="margin-top:12px;">返回首页</a>
        </div>`;
      return;
    }
  } else if (me && me.username === viewUsername) {
    isSelf = true;
  }
  setSelf(isSelf);

  // 4. 拉 profile
  let profile, stats;
  try {
    const r = await fetchProfile(viewUsername);
    profile = r.profile; stats = r.stats;
  } catch (e) {
    pBody.innerHTML = `<div class="profile-login-hint"><h2>${e.message || '载入失败'}</h2><p>该玩家可能不存在或账号未激活</p></div>`;
    return;
  }
  setProfile(profile);

  // 5. 渲染
  renderProfile(me, profile, stats);

  // 6. 自己: 加载最近留言/报名 + 通行密钥 + 4 个新功能 (v47)
  if (isSelf) {
    await Promise.all([
      loadMyMessages(),
      loadMyBookings(),
      renderRaceCard(),
      renderExamCard(),
      renderSubCard(),
    ]);
    bindPasskey();
    bindCitizenCard();
  }
})();
