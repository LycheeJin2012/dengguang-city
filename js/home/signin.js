// v45 重写: 每日签到 modal + 签到状态 badge
// 原 main.js L1625-1778 拆出来
import { $, escHtml, GET, POST } from './util.js?v=v46-fix-modules';
const _toast = (msg, type) => window._toast && window._toast(msg, type);

export async function fetchSigninStatus() {
  const d = await GET('/api/init?action=signin-status');
  if (!d.ok) throw new Error(d.error || '签到状态查询失败');
  return d;
}

function emeraldEmoji(n) {
  if (n >= 200) return '💎💎💎';
  if (n >= 60) return '💎💎';
  if (n >= 30) return '💎';
  return '·';
}

function renderRecentDays(d) {
  const days = [];
  const todayDate = new Date(d.today);
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(todayDate.getTime() - i * 86400000);
    const ds = dt.toISOString().slice(0, 10);
    const rec = d.recent.find(r => r.signin_date === ds);
    const isToday = (ds === d.today);
    days.push({ date: ds, signin: !!rec, streak: rec ? rec.streak : 0, today: isToday });
  }
  return days.map(x => {
    const md = x.date.slice(5).replace('-', '/');
    return `<div class="signin-day ${x.signin ? 'signed' : ''} ${x.today ? 'today' : ''}" title="${x.date}">
      <div class="day-date">${md}</div>
      <div class="day-mark">${x.signin ? '💎' : '·'}</div>
    </div>`;
  }).join('');
}

export function updateSigninBadge(d) {
  const badge = $('#signinStreakBadge');
  const numEl = $('#signinStreakNum');
  if (!badge || !numEl) return;
  if (d.signed_today) {
    numEl.innerHTML = '<span class="signin-badge-done">✓ 今日已签</span>';
    badge.style.display = '';
  } else if (d.current_streak > 0) {
    numEl.textContent = d.current_streak;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function showSigninFlash(n) {
  const flash = document.createElement('div');
  flash.className = 'signin-flash';
  flash.innerHTML = `<div class="signin-flash-text">+${n} 💎</div>`;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 1500);
}

export async function openSigninModal() {
  const old = $('#signinModalBackdrop');
  if (old) old.remove();

  let d;
  try {
    d = await fetchSigninStatus();
  } catch (e) {
    const em = e.message || '';
    // v46: 增加英文/简中关键词匹配, 避免未登录时显示误导的"网络错误"
    const isAuth = /登录|会话|未登录|Not logged in|logged in|expired|401/i.test(em);
    const msg = isAuth
      ? '请先在右上角登录市民账号, 再来签到'
      : '网络错误: ' + em;
    _toast(msg, 'error');
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.id = 'signinModalBackdrop';
  backdrop.className = 'signin-mask';
  backdrop.innerHTML = `
    <div class="signin-modal">
      <div class="signin-modal-head">
        <h3>🎁 每日签到</h3>
        <button class="signin-close">×</button>
      </div>
      <div class="signin-stat-row">
        <div class="signin-stat-icon">💎</div>
        <div class="signin-stat-main">
          <div class="signin-stat-label">当前绿宝石</div>
          <div class="signin-stat-value">${d.emeralds}</div>
        </div>
        <div class="signin-stat-side">
          <div class="signin-stat-label">连续 / 总</div>
          <div class="signin-stat-streak">🔥 ${d.current_streak} <span class="signin-stat-streak-sub">/ ${d.total_days} 天</span></div>
        </div>
      </div>
      <div class="signin-week-wrap">
        <div class="signin-week-label">最近 7 天</div>
        <div class="signin-week">${renderRecentDays(d)}</div>
      </div>
      <div class="signin-rules">
        奖励规则: 7 天一个循环<br>
        第 1 天 +1 💎 · 第 2 天 +2 · ... · 第 7 天 +7 💎<br>
        第 8 天重新从 +1 开始 (一周循环往复)
      </div>
      <button class="btn btn-primary btn-block" id="signinBtn" ${d.signed_today ? 'disabled' : ''}>
        ${d.signed_today ? '✓ 今日已签, 明天再来' : '🎁 签到领绿宝石'}
      </button>
      <div id="signinMsg" class="signin-msg"></div>
    </div>`;
  document.body.appendChild(backdrop);

  backdrop.querySelector('.signin-close').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  const btn = $('#signinBtn');
  if (btn && !btn.disabled) {
    btn.onclick = async () => {
      btn.disabled = true;
      const msg = $('#signinMsg');
      msg.className = 'signin-msg signin-msg-loading';
      msg.textContent = '签到中…';
      try {
        const rd = await POST('/api/init?action=signin', {});
        if (!rd.ok) throw new Error(rd.error || '签到失败');
        msg.className = 'signin-msg signin-msg-ok';
        msg.textContent = rd.message + (rd.bonus ? ' (连签奖励!)' : '');
        const emeraldEl = backdrop.querySelector('.signin-stat-value');
        if (emeraldEl) emeraldEl.textContent = rd.emeralds;
        const navE = $('#navEmeraldNum');
        if (navE) navE.textContent = rd.emeralds;
        btn.textContent = '✓ 今日已签, 明天再来';
        const fresh = await fetchSigninStatus();
        const weekEl = backdrop.querySelector('.signin-week');
        if (weekEl) weekEl.innerHTML = renderRecentDays(fresh);
        updateSigninBadge(fresh);
        showSigninFlash(rd.today_emeralds);
      } catch (e) {
        msg.className = 'signin-msg signin-msg-err';
        msg.textContent = '✗ ' + e.message;
        btn.disabled = false;
      }
    };
  }
}

export async function loadSigninBadge() {
  try {
    const d = await fetchSigninStatus();
    updateSigninBadge(d);
  } catch (e) { console.warn('[signin] 签到 badge 加载失败 (未登录静默)', e); }
}
