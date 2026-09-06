// v50-N6 (C1): 玩家榜单页 - 4 tab 切换 + 拉 /api/leaderboard 渲染
import { $, $$ } from '../util.js?v=v46-fix-modules';
import { t, setPageTitle, setMetaDescription, initI18n } from '../../i18n/core.js?v=n5';

const TYPES = ['messages', 'bookings', 'licenses'];
let _currentType = 'messages';
let _cache = {}; // type -> entries

async function loadBoard(type) {
  const list = $('#boardList');
  const label = $('#boardLabel');
  if (list) list.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>${t('common.loading', '载入中…')}</p></div>`;
  if (_cache[type]) {
    renderBoard(_cache[type]);
    return;
  }
  try {
    const r = await fetch('/api/leaderboard?type=' + type + '&limit=20', { credentials: 'include' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || '加载失败');
    if (label) label.textContent = d.label || '';
    _cache[type] = d;
    renderBoard(d);
  } catch (e) {
    if (list) list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${t('common.error.load', '加载失败')}: ${e.message}</p></div>`;
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
  const unit = data.unit || '';
  list.innerHTML = `<ol class="board-entries">${entries.map(e => `
    <li class="board-entry ${e.rank <= 3 ? 'board-top' : ''}" data-rank="${e.rank}">
      <span class="board-rank">${e.rank <= 3 ? ['🥇','🥈','🥉'][e.rank-1] : '#' + e.rank}</span>
      <span class="board-avatar">${e.avatar_emoji || '👤'}</span>
      <span class="board-name">${e.username}</span>
      ${e.grades ? `<span class="board-grades">${e.grades}</span>` : ''}
      <span class="board-score">${e.score}${unit}</span>
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
  setPageTitle('page.title.leaderboard', '玩家榜单 · 灯光市人民政府');
  setMetaDescription('page.meta.leaderboard',
    '灯光市玩家排行榜 - 留言数 / 酒店预订 / 驾照等级 3 维度, 看谁是灯光市最活跃的市民。',
    'Light City Player Leaderboard - Top contributors in messages, bookings, and licenses.');
  bindTabs();
  loadBoard('messages');
}

initI18n().then(bindAll);
