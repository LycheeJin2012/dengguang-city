/**
 * 市民档案页：左侧资料卡 + 右侧 6 个 tab（仅本人可见）。
 *
 * 原来这个文件 268 行、最长行 712 字符：一根 `el.innerHTML = ...` 模板串里同时
 * 塞了「未登录提示 / 资料卡 / tab 区 / 按钮组」四种情况，全靠三元表达式在
 * 字符串中间换分支。现在按「未登录 / 他人 / 本人」三种视图拆开。
 *
 * 不能改的行为：
 *   1. 布局根节点的 class 是二选一的：本人 `profile-layout`（左摘要 + 右 tab），
 *      他人 `public-profile`（只有摘要卡）。这个 class 决定 CSS 布局，不能合并。
 *   2. `tab()` 里是「先建一个空 section 顶掉旧的，再往新 section 里渲染」。
 *      不能改成直接改旧节点的 innerHTML —— 切 tab 时 region 的 loading 骨架
 *      会和上一次请求的回填撞车，旧 section 已经从文档里摘掉了。
 *   3. 切 tab 时 `aria-selected` 和 `tabIndex` 要一起改（后者让键盘左右键能走），
 *      顺序在 `bindTabs` 之前同步设一次。
 *   4. 初始 tab 由 `location.hash` 决定（#security / #exam），这是外部链接进来的
 *      唯一入口，别改成读 query。
 *   5. 市民卡 SVG 里 `p.created_at.slice(0, 10)` 没做空值保护 —— 服务端保证有值，
 *      这里原样保留，不擅自加兜底（加了会改变缺字段时的行为）。
 */

import { tabsMarkup, bindTabs } from '../../../ui/workspace.js';
import { renderSurvey } from '../../exam-survey.js';
import { createTicket, viewCitizenTicket } from '../../ticket-form.js';
// v84：直连 home 的真实模块，不再绕 v79 兼容转发层 home.js。
import { signin } from '../home/signin.js';
import { security as renderSecurityTab } from './security.js';
import { $, $$, api, post, patch, del, region, esc, text, ticketBody, date, status, empty, title, field, modal, action, toast, state, login, download, imageUrl } from '../../core.js';
import { parseDate } from '../../../date.js';

/** 本人可见的 6 个 tab，顺序即显示顺序 */
const TAB_LIST = [
  ['history', '我的记录'],
  ['security', '账号安全'],
  ['race', '赛道成绩'],
  ['exam', '模拟考试'],
  ['subscriptions', '通知订阅'],
  ['rewards', '工单奖励'],
];

/** 「来了 N 天」。没登录就只给一个登录按钮。 */
function guestMarkup() {
  return (
    '<div class="panel"><p>先报上名字，市政厅才认得你是谁，才能调出档案。</p>' +
    '<button id="profile-login">我是市民</button></div>'
  );
}

/** 左侧资料卡。self 与否只影响底部按钮组。 */
function summaryMarkup(p, d, self, days) {
  const actions = self
    ? '<a class="button" href="/affairs.html">我的事务</a>' +
      '<button id="profile-passkeys">通行密钥</button>' +
      '<button id="edit-profile">改资料</button>' +
      '<button id="citizen-card">下载市民卡</button>' +
      '<button id="daily-signin">🎁 签到</button>'
    : `<a class="button" href="/dm.html?to=${encodeURIComponent(p.username)}">发私信</a>`;

  return (
    '<aside class="profile-summary panel">' +
    '<div class="row-head"><div>' +
    `<span class="avatar">${esc(p.avatar_emoji || '👤')}</span>` +
    `<h2>${esc(p.username)}</h2></div>` +
    `<span class="badge">来了 ${days} 天</span></div>` +
    `<p>${text(p.bio || '这位市民还没写简介。')}</p>` +
    `<small>登记于 ${date(p.created_at)}</small>` +
    '<div class="stats">' +
    `<div class="stat"><strong>${d.stats.messages}</strong><span>留言</span></div>` +
    `<div class="stat"><strong>${d.stats.comments}</strong><span>评论</span></div>` +
    '</div>' +
    `<div class="actions">${actions}</div>` +
    '</aside>'
  );
}

/** 市民身份卡 SVG。纯本地生成，不发任何请求。 */
function citizenCardSvg(p) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540">' +
    '<rect width="900" height="540" fill="#fff8dd"/>' +
    '<rect x="20" y="20" width="860" height="500" fill="none" stroke="#333323" stroke-width="8"/>' +
    '<path d="M20 130H880" stroke="#496a20" stroke-width="8"/>' +
    '<g fill="#496a20" font-family="sans-serif">' +
    '<text x="60" y="90" font-size="38">灯光市 · 市民身份卡</text>' +
    `<text x="60" y="240" font-size="48">${esc(p.username)}</text>` +
    `<text x="60" y="320" font-size="28">市民编号 #${p.id}</text>` +
    `<text x="60" y="390" font-size="24">加入日期 ${esc(p.created_at.slice(0, 10))}</text>` +
    '<text x="60" y="460" font-size="20">Minecraft 城市作品纪念卡，不是身份证件</text>' +
    '</g></svg>'
  );
}

