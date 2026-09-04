// v50: dm 子页 entry
import { $, GET, renderSubpageUserSlot } from '../util.js?v=20260905-v50-0';
import { loadList, setListContext, bindListActions } from './list.js?v=20260905-v50-0';
import { openThread, setThreadContext } from './thread.js?v=20260905-v50-0';

const app = $('#app');

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

  // 2. 立刻渲染 loading
  app.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:48px 16px"><div class="card-icon" style="font-size:48px">⏳</div><p>正在验证登录态…</p></div></div>`;

  // 3. 检查登录态 (8s 超时)
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

  // 4. navbar slot
  await renderSubpageUserSlot();

  // 5. 未登录 → 提示
  if (!me) {
    const isNet = errMsg.startsWith('网络');
    app.innerHTML = `
      <div class="card">
        <div class="card-body" style="text-align:center;padding:48px 16px">
          <div class="card-icon" style="font-size:48px">📨</div>
          <h3 class="card-title">${isNet ? '网络好像有点慢' : '请先登录玩家账号'}</h3>
          <p>${isNet
            ? '验证登录态超时, 可能是网络抖动或 Functions 冷启动。<br>点下面按钮重试, 或回首页重新登录。'
            : '私信是玩家之间的私人交流, <br>需要登录后才能使用。'}</p>
          ${errMsg ? `<p class="dm-err-detail">(${errMsg})</p>` : ''}
          <div class="card-actions center" style="margin-top:20px">
            <button id="dmRetryBtn" class="btn btn-primary">🔄 重试</button>
            <a href="index.html" class="btn btn-ghost">返回首页</a>
          </div>
        </div>
      </div>`;
    $('#dmRetryBtn')?.addEventListener('click', () => location.reload());
    return;
  }

  // 6. 已登录 - 渲染主界面 (复用 v49 dm-* 类名, 由 §24 兼容层兜底)
  app.innerHTML = `
    <div class="dm-wrap">
      <div class="dm-panel dm-list-panel">
        <div class="dm-head">
          <span>📨 私信收件箱</span>
          <button class="dm-new-btn" id="dmNewBtn">+ 写新私信</button>
        </div>
        <div class="dm-list" id="dmList"><div class="dm-empty">载入中…</div></div>
        <div class="dm-aibot-bar">
          <button id="dmAiBotBtn" class="dm-aibot-btn">🤖 找 AI 客服灯灯聊聊</button>
          <div class="dm-aibot-hint">24h 自动回复 · 100 字内</div>
        </div>
      </div>
      <div class="dm-panel dm-thread">
        <div id="dmThreadArea">
          <div class="dm-empty dm-loading">← 选择左侧会话查看<br>或点击右上"写新私信"</div>
        </div>
      </div>
    </div>`;

  // 7. 业务
  setListContext(me, openThread);
  setThreadContext(me);
  bindListActions();
  await loadList();

  // 8. URL ?peer=X 自动打开
  const peerQ = new URL(location.href).searchParams.get('peer');
  if (peerQ) await openThread(peerQ);
})();
