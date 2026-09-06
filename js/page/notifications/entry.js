// v50-N6 (C2): 通知中心页 - 4 filter + 全部已读
import { $, $$ } from '../util.js?v=v46-fix-modules';
import { t, setPageTitle, setMetaDescription, initI18n } from '../../i18n/core.js?v=n5';

const TYPE_ICON = {
  message_reply: '💬',
  dm: '✉️',
  announcement: '📢',
  default: '🔔',
};
let _allNotifs = [];
let _currentFilter = 'all';

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return t('time.justNow', '刚刚');
  if (diff < 3600) return Math.floor(diff / 60) + t('time.minutesAgo', ' 分钟前');
  if (diff < 86400) return Math.floor(diff / 3600) + t('time.hoursAgo', ' 小时前');
  if (diff < 604800) return Math.floor(diff / 86400) + t('time.daysAgo', ' 天前');
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function loadNotifs() {
  const list = $('#notifList');
  if (list) list.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>${t('common.loading', '载入中…')}</p></div>`;
  try {
    const r = await fetch('/api/notifications?my=1&limit=100', { credentials: 'include' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || t('common.error.load', '加载失败'));
    _allNotifs = d.notifications || [];
    renderSummary(d.unread_count || 0);
    renderList();
  } catch (e) {
    if (list) list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${t('common.error.load', '加载失败')}: ${e.message}</p></div>`;
  }
}

function renderSummary(unread) {
  const sum = $('#notifSummary');
  if (sum) {
    sum.innerHTML = unread > 0
      ? `<span class="notif-badge-unread">${unread}</span> ${t('notif.unreadCount', '条未读')}`
      : `<span class="notif-badge-zero">${t('notif.allRead', '全部已读')}</span>`;
  }
}

function renderList() {
  const list = $('#notifList');
  if (!list) return;
  let filtered = _allNotifs;
  if (_currentFilter === 'unread') filtered = filtered.filter(n => !n.read_at);
  else if (_currentFilter !== 'all') filtered = filtered.filter(n => n.type === _currentFilter);
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>${t('notif.empty', '暂无通知')}</p></div>`;
    return;
  }
  list.innerHTML = filtered.map(n => {
    const icon = TYPE_ICON[n.type] || TYPE_ICON.default;
    const isUnread = !n.read_at;
    return `<article class="notif-item ${isUnread ? 'notif-unread' : ''}" data-id="${n.id}" data-link="${n.link || ''}">
      <div class="notif-icon">${icon}</div>
      <div class="notif-body">
        <div class="notif-head"><b>${n.title || t('notif.untitled', '(无标题)')}</b>${isUnread ? '<span class="notif-dot"></span>' : ''}</div>
        <p class="notif-text">${n.body || ''}</p>
        <small class="notif-time">${fmt(n.created_at)}</small>
      </div>
      <div class="notif-actions">
        ${n.link ? `<a href="${n.link}" class="btn btn-ghost btn-small" data-act="open">${t('notif.open', '查看')}</a>` : ''}
        ${isUnread ? `<button type="button" class="btn btn-primary btn-small" data-act="read">${t('notif.read', '✓ 已读')}</button>` : ''}
      </div>
    </article>`;
  }).join('');

  list.querySelectorAll('[data-act="read"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const item = e.target.closest('.notif-item');
      const id = +item.dataset.id;
      try {
        await fetch('/api/notifications?id=' + id, { method: 'PATCH', credentials: 'include' });
        const n = _allNotifs.find(x => x.id === id);
        if (n) n.read_at = new Date().toISOString();
        renderSummary(_allNotifs.filter(x => !x.read_at).length);
        renderList();
      } catch (err) { if (window._toast) window._toast(t('common.error.load', '加载失败') + ': ' + err.message, 'error'); }
    });
  });
}

async function readAll() {
  try {
    const r = await fetch('/api/notifications?action=read-all', { method: 'PATCH', credentials: 'include' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || t('common.error.load', '操作失败'));
    _allNotifs.forEach(n => { n.read_at = n.read_at || new Date().toISOString(); });
    renderSummary(0);
    renderList();
    if (window._toast) window._toast(t('notif.readAllDone', '已全部标为已读'), 'success');
  } catch (e) { if (window._toast) window._toast(t('notif.readAllFail', '操作失败: ') + e.message, 'error'); }
}

function bindFilters() {
  $$('.notif-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentFilter = btn.dataset.filter;
      $$('.notif-filter').forEach(b => b.classList.toggle('active', b === btn));
      renderList();
    });
  });
  const readAllBtn = $('#readAllBtn');
  if (readAllBtn) readAllBtn.addEventListener('click', readAll);
}

function bindAll() {
  setPageTitle('page.title.notifications', 'Notification Center · Light City');
  setMetaDescription('page.meta.notifications',
    '灯光市通知中心 - 站内所有通知, 留言回复 / DM / 公告 / 订阅推送。',
    'Light City Notification Center - All in-site notifications: message replies, DMs, announcements.');
  bindFilters();
  // v50-N6: notifications 自带 lang-toggle 按钮, 绑事件
  const langBtn = document.getElementById('langToggle');
  if (langBtn) {
    const refresh = () => {
      const lang = localStorage.getItem('lc_lang') || 'zh-CN';
      langBtn.textContent = lang === 'zh-CN' ? '🌐 EN' : '🌐 中文';
    };
    refresh();
    langBtn.addEventListener('click', () => {
      const cur = localStorage.getItem('lc_lang') || 'zh-CN';
      const next = cur === 'zh-CN' ? 'en' : 'zh-CN';
      localStorage.setItem('lc_lang', next);
      document.documentElement.lang = next;
      window.dispatchEvent(new CustomEvent('lc:langchange', { detail: { lang: next } }));
      refresh();
      // 重拉通知 (时间 label / 标题跟语言走)
      loadNotifs();
    });
  }
  loadNotifs();
}

initI18n().then(bindAll);