export async function render(el) {
  const username =
    new URLSearchParams(location.search).get('u') || state.session?.player?.username;

  if (!username) {
    // 「市民主页」是**还没报上名字**时的标题，下面才是真正调出档案后的
    // 「市民档案」。两个状态文案不同，别合并 —— 未登录进来看到「市民档案」
    // 会以为已经有档案了，其实只是没登录。
    el.innerHTML = title('市民主页') + guestMarkup();
    $('#profile-login', el).onclick = async () => {
      await login();
      if (state.session?.player) render(el);
    };
    return;
  }

  const d = await api('/api/social?action=profile&username=' + encodeURIComponent(username));
  const p = d.profile;
  const self = p.id === state.session?.player?.id;

  const joined = +parseDate(p.created_at);
  const days = Number.isFinite(joined)
    ? Math.max(0, Math.floor((Date.now() - joined) / 86400000))
    : 0;

  // 他人档案只有摘要卡；本人才有右侧 tab 区。这个 class 是 CSS 布局的开关
  const workspace = self
    ? '<div class="profile-workspace">' +
      tabsMarkup(
        TAB_LIST.map(([key, zh]) => ({ key, label: zh })),
        'history',
        { id: 'profile-tabs', label: '市民档案', panelId: 'profile-content' }
      ) +
      '<section id="profile-content" class="panel"></section></div>'
    : '';

  el.innerHTML =
    title('市民档案') +
    `<div class="${self ? 'profile-layout' : 'public-profile'}">` +
    summaryMarkup(p, d, self, days) +
    workspace +
    '</div>';

  if (!self) return;

  bindProfileActions(el, p);

  async function tab(key) {
    $$('[data-tab-key]', el).forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tabKey === key));
      b.tabIndex = b.dataset.tabKey === key ? 0 : -1;
    });

    // 用一个全新的 section 顶掉旧的：旧的已经摘出文档，里面可能还有在飞的请求，
    // 直接复用会让上一次 region 的回填写进新 tab 的面板
    const old = $('#profile-content', el);
    const box = document.createElement('section');
    box.id = 'profile-content';
    box.setAttribute('role', 'tabpanel');
    box.setAttribute('aria-labelledby', 'profile-tabs-' + key);
    box.className = 'panel';
    old.replaceWith(box);

    await region(box, async () => key, (k, target) => TAB_RENDERERS[k](target));
  }

  bindTabs($('#profile-tabs', el), tab);
  $('#profile-passkeys', el).onclick = () => tab('security');
  await tab(location.hash === '#security' ? 'security' : location.hash === '#exam' ? 'exam' : 'history');
}

/** 资料卡上的五个按钮 */
function bindProfileActions(el, p) {
  $('#edit-profile', el).onclick = () =>
    modal(
      '改一改资料',
      field('avatar_emoji', '头像', 'text', p.avatar_emoji) +
        field('bio', '个人简介', 'textarea', p.bio || '', { required: false, maxlength: 500 }),
      {
        submit: async (values) => {
          await patch('/api/social?action=me', values);
          await render(el);
        },
      }
    );

  $('#daily-signin', el).onclick = (e) => action(e.currentTarget, signin);

  $('#citizen-card', el).onclick = () => {
    download('light-city-citizen.svg', citizenCardSvg(p), 'image/svg+xml');
  };
}

/** tab key → 渲染函数。放在文件下方，先声明后用。 */
const TAB_RENDERERS = {
  history: renderHistory,
  security: renderSecurityTab,
  race: renderRace,
  exam: renderExam,
  subscriptions: renderSubscriptions,
  rewards: renderRewards,
};

// ----- tab renderers ----------------------------------------------------

/** 「我的记录」：6 个来源各发一个 /api/<k>?my=1，并行拉、并行画 */
const HISTORY_SECTIONS = [
  ['messages', '我的留言'],
  ['bookings', '酒店预订'],
  ['kart', '卡丁车'],
  ['circuit', '国际试车'],
  ['license', '驾照报名'],
  ['tickets', '事务工单'],
];

/** 一条历史记录。不同来源字段名不统一，按优先级依次兜。 */
function historyRow(r, k) {
  const title = r.room_name || r.title || r.exam_type || r.session || '#' + r.id;
  const body = r.body ? ticketBody(r.body) : text(r.content || r.note || '');
  const reply = r.admin_reply ? `<div class="notice">${text(r.admin_reply)}</div>` : '';
  const stay = r.in_date ? `<p>${esc(r.in_date)} → ${esc(r.out_date)}</p>` : '';
  // 只有工单能点进去补材料
  const open = k === 'tickets'
    ? '<div class="actions">' +
      `<button data-ticket="${esc(r.id)}">详情与补材料 ${r.attachment_count ? '📎 ' + r.attachment_count : ''}</button>` +
      '</div>'
    : '';

  return (
    '<div class="row"><div class="row-head">' +
    `<b>${esc(title)}</b>${status(r.status)}</div>` +
    `<div>${body}</div>${reply}${stay}` +
    `<small>${date(r.created_at)}</small>${open}</div>`
  );
}

