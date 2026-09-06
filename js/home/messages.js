// v45 重写: 公共市民留言墙 (公开 + 评论)
// v50-N5 Step 15: loading/empty/error 走 i18n
import { $, escHtml, escHtmlBr, relativeTime, fmtDate, GET, POST, safeRender } from './util.js?v=v46-fix-modules';
import { t } from '../i18n/core.js?v=n5';

const _pubMsgCache = { data: null, ts: 0 };
const CACHE_TTL = 30_000;

export async function loadPublicMessages() {
  const list = $('#publicMessageBoard') || $('#pubMsgList');
  if (!list) return;
  await safeRender(async () => {
    const msgs = await fetchPublicMessages();
    if (!msgs.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><p>${t('messages.empty', '暂无留言, 来抢沙发')}</p></div>`;
      return;
    }
    list.innerHTML = msgs.map(m => {
      const typeLabel = ({ '建议': '💡', '投诉': '⚠️', '咨询': '❓', '合作': '🤝' })[m.type] || '💬';
      const hasReply = m.admin_reply && m.admin_reply.length > 0;
      const replyTag = hasReply
        ? (m.admin_reply.startsWith('🤖')
            ? `<span class="msg-replied-tag" style="background:#1a3a1a;color:#9f9;border-color:#6f6">${t('messages.replyTag.ai')}</span>`
            : `<span class="msg-replied-tag" style="background:#1a2a3a;color:#9cf;border-color:#6cf">${t('messages.replyTag.human')}</span>`)
        : `<span class="msg-replied-tag" style="background:#3a2a1a;color:#fc6;border-color:#c84">${t('messages.replyTag.wait')}</span>`;
      return `<article class="msg-item" data-id="${m.id}">
        <div class="msg-head"><div class="msg-head-left">
          <b class="msg-name">${typeLabel} ${escHtml(m.name)}${m.contact ? ' · ' + escHtml(m.contact) : ''}</b>
          ${replyTag}
        </div><div class="msg-time">${relativeTime(m.created_at)}</div></div>
        <p class="msg-content">${escHtmlBr(m.content)}</p>
        ${hasReply ? `<div class="msg-reply-box"><b>${t('messages.adminReply')}</b><div>${escHtmlBr(m.admin_reply)}</div><small>${fmtDate(m.replied_at)}</small></div>` : ''}
        <div class="msg-actions book-actions">
          <button class="btn btn-ghost btn-sm" data-act="comments">💬 ${t('common.comments', '评论')}</button>
        </div>
        <div class="comment-section" data-mid="${m.id}" style="display:none"></div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-act="comments"]').forEach(btn => {
      const item = btn.closest('.msg-item');
      const mid = +item.dataset.id;
      btn.onclick = () => toggleComments(mid, btn);
    });
  }, list);
}

async function fetchPublicMessages() {
  if (_pubMsgCache.data && Date.now() - _pubMsgCache.ts < CACHE_TTL) return _pubMsgCache.data;
  const d = await GET('/api/messages?public=1');
  _pubMsgCache.data = d.messages || [];
  _pubMsgCache.ts = Date.now();
  return _pubMsgCache.data;
}

export async function toggleComments(mid, btn) {
  const section = document.querySelector(`.comment-section[data-mid="${mid}"]`);
  if (!section) return;
  if (section.style.display === 'block') {
    section.style.display = 'none';
    btn.textContent = '💬 ' + t('common.comments', '评论');
    return;
  }
  btn.textContent = t('common.collapse', '收起评论');
  section.style.display = 'block';
  section.innerHTML = `<div class="empty-state" style="padding:20px"><p>${t('common.loading', '载入中…')}</p></div>`;
  await renderComments(mid, section);
}

async function renderComments(mid, box) {
  try {
    const d = await GET('/api/comments?message_id=' + mid);
    const list = d.comments || [];
    if (!list.length) {
      box.innerHTML = `<div class="empty-state" style="padding:16px"><p>${t('messages.empty.comments', '暂无评论, 来抢沙发')}</p></div>`;
    } else {
      box.innerHTML = list.map((c, i) => {
        const floor = i + 1;
        const author = escHtml(c.author_name || c.player_username || '匿名');
        const timeAgo = relativeTime(c.created_at);
        return `<div class="comment-item">
          <div class="comment-head">
            <span class="comment-floor" style="background:var(--c-grass);color:#fff;font-size:11px;padding:1px 6px;border-radius:10px;margin-right:6px">#${floor}</span>
            <b>${author}</b> <span class="comment-time">${timeAgo}</span>
          </div>
          <div class="comment-body">${escHtmlBr(c.content)}</div>
        </div>`;
      }).join('');
    }
    // 评论表单
    box.insertAdjacentHTML('beforeend', `
      <form class="comment-form" data-mid="${mid}" style="margin-top:12px;display:flex;gap:8px">
        <input type="text" name="content" maxlength="500" data-i18n-placeholder="ph.message" placeholder="${t('ph.message', '请输入你的留言...')}" style="flex:1;padding:6px 10px;border:2px solid var(--c-stone);font-family:inherit">
        <button type="submit" class="btn btn-primary btn-sm">${t('common.send', '发送')}</button>
      </form>`);
    box.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const content = box.querySelector('input[name=content]').value.trim();
      if (!content) return;
      try {
        await POST('/api/comments', { message_id: mid, content });
        box.querySelector('input[name=content]').value = '';
        await renderComments(mid, box);
      } catch (err) { if (window._toast) window._toast('发送失败: ' + err.message, 'error'); }
    };
  } catch (e) {
    box.innerHTML = `<div class="empty-state"><p>${t('common.error.load', '加载失败')}: ${escHtml(e.message)}</p></div>`;
  }
}

export async function loadCommentCount(mid) {
  try {
    const d = await GET('/api/comments?message_id=' + mid);
    return (d.comments || []).length;
  } catch (e) { return 0; }
}
