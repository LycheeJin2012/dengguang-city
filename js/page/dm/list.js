// v45 重写: dm 子页 - 会话列表 + 新建/AI 客服
import { $, escHtml, GET, POST, shortTime } from '../util.js?v=v45-fix-401';

let _onThreadOpen = null;
let _me = null;

export function setListContext(me, onThreadOpen) {
  _me = me;
  _onThreadOpen = onThreadOpen;
}

export async function loadList() {
  const list = $('#dmList');
  if (!list) return;
  let conversations = [];
  try {
    const d = await GET('/api/social?action=dm-list');
    conversations = d.conversations || [];
  } catch (e) {
    list.innerHTML = '<div class="dm-empty">载入失败</div>';
    return;
  }
  if (!conversations.length) {
    list.innerHTML = '<div class="dm-empty">还没有私信<br>点右上角"写新私信"开始</div>';
    return;
  }
  const current = window._dmCurrentPeer;
  list.innerHTML = conversations.map(c => `
    <div class="dm-conv ${current && current.username === c.peer.username ? 'active' : ''}" data-username="${escHtml(c.peer.username)}">
      <div class="avatar">${escHtml(c.peer.avatar_emoji || '👤')}</div>
      <div class="info">
        <div class="name">${escHtml(c.peer.username)}</div>
        <div class="preview">${escHtml(c.last_content || '').slice(0, 40)}</div>
      </div>
      <div class="conv-right">
        <span class="ts">${shortTime(c.last_at)}</span>
        ${c.unread > 0 ? `<span class="unread">${c.unread}</span>` : ''}
      </div>
    </div>`).join('');
  list.querySelectorAll('.dm-conv').forEach(el => {
    el.addEventListener('click', () => {
      if (_onThreadOpen) _onThreadOpen(el.dataset.username);
    });
  });
}

function openNewDM() {
  const username = prompt('收件人用户名（对方必须是已激活的玩家）:');
  if (!username || !username.trim()) return;
  const content = prompt('私信内容:');
  if (!content || !content.trim()) return;
  POST('/api/social?action=dm-send', {
    to_username: username.trim(),
    content: content.trim()
  }).then(d => {
    if (d.ok) {
      if (_onThreadOpen) _onThreadOpen(username.trim());
      loadList();
    } else {
      alert('发送失败：' + (d.error || ''));
    }
  }).catch(e => alert('发送失败：' + e.message));
}

function openAiBot() {
  const content = prompt('给 AI 客服灯灯留言（100 字以内）：');
  if (!content || !content.trim()) return;
  const text = content.trim().slice(0, 100);
  POST('/api/social?action=dm-send', { to_username: '灯灯客服', content: text })
    .then(d => {
      if (!d.ok) { alert('发送失败：' + (d.error || '')); return; }
      if (_onThreadOpen) _onThreadOpen('灯灯客服');
      loadList();
      // 等 1.8s 看 AI 回复
      setTimeout(async () => { await loadList(); }, 1800);
    })
    .catch(e => alert('发送失败：' + e.message));
}

export function bindListActions() {
  $('#dmNewBtn')?.addEventListener('click', openNewDM);
  $('#dmAiBotBtn')?.addEventListener('click', openAiBot);
}
