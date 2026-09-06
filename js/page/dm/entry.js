// v45 重写: dm 子页 entry (ES module)
// v50-N5: 改用 t() 翻译界面文案
import { $, escHtml, GET, renderSubpageNav } from '../util.js?v=v46-fix-modules';
import { loadList, setListContext, bindListActions } from './list.js?v=v46-fix-modules';
import { openThread, setThreadContext } from './thread.js?v=v46-fix-modules';
import { t, setPageTitle, setMetaDescription } from '../../i18n/core.js?v=n5';

const app = $('#app');

// v50-N6: SEO meta
setPageTitle('page.title.dm', 'DM | Light City');
setMetaDescription('page.meta.dm', 'Light City DM - AI assistant DengDeng & player direct messages.');

(async function boot() {
  // 1. 立刻渲染 loading
  app.innerHTML = `<div class="dm-login-hint dm-loading"><div class="big-icon">⏳</div><p>${t('dm.verifyLogin')}</p></div>`;

  // 2. 检查登录态 (8s 超时, 避免 CF Pages cold start 卡死)
  let me = null;
  let errMsg = '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('/api/login', { credentials: 'include', signal: ctrl.signal });
    clearTimeout(timer);
    const d = await r.json();
    if (r.ok && d.ok && d.player && d.player.status === 'active') me = d.player;
    else if (!r.ok) errMsg = 'session ' + r.status;
    else if (d.ok && !d.player) errMsg = '当前是管理员账号, 没有关联玩家身份';
  } catch (e) { errMsg = '网络超时/失败: ' + (e?.message || e); }

  // 3. 顶栏
  renderSubpageNav($('#navUserSlot'), me, false);

  // 4. 未登录 → 提示
  if (!me) {
    const isNet = errMsg.startsWith('网络');
    app.innerHTML = `
      <div class="dm-login-hint">
        <div class="big-icon">📨</div>
        <h2>${isNet ? t('dm.slow') : t('dm.needLogin')}</h2>
        <p>${isNet
          ? t('dm.timeout.body', '验证登录态超时, 可能是网络抖动或 Functions 冷启动。<br>点下面按钮重试, 或回首页重新登录。')
          : t('dm.needLogin.body', '私信是玩家之间的私人交流，<br>需要登录后才能使用。')}</p>
        ${errMsg ? `<p class="dm-err-detail">(${escHtml(errMsg)})</p>` : ''}
        <div class="dm-action-row">
          <button id="dmRetryBtn" class="btn btn-primary">🔄 ${t('common.retry', '重试')}</button>
          <a href="index.html" class="btn btn-ghost">${t('common.returnHome', '← 返回首页')}</a>
        </div>
      </div>`;
    $('#dmRetryBtn')?.addEventListener('click', () => location.reload());
    return;
  }

  // 5. 已登录 - 渲染主界面
  app.innerHTML = `
    <div class="dm-wrap">
      <div class="dm-panel dm-list-panel">
        <div class="dm-head">
          <span>📨 私信收件箱</span>
          <button class="dm-new-btn" id="dmNewBtn">${t('dm.newBtn')}</button>
        </div>
        <div class="dm-list" id="dmList"><div class="dm-empty">${t('dm.loading')}</div></div>
        <div class="dm-aibot-bar">
          <button id="dmAiBotBtn" class="dm-aibot-btn">🤖 找 AI 客服灯灯聊聊</button>
          <div class="dm-aibot-hint">24h 自动回复 · 100 字内</div>
        </div>
      </div>
      <div class="dm-panel dm-thread">
        <div id="dmThreadArea">
          <div class="dm-empty dm-loading">${t('dm.empty.thread')}</div>
        </div>
      </div>
    </div>`;

  // 6. 业务
  setListContext(me, openThread);
  setThreadContext(me);
  bindListActions();
  await loadList();

  // 7. URL ?peer=X 自动打开
  const peerQ = new URL(location.href).searchParams.get('peer');
  if (peerQ) await openThread(peerQ);
})();
