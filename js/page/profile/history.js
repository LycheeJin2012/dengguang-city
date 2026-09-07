// v45 重写: profile 子页 - 我的最近留言 + 我的最近报名 (仅自己)
import { $, escHtml, escHtmlBr, GET, PATCH } from '../util.js?v=v46-fix-modules';
import { t } from '../../i18n/core.js?v=n5';

export async function loadMyMessages() {
  const wrap = $('#myMessagesCard');
  if (!wrap) return;
  try {
    const d = await GET('/api/messages?my=1');
    if (!d.ok) { wrap.style.display = 'none'; return; }
    const msgs = d.messages || [];
    if (!msgs.length) { wrap.style.display = 'none'; return; }
    wrap.innerHTML = '<div class="pmm-head">📜 ' + t('profile.history.messagesHead', '我最近的市民留言') + '</div>' + msgs.slice(0, 3).map(m => {
      const hasReply = m.admin_reply && m.admin_reply.length > 0;
      const isAi = hasReply && m.admin_reply.startsWith('🤖');
      const tag = isAi ? `<span class="msg-replied-tag" style="background:#1a3a1a;color:#9f9;border-color:#6f6">${t('profile.history.tagAiReply', '🤖 AI 已回复')}</span>`
                : hasReply ? `<span class="msg-replied-tag" style="background:#1a2a3a;color:#9cf;border-color:#6cf">${t('profile.history.tagReplied', '已回复')}</span>`
                : `<span class="msg-replied-tag" style="background:#3a2a1a;color:#fc6;border-color:#c84">${t('profile.history.tagPending', '⏳ 待回复')}</span>`;
      return `<article class="pmm-item">
        <div class="pmm-head-row">${tag}<span class="pmm-time">${(m.created_at || '').slice(0, 16).replace('T', ' ')}</span></div>
        <div class="pmm-content">${escHtmlBr(m.content)}</div>
        ${hasReply ? `<div class="pmm-reply">📣 ${escHtmlBr(m.admin_reply)}</div>` : ''}
      </article>`;
    }).join('');
    wrap.style.display = '';
    // v50-N4: 玩家看到自己的留言列表后, 自动把 message_reply 通知标已读
    //   这样顶栏铃铛红点消失, 玩家不需要点任何按钮
    //   用 PATCH /api/notifications?action=read-all (已有端点, 一键全标)
    if (msgs.some(m => m.admin_reply && m.admin_reply.length > 0)) {
      PATCH('/api/notifications?action=read-all', {}).catch(() => {});
      // 同步刷新铃铛 (隐藏)
      const badge = document.querySelector('#navBellBadge');
      if (badge) badge.hidden = true;
    }
  } catch (e) { wrap.style.display = 'none'; }
}

export async function loadMyBookings() {
  const wrap = $('#myBookingsCard');
  if (!wrap) return;
  try {
    const [b, l, k, c] = await Promise.all([
      fetch('/api/bookings', { credentials: 'include' }).then(r => r.ok ? r.json() : { bookings: [] }),
      fetch('/api/license',  { credentials: 'include' }).then(r => r.ok ? r.json() : { signups: [] }),
      fetch('/api/kart',     { credentials: 'include' }).then(r => r.ok ? r.json() : { signups: [] }),
      fetch('/api/circuit',  { credentials: 'include' }).then(r => r.ok ? r.json() : { signups: [] }),
    ]);
    const all = [];
    (b.bookings || []).forEach(x => all.push({ type: t('profile.history.booking.hotel', '酒店'), icon: '🏨', text: `${x.room_name || t('profile.history.booking.room', '房型')} · ${x.in_date} → ${x.out_date} (${x.nights} ${t('profile.history.booking.night', '晚')}${x.breakfast ? ' · ' + t('profile.history.booking.bfast', '含早餐') : ''})`, time: x.created_at }));
    (l.signups  || []).forEach(x => all.push({ type: t('profile.history.booking.license', '驾照'), icon: '🚗', text: `${({written:t('profile.history.booking.written', '笔试'),road:t('profile.history.booking.road', '路考'),upgrade:t('profile.history.booking.upgrade', '升级')})[x.exam_type] || x.exam_type} · ${x.exam_date || t('profile.history.booking.tbd', '日期待定')}`, time: x.created_at }));
    (k.signups  || []).forEach(x => all.push({ type: t('profile.history.booking.kart', '赛道'), icon: '🏁', text: `试跑 · ${x.session || t('profile.history.booking.sessionTbd', '场次待定')}${x.car ? ' · ' + x.car : ''}`, time: x.created_at }));
    (c.signups  || []).forEach(x => all.push({ type: t('profile.history.booking.circuit', '赛车场'), icon: '🏎️', text: t('profile.history.booking.circuitTrial', '国际赛车场试车'), time: x.created_at }));
    if (!all.length) { wrap.style.display = 'none'; return; }
    all.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    wrap.innerHTML = '<div class="pmm-head">📋 ' + t('profile.history.bookingsHead', '我最近的报名') + '</div>' + all.slice(0, 3).map(it => `
      <article class="pmm-item">
        <div class="pmm-head-row"><span class="pmm-type-tag">${it.icon} ${it.type}</span><span class="pmm-time">${(it.time || '').slice(0, 16).replace('T', ' ')}</span></div>
        <div class="pmm-content">${escHtml(it.text)}</div>
      </article>`).join('');
    wrap.style.display = '';
  } catch (e) { wrap.style.display = 'none'; }
}
