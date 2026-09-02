// v47: profile 通知订阅 (公告 / 留言回复 / 私信)
// + 显示最近 5 条站内通知
import { $, esc, GET, POST, DEL, PATCH } from '../util.js?v=v46-fix-modules';

const TYPE_LABEL = {
  announcement: { name: '📢 新公告', desc: '市政厅发布新公告时通知我' },
  reply:        { name: '💬 我的留言被回复', desc: '我的市民留言被管理员/AI 回复时通知我' },
  dm:           { name: '📨 新私信', desc: '收到新私信时通知我' },
};

export async function renderSubCard() {
  const card = $('#subCard');
  const box = $('#subContent');
  if (!card || !box) return;
  card.style.display = '';

  // 1. 我的订阅
  let subs = [];
  try { const d = await GET('/api/subscriptions?my=1'); subs = d.subscriptions || []; } catch (e) {}

  // 2. 最近通知
  let notifs = [];
  try { const d = await GET('/api/notifications?my=1&limit=5'); notifs = d.notifications || []; } catch (e) {}

  box.innerHTML = `
    <h4 style="margin:0 0 8px 0">🔔 我的订阅 (${subs.filter(s => s.enabled).length} 个开启)</h4>
    <div class="sub-list" style="display:flex;flex-direction:column;gap:6px">
      ${Object.entries(TYPE_LABEL).map(([type, info]) => {
        const my = subs.filter(s => s.type === type);
        const enabled = my.some(s => s.enabled);
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border:2px solid var(--c-stone);background:var(--c-bg-1)">
          <div>
            <b>${info.name}</b>
            <div style="font-size:12px;color:var(--c-stone-dark)">${esc(info.desc)}</div>
          </div>
          <button class="btn ${enabled ? 'btn-ghost' : 'btn-primary'}" data-type="${type}" data-action="toggle" data-on="${enabled}">
            ${enabled ? '✓ 已订阅' : '+ 订阅'}
          </button>
        </div>`;
      }).join('')}
    </div>
    <h4 style="margin:16px 0 8px 0">📬 最近通知 (${notifs.length})</h4>
    <div class="notif-list" style="display:flex;flex-direction:column;gap:6px">
      ${notifs.length === 0 ? '<p class="muted">还没有通知</p>' :
        notifs.map(n => `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px;border:2px solid var(--c-stone);background:${n.read_at ? 'var(--c-bg-2)' : '#fff8d6'};opacity:${n.read_at ? '0.7' : '1'}">
          <div style="flex:1">
            <b>${esc(n.title)}</b>
            ${n.body ? `<div style="font-size:13px;color:var(--c-stone-dark)">${esc(n.body.slice(0, 100))}</div>` : ''}
            <div style="font-size:11px;color:var(--c-stone-dark);margin-top:2px">${esc((n.created_at || '').slice(0, 16).replace('T', ' '))}</div>
          </div>
          ${!n.read_at ? `<button class="btn btn-ghost btn-sm" data-notif="${n.id}" data-action="read">已读</button>` : '<span style="font-size:11px;color:var(--c-stone-dark)">已读</span>'}
        </div>`).join('')}
    </div>
    ${notifs.some(n => !n.read_at) ? '<button id="notifReadAll" class="btn btn-ghost btn-sm" style="margin-top:8px">全部标为已读</button>' : ''}
  `;

  // 绑定订阅 toggle
  box.querySelectorAll('[data-action="toggle"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      const on = btn.dataset.on === 'true';
      try {
        if (on) {
          // 取消订阅
          const sub = subs.find(s => s.type === type && s.enabled);
          if (sub) await DEL('/api/subscriptions?id=' + sub.id);
        } else {
          await POST('/api/subscriptions', { type, channel: 'site' });
        }
        renderSubCard();
      } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
    });
  });

  // 标记单条已读
  box.querySelectorAll('[data-action="read"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await PATCH('/api/notifications?id=' + btn.dataset.notif); renderSubCard(); }
      catch (e) { console.warn(e); }
    });
  });

  // 全部已读
  $('#notifReadAll')?.addEventListener('click', async () => {
    try { await PATCH('/api/notifications?action=read-all'); renderSubCard(); }
    catch (e) { console.warn(e); }
  });
}
