/**
 * 首页：hero（含城市数据 HUD）+ 市政公告 + 城市风貌轮播 + 工单中心 + 赛道 + 酒店。
 *
 * 原来这个文件 108 行、最长行 714 字符：一根 `el.innerHTML = ...` 从 hero 一直
 * 排到酒店区，中间还嵌着 `section()` 的调用。现在按「骨架 / 五个 region」拆开。
 *
 * 不能改的行为：
 *   1. **一个 bundle 请求喂三个区块**。`const bundle = api('/api/homepage-bundle')`
 *      立刻发起，然后分别交给城市数据、赛道、酒店三个 region。api() 返回的是
 *      同一个 Promise，所以只发一次请求。改成三个独立 api() 会多打两次。
 *   2. 城市数据（`#city-stats`）压在 hero 配图底部是 v87 的设计决定：曾经把它
 *      放进文案栏右侧把 hero 撑到近 900px 高，首屏被顶出去了。别挪回去。
 *   3. 酒店区只取 3 个房型（`roomCards(box, d.bundle, { limit: 3 })`），完整列表
 *      在 /hotel.html。
 *   4. `?action=login` 是给「点了登录但没带 session」的场景兜底的，会在所有
 *      region 都挂上之后才弹。
 *   5. 赛道区的空数组保护只作用在 licenseReqs 上（`|| ''`），tracks 没有保护 ——
 *      服务端保证 tracks 一定有值，保持原样。
 */

import { mountCarousel } from '../../../ui/carousel.js';
import { recordCard } from '../../../ui/card.js';
import { sectionHeading } from '../../../ui/workspace.js';
import { renderTicketCenter } from '../../ticket-center.js';
import { $, $$, api, region, esc, text, empty, modal, imageUrl, action, date, login } from '../../core.js';
// v84：直连 hotel 的真实模块，不再绕 v79 兼容转发层 hotel.js。
import { roomCards } from '../hotel/rooms.js';
import { signup } from './signup.js';
import { signin } from './signin.js';

/** 一个内容区块：标题 + 空的 body 容器 + 可选页脚 */
function section(id, zh, footer = '') {
  return `<section class="section" id="${id}">${sectionHeading(zh)}<div id="${id}-body"></div>${footer}</section>`;
}

/** 整页骨架。hero 里的城市数据条由 #city-stats 稍后填。 */
function pageMarkup() {
  return (
    '<section class="city-welcome" id="home">' +
    '<div class="welcome-copy"><div class="welcome-lead">' +
    '<p class="eyebrow">WELCOME TO LIGHT CITY</p>' +
    '<h1>欢迎来到<br>灯光市</h1>' +
    '<p>一座市民自己动手搭起来的 Minecraft 城。公告在这儿发，事务在这儿办，建成什么样全靠大家。</p>' +
    '<div class="actions">' +
    '<a class="button primary" href="#notice">看市政公告 ↗</a>' +
    '<button id="signin">🎁 每日签到</button>' +
    '</div></div></div>' +
    '<div class="welcome-figure">' +
    '<img src="/assets/backgrounds/bg-pixel-hero.jpg" alt="灯光市 Minecraft 城市实景">' +
    // v87：数据压在配图底部做成 HUD 条带。挪进文案栏会把 hero 撑到近 900px 高
    '<div class="welcome-stats" id="city-stats"></div>' +
    '</div></section>' +
    '<div class="home-workspace"><div class="home-primary">' +
    section('notice', '📜 市政公告') +
    section('contact', '💬 留言与工单') +
    '</div></div>' +
    '<div class="home-gallery">' +
    section('gallery', '📸 城市风貌') +
    '</div>' +
    '<div class="home-services">' +
    section('hotel', '🏨 树上酒店', '<div class="actions"><a class="button" href="/hotel.html">看全部房型 →</a></div>') +
    section('racing', '🏁 赛道与驾照') +
    '</div>'
  );
}