async function renderHistory(el) {
  el.innerHTML = HISTORY_SECTIONS.map(
    ([k, zh]) => `<section class="section"><h3>${zh}</h3><div id="history-${k}"></div></section>`
  ).join('');

  // 六个来源互不依赖，一次性全发出去，别串行等
  await Promise.all(
    HISTORY_SECTIONS.map(([k]) =>
      region($('#history-' + k, el), () => api('/api/' + k + '?my=1'), (d, box) => {
        const rows = d[k] || d.signups || [];
        box.innerHTML = rows.map((r) => historyRow(r, k)).join('') || empty();

        $$('[data-ticket]', box).forEach((button) => {
          button.onclick = () =>
            viewCitizenTicket(button.dataset.ticket, { onChanged: () => renderHistory(el) }).catch(
              (e) => toast(e.message, true)
            );
        });
      })
    )
  );

  el.insertAdjacentHTML('beforeend', '<button id="service-ticket">再交一单</button>');
  $('#service-ticket', el).onclick = () =>
    createTicket({ onCreated: () => renderHistory(el) }).catch((e) => toast(e.message, true));
}

async function renderRace(el) {
  const b = await api('/api/homepage-bundle');
  const tracks = b.bundle.tracks.filter((t) => t.is_active);

  // 一条赛道都没有时按钮直接禁用，省得点开才报错
  el.innerHTML =
    '<h3>赛道成绩</h3>' +
    `<button id="report-race" ${tracks.length ? '' : 'disabled'}>＋ 报成绩</button>` +
    '<div id="race-history" class="section"></div>';

  $('#report-race', el).onclick = () =>
    modal(
      '报圈速',
      field('track_id', '赛道', 'select', tracks[0].id, { options: tracks.map((t) => [t.id, t.name]) }) +
        field('time', '圈速（分:秒.毫秒）', 'text', '1:23.456') +
        field('kart_name', '车型', 'text', '', { required: false }) +
        field('license_grade', '驾照', 'select', 'B', { options: ['B', 'A'] }),
      {
        submit: async (d) => {
          // 只接受 m:ss.mmm，秒必须是两位且 <60
          const m = /^(\d+):([0-5]\d)\.(\d{3})$/.exec(d.time);
          if (!m) throw new Error('时间得写成 1:23.456 这样');
          await post('/api/race-times', {
            ...d,
            time_ms: (+m[1] * 60 + +m[2]) * 1000 + +m[3],
          });
          await renderRace(el);
        },
      }
    );

  region($('#race-history', el), () => api('/api/race-times?my=1'), (d, box) => {
    box.innerHTML =
      d.times
        .map(
          (r) =>
            `<div class="row">${esc(r.track_name)} · <b>${esc(r.formatted)}</b> ${r.verified ? '已核实' : '待核实'}</div>`
        )
        .join('') || empty();
  });
}

async function renderExam(el) {
  await renderSurvey(el);
}

/** 通知订阅：三类各一个开关。已订阅的按钮变成「取消订阅」并带上 id。 */
async function renderSubscriptions(el) {
  const d = await api('/api/subscriptions?my=1');
  const labels = [
    ['announcement', '市政公告'],
    ['reply', '留言回复'],
    ['dm', '新私信'],
  ];

  el.innerHTML =
    '<h3>想收哪些提醒</h3>' +
    labels
      .map(([type, zh]) => {
        const s = d.subscriptions.find((s) => s.type === type && s.enabled);
        return (
          '<div class="row row-head"><span>' + zh + '</span>' +
          `<button data-type="${type}" data-id="${s?.id || ''}">` +
          `${s ? '取消订阅' : '订阅'}</button></div>`
        );
      })
      .join('');

  $$('[data-type]', el).forEach((b) => {
    b.onclick = (e) =>
      action(e.currentTarget, async () => {
        // 有 id 说明是取消，没有就是新建
        if (b.dataset.id) await del('/api/subscriptions?id=' + b.dataset.id);
        else await post('/api/subscriptions', { type: b.dataset.type, channel: 'site' });
        await renderSubscriptions(el);
      });
  });
}

async function renderRewards(el) {
  await region(el, () => api('/api/rewards?my=1'), (d, box) => {
    box.innerHTML =
      '<h3>办完事的奖励</h3>' +
      (d.rewards
        .map(
          (r) =>
            '<div class="row">' +
            `<b>+${r.amount} 💎</b> · 工单 #${esc(r.ticket_ref)}` +
            `<p>承办人 #${r.admin_id} · ${date(r.paid_at || r.created_at)}</p></div>`
        )
        .join('') || empty());
  });
}
