/**
 * Profile page workspace.
 *
 * v79-4 拆分自原 js/app/profile.js (148 行)：
 *   - render + 6 个 tab 路由 → 本文件
 *   - security → ./security.js
 *   - 其余 5 个 tab（history / race / exam / subscriptions / rewards）
 *     保持内联，等 v80+ 再拆。
 */

import { tabsMarkup, bindTabs } from '../../../ui/workspace.js';
import { renderSurvey } from '../../exam-survey.js';
import { createTicket, viewCitizenTicket } from '../../ticket-form.js';
// v84：直连 home 的真实模块，不再绕 v79 兼容转发层 home.js。
import { signin } from '../home/signin.js';
import { security as renderSecurityTab } from './security.js';
import {$,$$,api,post,patch,del,region,esc,text,ticketBody,date,status,empty,title,field,modal,action,toast,state,login,download,imageUrl} from '../../core.js'
import { parseDate } from '../../../date.js';

export async function render(el) {
  const username =
    new URLSearchParams(location.search).get('u') || state.session?.player?.username;
  if (!username) {
    el.innerHTML =
      title('市民主页') +
      `<div class="panel"><p>${'先报上名字，市政厅才认得你是谁，才能调出档案。'}</p><button id="profile-login">${'我是市民'}</button></div>`;
    $('#profile-login', el).onclick = async () => {
      await login();
      if (state.session?.player) render(el);
    };
    return;
  }
  const d = await api(
      '/api/social?action=profile&username=' + encodeURIComponent(username)
    ),
    p = d.profile,
    self = p.id === state.session?.player?.id;
  const joined = +parseDate(p.created_at);
  const days = Number.isFinite(joined)
    ? Math.max(0, Math.floor((Date.now() - joined) / 86400000))
    : 0;
  el.innerHTML =
    title('市民档案') +
    `<div class="${self ? 'profile-layout' : 'public-profile'}"><aside class="profile-summary panel"><div class="row-head"><div><span class="avatar">${esc(
      p.avatar_emoji || '👤'
    )}</span><h2>${esc(p.username)}</h2></div><span class="badge">${'来了'} ${days} ${'天'}</span></div><p>${text(
      p.bio || '这位市民还没写简介。'
    )}</p><small>${'登记于'} ${date(p.created_at)}</small><div class="stats"><div class="stat"><strong>${
      d.stats.messages
    }</strong><span>${'留言'}</span></div><div class="stat"><strong>${
      d.stats.comments
    }</strong><span>${'评论'}</span></div></div><div class="actions">${
      self
        ? `<a class="button" href="/affairs.html">我的事务</a><button id="profile-passkeys">${'通行密钥'}</button><button id="edit-profile">${'改资料'}</button><button id="citizen-card">${'下载市民卡'}</button><button id="daily-signin">🎁 ${'签到'}</button>`
        : `<a class="button" href="/dm.html?to=${encodeURIComponent(p.username)}">${'发私信'}</a>`
    }</div></aside>${
      self
        ? `<div class="profile-workspace">${tabsMarkup(
            [
              ['history','我的记录'],
              ['security','账号安全'],
              ['race','赛道成绩'],
              ['exam','模拟考试'],
              ['subscriptions','通知订阅'],
              ['rewards','工单奖励'],
            ].map(([key, zh]) => ({ key, label: zh })),
            'history',
            {
              id: 'profile-tabs',
              label: '市民档案',
              panelId: 'profile-content',
            }
          )}<section id="profile-content" class="panel"></section></div>`
        : ''
    }</div>`;
  if (!self) return;

  $('#edit-profile', el).onclick = () =>
    modal(
      '改一改资料',
      field('avatar_emoji', '头像', 'text', p.avatar_emoji) +
        field('bio', '个人简介', 'textarea', p.bio || '', {
          required: false,
          maxlength: 500,
        }),
      {
        submit: async (values) => {
          await patch('/api/social?action=me', values);
          await render(el);
        },
      }
    );
  $('#daily-signin', el).onclick = (e) => action(e.currentTarget, signin);
  $('#citizen-card', el).onclick = () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540"><rect width="900" height="540" fill="#fff8dd"/><rect x="20" y="20" width="860" height="500" fill="none" stroke="#333323" stroke-width="8"/><path d="M20 130H880" stroke="#496a20" stroke-width="8"/><g fill="#496a20" font-family="sans-serif"><text x="60" y="90" font-size="38">灯光市 · 市民身份卡</text><text x="60" y="240" font-size="48">${esc(p.username)}</text><text x="60" y="320" font-size="28">市民编号 #${p.id}</text><text x="60" y="390" font-size="24">加入日期 ${esc(p.created_at.slice(0, 10))}</text><text x="60" y="460" font-size="20">Minecraft 城市作品纪念卡，不是身份证件</text></g></svg>`;
    download('light-city-citizen.svg', svg, 'image/svg+xml');
  };

  async function tab(key) {
    $$('[data-tab-key]', el).forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tabKey === key));
      b.tabIndex = b.dataset.tabKey === key ? 0 : -1;
    });
    const old = $('#profile-content', el),
      box = document.createElement('section');
    box.id = 'profile-content';
    box.setAttribute('role', 'tabpanel');
    box.setAttribute('aria-labelledby', 'profile-tabs-' + key);
    box.className = 'panel';
    old.replaceWith(box);
    await region(
      box,
      async () => key,
      (k, target) =>
        ({
          history: renderHistory,
          security: renderSecurityTab,
          race: renderRace,
          exam: renderExam,
          subscriptions: renderSubscriptions,
          rewards: renderRewards,
        }[k])(target)
    );
  }
  bindTabs($('#profile-tabs', el), tab);
  $('#profile-passkeys', el).onclick = () => tab('security');
  await tab(
    location.hash === '#security'
      ? 'security'
      : location.hash === '#exam'
      ? 'exam'
      : 'history'
  );
}

