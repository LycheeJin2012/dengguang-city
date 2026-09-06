// v45 重写: dm 子页 - 单个对话线程 (消息列表 + 发送)
// v50-N5: 用 t() 翻译空态/错误文案
import { $, escHtml, escHtmlBr, GET, POST, PATCH, shortTime } from '../util.js?v=v46-fix-modules';
import { loadList } from './list.js?v=v46-fix-modules';
import { t } from '../../i18n/core.js?v=n5';

let _me = null;
let _currentPeer = null;
let _messages = [];

export function setThreadContext(me) {
  _me = me;
}

export function getCurrentPeer() { return _currentPeer; }

export async function openThread(username) {
  window._dmCurrentPeer = { username };
  // 重新高亮
  document.querySelectorAll('.dm-conv').forEach(el => {
    el.classList.toggle('active', el.dataset.username === username);
  });
  // 标记已读
  try {
    await PATCH('/api/social?action=dm-read&peer=' + encodeURIComponent(username), {});
  } catch (e) { console.warn('[dm] 标记私信已读失败', e); }
  const area = $('#dmThreadArea');
  if (area) area.innerHTML = `<div class="dm-empty">${t('dm.loading')}</div>`;
  try {
    const d = await GET('/api/social?action=dm-thread&peer=' + encodeURIComponent(username));
    if (!d.ok) {
      if (area) area.innerHTML = `<div class="dm-empty">${t('dm.empty.loadFail')}：${escHtml(d.error || '')}</div>`;
      return;
    }
    _currentPeer = d.peer;
    _messages = d.messages || [];
    renderThread();
  } catch (e) {
    if (area) area.innerHTML = `<div class="dm-empty">${t('dm.empty.loadFail')}</div>`;
  }
}

function renderThread() {
  if (!_currentPeer) return;
  const area = $('#dmThreadArea');
  if (!area) return;
  area.innerHTML = `
    <div class="dm-thread-head">
      <span class="avatar">${escHtml(_currentPeer.avatar_emoji || '👤')}</span>
      <div>
        <div class="name">${escHtml(_currentPeer.username)}</div>
        <div class="sub">${t('dm.thread.sub', '私信对话')}</div>
      </div>
      <a href="profile.html?u=${encodeURIComponent(_currentPeer.username)}">${t('dm.thread.viewProfile', '查看对方主页 →')}</a>
    </div>
    <div class="dm-messages" id="dmMessages"></div>
    <div class="dm-input">
      <textarea id="dmInput" placeholder="${t('dm.thread.inputPh', '输入私信内容（最多 2000 字）…')}"></textarea>
      <button id="dmSend">${t('common.send', '发送')}</button>
    </div>`;
  const wrap = $('#dmMessages');
  if (!_messages.length) {
    wrap.innerHTML = `<div class="dm-empty">${t('dm.empty.noMsgs')}</div>`;
  } else {
    wrap.innerHTML = _messages.map(m => {
      const mine = m.from_player_id === _me.id;
      return `<div class="dm-msg ${mine ? 'mine' : ''}">
        <div class="bubble">${escHtmlBr(m.content)}</div>
        <div class="ts">${shortTime(m.created_at)}${!mine && !m.read_at ? ' · ' + t('dm.unread', '未读') : ''}</div>
      </div>`;
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }
  $('#dmSend').addEventListener('click', sendMessage);
  $('#dmInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  });
}

async function sendMessage() {
  const inp = $('#dmInput');
  const btn = $('#dmSend');
  const content = inp.value.trim();
  if (!content || !_currentPeer) return;
  const sendingL = t('dm.sending', '发送中…');
  const failL = t('dm.sendFail', '发送失败：');
  const sendL = t('common.send', '发送');
  btn.disabled = true; btn.textContent = sendingL;
  try {
    const d = await POST('/api/social?action=dm-send', {
      to_username: _currentPeer.username, content
    });
    if (!d.ok) { alert(failL + (d.error || '')); return; }
    inp.value = '';
    await openThread(_currentPeer.username);
    await loadList();
  } catch (e) {
    alert(failL + e.message);
  } finally {
    btn.disabled = false; btn.textContent = sendL;
  }
}
