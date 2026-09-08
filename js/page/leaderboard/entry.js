// v50-N6 (C1): 玩家榜单页 - 4 tab 切换 + 拉 /api/leaderboard 渲染
import { $, $$, escHtml } from '../util.js?v=v46-fix-modules';
import { t, getLang, setLang, setPageTitle, setMetaDescription, initI18n } from '../../i18n/core.js?v=n5';

const TYPES = ['messages', 'bookings', 'licenses'];
let _currentType = 'messages';
let _cache = {}; // type -> entries

async function loadBoard(type) {
  const list = $('#boardList');
  const label = $('#boardLabel');
  if (list) list.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>${t('common.loading', '载入中…')}</p></div>`;
  // v50-N6: 客户端 i18n label (覆盖 API 的中文 label)
  if (label) label.textContent = t('board.tab.' + type, '');
  if (_cache[type]) {
    renderBoard(_cache[type]);
    return;
  }
  try {
    const r = await fetch('/api/leaderboard?type=' + type + '&limit=20', { credentials: 'include' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || t('common.error.load', '加载失败'));
    _cache[type] = d;
    if (_currentType === type) renderBoard(d);
  } catch (e) {
    if (list && _currentType === type) list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${t('common.error.load', '加载失败')}: ${escHtml(e.message)}</p></div>`;
  }
}

function renderBoard(data) {
  const list = $('#boardList');
  if (!list) return;
  const entries = data.entries || [];
  if (!entries.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>${t('board.empty', '暂无数据')}</p></div>`;
    return;
  }
  // v50-N6: unit 也走 i18n (英文模式不加 "条/次/级")
  const unit = t('board.unit.' + (_currentType || 'messages'), data.unit || '');
  list.innerHTML = `<ol class="board-entries">${entries.map(e => `
    <li class="board-entry ${e.rank <= 3 ? 'board-top' : ''}" data-rank="${e.rank}">
      <span class="board-rank">${e.rank <= 3 ? ['🥇','🥈','🥉'][e.rank-1] : '#' + e.rank}</span>
      <span class="board-avatar">${escHtml(e.avatar_emoji || '👤')}</span>
      <span class="board-name">${escHtml(e.username)}</span>
      ${e.grades ? `<span class="board-grades">${escHtml(e.grades)}</span>` : ''}
      <span class="board-score">${escHtml(e.score)}${unit}</span>
    </li>`).join('')}</ol>`;
}

function bindTabs() {
  $$('.board-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      if (!TYPES.includes(type)) return;
      _currentType = type;
      $$('.board-tab').forEach(t => t.classList.toggle('active', t.dataset.type === type));
      loadBoard(type);
    });
  });
}

function bindAll() {
  setPageTitle('page.title.leaderboard', 'Player Leaderboard · Light City');
  setMetaDescription('page.meta.leaderboard',
    'Light City Player Leaderboard - Top contributors in messages, bookings, and licenses.');
  bindTabs();
  // v50-N6: 语言切换按钮 (leaderboard 顶栏有自己的 lang-toggle)
  const langBtn = document.getElementById('langToggle');
  if (langBtn) {
    const refresh = () => {
      const lang = getLang();
      langBtn.textContent = lang === 'zh-CN' ? '🌐 EN' : '🌐 中文';
    };
    refresh();
    langBtn.addEventListener('click', () => {
      const cur = getLang();
      const next = cur === 'zh-CN' ? 'en' : 'zh-CN';
      setLang(next);
      refresh();
      // 重渲染当前 tab (label/unit 跟语言走)
      loadBoard(_currentType);
    });
  }
  loadBoard('messages');
}

initI18n();
bindAll();