// ----- tab renderers ----------------------------------------------------

async function renderHistory(el) {
  const labels = [
    ['messages','我的留言'],
    ['bookings','酒店预订'],
    ['kart','卡丁车'],
    ['circuit','国际试车'],
    ['license','驾照报名'],
    ['tickets','事务工单'],
  ];
  el.innerHTML = labels
    .map(([k, zh]) => `<section class="section"><h3>${zh}</h3><div id="history-${k}"></div></section>`)
    .join('');
  await Promise.all(
    labels.map(([k]) =>
      region($('#history-' + k, el), () => api('/api/' + k + '?my=1'), (d, box) => {
        const rows = d[k] || d.signups || [];
        box.innerHTML =
          rows
            .map(
              (r) =>
                `<div class="row"><div class="row-head"><b>${esc(
                  r.room_name || r.title || r.exam_type || r.session || '#' + r.id
                )}</b>${status(r.status)}</div><div>${
                  r.body ? ticketBody(r.body) : text(r.content || r.note || '')
                }</div>${r.admin_reply ? `<div class="notice">${text(r.admin_reply)}</div>` : ''}${
                  r.in_date ? `<p>${esc(r.in_date)} → ${esc(r.out_date)}</p>` : ''
                }<small>${date(r.created_at)}</small>${
                  k === 'tickets'
                    ? `<div class="actions"><button data-ticket="${esc(r.id)}">${'详情与补材料'} ${r.attachment_count ? '📎 ' + r.attachment_count : ''}</button></div>`
                    : ''
                }</div>`
            )
            .join('') || empty();
        $$('[data-ticket]', box).forEach((button) =>
          button.onclick = () =>
            viewCitizenTicket(button.dataset.ticket, { onChanged: () => renderHistory(el) }).catch(
              (e) => toast(e.message, true)
            )
        );
      })
    )
  );
  el.insertAdjacentHTML(
    'beforeend',
    `<button id="service-ticket">${'再交一单'}</button>`
  );
  $('#service-ticket', el).onclick = () =>
    createTicket({ onCreated: () => renderHistory(el) }).catch((e) => toast(e.message, true));
}

async function renderRace(el) {
  const b = await api('/api/homepage-bundle');
  const tracks = b.bundle.tracks.filter((t) => t.is_active);
  el.innerHTML = `<h3>${'赛道成绩'}</h3><button id="report-race" ${
    tracks.length ? '' : 'disabled'
  }>＋ ${'报成绩'}</button><div id="race-history" class="section"></div>`;
  $('#report-race', el).onclick = () =>
    modal(
      '报圈速',
      field('track_id', '赛道', 'select', tracks[0].id, {
        options: tracks.map((t) => [t.id, t.name]),
      }) +
        field('time', '圈速（分:秒.毫秒）', 'text', '1:23.456') +
        field('kart_name', '车型', 'text', '', { required: false }) +
        field('license_grade', '驾照', 'select', 'B', {
          options: ['B','A'],
        }),
      {
        submit: async (d) => {
          const m = /^(\d+):([0-5]\d)\.(\d{3})$/.exec(d.time);
          if (!m)
            throw new Error('时间得写成 1:23.456 这样');
          await post('/api/race-times', {
            ...d,
            time_ms: (+m[1] * 60 + +m[2]) * 1000 + +m[3],
          });
          await renderRace(el);
        },
      }
    );
  region($('#race-history', el), () => api('/api/race-times?my=1'), (d, box) =>
    box.innerHTML =
      d.times
        .map(
          (r) =>
            `<div class="row">${esc(r.track_name)} · <b>${esc(r.formatted)}</b> ${r.verified ? '已核实' : '待核实'}</div>`
        )
        .join('') || empty()
  );
}

async function renderExam(el) {
  await renderSurvey(el);
}

async function renderSubscriptions(el) {
  const d = await api('/api/subscriptions?my=1');
  const labels = [
    ['announcement','市政公告'],
    ['reply','留言回复'],
    ['dm','新私信'],
  ];
  el.innerHTML = `<h3>${'想收哪些提醒'}</h3>${labels
    .map(([type, zh]) => {
      const s = d.subscriptions.find((s) => s.type === type && s.enabled);
      return `<div class="row row-head"><span>${zh}</span><button data-type="${type}" data-id="${
        s?.id || ''
      }">${s ? '取消订阅' : '订阅'}</button></div>`;
    })
    .join('')}`;
  $$('[data-type]', el).forEach((b) =>
    b.onclick = (e) =>
      action(e.currentTarget, async () => {
        if (b.dataset.id) await del('/api/subscriptions?id=' + b.dataset.id);
        else await post('/api/subscriptions', { type: b.dataset.type, channel: 'site' });
        await renderSubscriptions(el);
      })
  );
}

async function renderRewards(el) {
  await region(el, () => api('/api/rewards?my=1'), (d, box) => {
    box.innerHTML = `<h3>${'办完事的奖励'}</h3>${d.rewards
      .map(
        (r) =>
          `<div class="row"><b>+${r.amount} 💎</b> · ${'工单'} #${esc(
            r.ticket_ref
          )}<p>${'承办人'} #${r.admin_id} · ${date(r.paid_at || r.created_at)}</p></div>`
      )
      .join('') || empty()}`;
  });
}