/** hero 底部的六项城市数据 */
function cityStatsMarkup(playerCount) {
  return (
    '<div class="stats">' +
    `<div class="stat"><strong>${playerCount ?? 0}</strong><span>登记市民</span></div>` +
    '<div class="stat"><strong>30+</strong><span>绿化区块</span></div>' +
    '<div class="stat"><strong>50+</strong><span>建筑群</span></div>' +
    '<div class="stat"><strong>1500+m</strong><span>铁轨</span></div>' +
    '<div class="stat"><strong>1000+m</strong><span>公路</span></div>' +
    '<div class="stat"><strong>2023</strong><span>建市年份</span></div>' +
    '</div>'
  );
}

/** 一条市政公告卡 */
function announcementCard(a) {
  // 没有图就不出 img 标签，不要留一个空 src
  const media = imageUrl(a.image_url) ? `<img src="${esc(imageUrl(a.image_url))}" alt="" loading="lazy">` : '';
  return recordCard({
    className: 'bulletin',
    title: a.title,
    meta: `<small>${date(a.created_at)}</small>`,
    media,
    body: `<p>${text(a.content)}</p>`,
  });
}

/** 赛道 / 驾照三张报名卡 */
const RACING_CARDS = [
  ['kart', '🛞 卡丁车'],
  ['circuit', '🏎️ 国际赛车场'],
  ['license', '🚗 驾照考试'],
];

function racingCardsMarkup() {
  return (
    '<div class="cards">' +
    RACING_CARDS.map(([k, zh]) => {
      const desc = k === 'license' ? '先看看考什么，过了再上路。' : '挑个场次和车，把申请递上来。';
      return (
        `<article class="card"><h3>${zh}</h3><p>${desc}</p>` +
        `<div class="actions"><button data-signup="${k}" class="primary">去报名</button></div></article>`
      );
    }).join('') +
    '</div>'
  );
}

// v84：signup / signin 不再从本模块再导出；需要它们请直连
// pages/home/signup.js 与 pages/home/signin.js。

export async function render(el) {
  el.innerHTML = pageMarkup();

  $('#signin', el).onclick = (e) => action(e.currentTarget, signin);

  // 一次请求，三处复用：api() 返回同一个 Promise
  const bundle = api('/api/homepage-bundle');

  region($('#city-stats', el), () => bundle, (d, box) => {
    box.innerHTML = cityStatsMarkup(d.bundle.playerCount);
  });

  region($('#notice-body', el), () => api('/api/announcements'), (d, box) => {
    box.innerHTML = d.announcements.length
      ? `<div class="bulletin-list">${d.announcements.map(announcementCard).join('')}</div>`
      : empty('市政公告会贴在这儿，暂时还空着');
  });

  region($('#gallery-body', el), () => api('/api/gallery'), (d, box) =>
    mountCarousel(box, d.items || [], {
      imageUrl,
      // 点大图在弹窗里看原图
      onOpen: (g) =>
        modal(
          g.title,
          `<img class="gallery-original wide" src="${esc(imageUrl(g.image_url))}" alt="${esc(g.title)}">`,
          { wide: true }
        ),
    })
  );

  renderTicketCenter($('#contact-body', el));

  region($('#racing-body', el), () => bundle, (d, box) => {
    // tracks 服务端保证有值；licenseReqs 允许为空，所以这行有 `|| ''` 兜底
    const tracks = d.bundle.tracks
      .map((t) => `<p><b>${esc(t.name)}</b> · ${t.length_km ?? '—'} km · 💎 ${t.trial_price} /次</p>`)
      .join('');
    const reqs =
      d.bundle.licenseReqs
        .map((r) => `<div class="row"><b>${esc(r.title)}</b><p>${text(r.requirements || r.description)}</p></div>`)
        .join('') || '';

    box.innerHTML =
      racingCardsMarkup() +
      `<div class="panel stack-top-lg"><h3>赛道与考试要求</h3>${tracks}${reqs}</div>`;

    $$('[data-signup]', box).forEach((b) => {
      b.onclick = (e) => action(e.currentTarget, () => signup(b.dataset.signup, d.bundle));
    });
  });

  // 首页只放 3 个房型做预览，完整列表在 /hotel.html
  region($('#hotel-body', el), () => bundle, (d, box) => roomCards(box, d.bundle, { limit: 3 }));

  // 登录失败/中断时带 ?action=login 回来时的兜底
  if (new URLSearchParams(location.search).get('action') === 'login') login();
}
