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
import {$,$$,api,region,esc,text,empty,modal,imageUrl,action,date,login} from '../../core.js'
// v84：直连 hotel 的真实模块，不再绕 v79 兼容转发层 hotel.js。
import { roomCards } from '../hotel/rooms.js';
import { signup } from './signup.js';
import { signin } from './signin.js';

function section(id, zh, footer = '') {
  return `<section class="section" id="${id}">${sectionHeading(zh)}<div id="${id}-body"></div>${footer}</section>`;
}

// v84：signup / signin 不再从本模块再导出；需要它们请直连
// pages/home/signup.js 与 pages/home/signin.js。

export async function render(el) {
  // v87：城市数据从右侧 260px 侧栏搬进 hero，压在配图底部做成 HUD 条带。
  // 中间试过一版把 6 项数据塞进文案栏右侧的空地，结果 hero 被撑到近 900px
  // 高，首屏被自己顶出去。改成压在图上之后文案栏恢复原来的紧凑高度，
  // 数据仍然在第一屏，而且「和图片堆叠」正好是这张图该有的用法。
  el.innerHTML = `<section class="city-welcome" id="home"><div class="welcome-copy"><div class="welcome-lead"><p class="eyebrow">WELCOME TO LIGHT CITY</p><h1>欢迎来到<br>灯光市</h1><p>一座市民自己动手搭起来的 Minecraft 城。公告在这儿发，事务在这儿办，建成什么样全靠大家。</p><div class="actions"><a class="button primary" href="#notice">看市政公告 ↗</a><button id="signin">🎁 每日签到</button></div></div></div><div class="welcome-figure"><img src="/assets/backgrounds/bg-pixel-hero.jpg" alt="灯光市 Minecraft 城市实景"><div class="welcome-stats" id="city-stats"></div></div></section><div class="home-workspace"><div class="home-primary">${section(
    'notice',
    '📜 市政公告'
  )}${section('contact', '💬 留言与工单')}</div></div><div class="home-gallery">${section(
    'gallery',
    '📸 城市风貌'
  )}</div><div class="home-services">${section(
    'hotel',
    '🏨 树上酒店',
    `<div class="actions"><a class="button" href="/hotel.html">看全部房型 →</a></div>`
  )}${section('racing', '🏁 赛道与驾照')}</div>`;
  $('#signin', el).onclick = (e) => action(e.currentTarget, signin);
  const bundle = api('/api/homepage-bundle');
  region($('#city-stats', el), () => bundle, (d, box) => {
    box.innerHTML = `<div class="stats"><div class="stat"><strong>${d.bundle.playerCount ?? 0}</strong><span>登记市民</span></div><div class="stat"><strong>30+</strong><span>绿化区块</span></div><div class="stat"><strong>50+</strong><span>建筑群</span></div><div class="stat"><strong>1500+m</strong><span>铁轨</span></div><div class="stat"><strong>1000+m</strong><span>公路</span></div><div class="stat"><strong>2023</strong><span>建市年份</span></div></div>`;
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
      : empty('市政公告会贴在这儿，暂时还空着');
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
      ['kart', '🛞 卡丁车'],
      ['circuit', '🏎️ 国际赛车场'],
      ['license', '🚗 驾照考试'],
    ]
      .map(
        ([k, zh]) =>
          `<article class="card"><h3>${zh}</h3><p>${
            k === 'license'
              ? '先看看考什么，过了再上路。'
              : '挑个场次和车，把申请递上来。'
          }</p><div class="actions"><button data-signup="${k}" class="primary">去报名</button></div></article>`
      )
      .join('')}</div><div class="panel stack-top-lg"><h3>赛道与考试要求</h3>${d.bundle.tracks
      .map(
        (t) =>
          `<p><b>${esc(t.name)}</b> · ${t.length_km ?? '—'} km · 💎 ${t.trial_price} /次</p>`
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