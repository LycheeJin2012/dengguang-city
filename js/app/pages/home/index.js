/**
 * Home page workspace.
 *
 * v79 拆分自原 js/app/home.js (95 行)：
 *   - signup → ./signup.js
 *   - signin → ./signin.js
 *   - section / render → 本文件
 *
 * 依赖路径相应上移一级。
 */

import { mountCarousel } from '../../../ui/carousel.js';
import { recordCard } from '../../../ui/card.js';
import { sectionHeading } from '../../../ui/workspace.js';
import { renderTicketCenter } from '../../ticket-center.js';
import {
  $,
  $$,
  api,
  region,
  tr,
  esc,
  text,
  empty,
  modal,
  imageUrl,
  action,
  date,
  login,
} from '../../core.js';
// v84：直连 hotel 的真实模块，不再绕 v79 兼容转发层 hotel.js。
import { roomCards } from '../hotel/rooms.js';
import { signup } from './signup.js';
import { signin } from './signin.js';

function section(id, zh, en, footer = '') {
  return `<section class="section" id="${id}">${sectionHeading(tr(zh, en))}<div id="${id}-body"></div>${footer}</section>`;
}

// v84：signup / signin 不再从本模块再导出；需要它们请直连
// pages/home/signup.js 与 pages/home/signin.js。

export async function render(el) {
  el.innerHTML = `<section class="city-welcome" id="home"><div class="welcome-copy"><p class="eyebrow">WELCOME TO LIGHT CITY</p><h1>${tr(
    '欢迎来到<br>灯光市',
    'Welcome to<br>Light City'
  )}</h1><p>${tr(
    '一座由市民共同建设的 Minecraft 城市。在这里了解市政动态，办理市民事务，记录属于我们的城市生活。',
    'A Minecraft city built together. Discover city news, access citizen services, and take part in our shared story.'
  )}</p><div class="actions"><a class="button primary" href="#notice">${tr(
    '查看市政公告',
    'City announcements'
  )} ↗</a><button id="signin">🎁 ${tr('每日签到', 'Check in')}</button></div></div><img src="/assets/backgrounds/bg-pixel-hero.jpg" alt="${tr(
    '灯光市 Minecraft 城市实景',
    'Light City Minecraft panorama'
  )}"></section><div class="home-workspace"><div class="home-primary">${section(
    'notice',
    '📜 市政公告',
    '📜 Announcements'
  )}${section('contact', '💬 留言与工单', '💬 Messages & tickets')}</div><aside class="home-data"><div id="city-stats"></div></aside></div><div class="home-gallery">${section(
    'gallery',
    '📸 城市风貌',
    '📸 Around the city'
  )}</div><div class="home-services">${section(
    'hotel',
    '🏨 树上酒店',
    '🏨 Treehouse hotel',
    `<div class="actions"><a class="button" href="/hotel.html">${tr(
      '查看全部房型',
      'Browse all rooms'
    )} →</a></div>`
  )}${section('racing', '🏁 赛道与驾照', '🏁 Racing & licenses')}</div>`;
  $('#signin', el).onclick = (e) => action(e.currentTarget, signin);
  const bundle = api('/api/homepage-bundle');
  region($('#city-stats', el), () => bundle, (d, box) => {
    box.innerHTML = `<div class="stats"><div class="stat"><strong>${d.bundle.playerCount ?? 0}</strong><span>${tr(
      '注册市民',
      'Citizens'
    )}</span></div><div class="stat"><strong>30+</strong><span>${tr(
      '绿化区块',
      'Green spaces'
    )}</span></div><div class="stat"><strong>50+</strong><span>${tr(
      '建筑',
      'Buildings'
    )}</span></div><div class="stat"><strong>1500+m</strong><span>${tr(
      '铁路',
      'Railway'
    )}</span></div><div class="stat"><strong>1000+m</strong><span>${tr(
      '公路',
      'Roads'
    )}</span></div><div class="stat"><strong>2023</strong><span>${tr(
      '建市年份',
      'Founded'
    )}</span></div></div>`;
  });
  region($('#notice-body', el), () => api('/api/announcements'), (d, box) => {
    box.innerHTML = d.announcements.length
      ? `<div class="bulletin-list">${d.announcements
          .map((a) =>
            recordCard({
              className: 'bulletin',
              title: a.title,
              meta: `<small>${date(a.created_at)}</small>`,
              media: imageUrl(a.image_url)
                ? `<img src="${esc(imageUrl(a.image_url))}" alt="" loading="lazy">`
                : '',
              body: `<p>${text(a.content)}</p>`,
            })
          )
          .join('')}</div>`
      : empty(tr('市政公告将在这里发布', 'City announcements will appear here'));
  });
  region($('#gallery-body', el), () => api('/api/gallery'), (d, box) =>
    mountCarousel(box, d.items || [], {
      imageUrl,
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
    box.innerHTML = `<div class="cards">${[
      ['kart', '🛞 卡丁车', '🛞 Karting'],
      ['circuit', '🏎️ 国际赛车场', '🏎️ Circuit'],
      ['license', '🚗 驾照考试', '🚗 Driving licenses'],
    ]
      .map(
        ([k, zh, en]) =>
          `<article class="card"><h3>${tr(zh, en)}</h3><p>${k === 'license' ? tr('查看考试要求并提交报名。', 'Read the requirements and apply.') : tr('选择场次和车型，向市政厅提交试跑申请。', 'Choose your session and vehicle to apply.')}</p><div class="actions"><button data-signup="${k}" class="primary">${tr(
            '报名',
            'Apply'
          )}</button></div></article>`
      )
      .join('')}</div><div class="panel stack-top-lg"><h3>${tr(
      '赛道信息与考试要求',
      'Tracks and exam requirements'
    )}</h3>${d.bundle.tracks
      .map(
        (t) =>
          `<p><b>${esc(t.name)}</b> · ${t.length_km ?? '—'} km · 💎 ${t.trial_price} ${tr('/次', '/trial')}</p>`
      )
      .join('')}${d.bundle.licenseReqs
      .map((r) => `<div class="row"><b>${esc(r.title)}</b><p>${text(r.requirements || r.description)}</p></div>`)
      .join('') || ''}</div>`;
    $$('[data-signup]', box).forEach((b) =>
      b.onclick = (e) => action(e.currentTarget, () => signup(b.dataset.signup, d.bundle))
    );
  });
  region($('#hotel-body', el), () => bundle, (d, box) => roomCards(box, d.bundle, { limit: 3 }));
  if (new URLSearchParams(location.search).get('action') === 'login') {
    login();
  }
}