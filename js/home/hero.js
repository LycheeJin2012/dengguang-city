// v45 重写: 首页 hero 区 (含 nav 滚动效果, 返回顶部, 数字动画)
import { $, $$, animateNumber, GET } from './util.js?v=v46-fix-modules';

export function bindNav() {
  const nav = $('#navbar');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 80);
  }, { passive: true });
}

export function bindBackTop() {
  const btn = $('#backTop');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 600);
  }, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

export function bindActiveNav() {
  const links = $$('.nav-links a');
  const sections = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if (!sections.length) return;
  const obs = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const id = '#' + e.target.id;
        links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === id));
      }
    }
  }, { rootMargin: '-30% 0px -60% 0px' });
  sections.forEach(s => obs.observe(s));
}

export async function loadHeroStats() {
  const statPlayers = $('[data-stat="players"]') || $('#statPlayers');
  // v50-fix-16: 城市数据看板的"注册市民"卡片也用同一份 bundle 数据
  //   之前 index.html 硬编码 17, API 实际返 8 (active 过滤后), 跟 hero 数字不一致
  const cardPlayers = $('[data-stat="players-card"]');
  if (!statPlayers && !cardPlayers) return;
  try {
    const d = await GET('/api/homepage-bundle', undefined);
    const bundle = d.bundle || {};
    const n = Number(bundle.playerCount || 0);
    const heroB = statPlayers?.querySelector('b');
    if (heroB) animateNumber(heroB, n);
    const cardB = cardPlayers;
    if (cardB) animateNumber(cardB, n);
  } catch (e) {
    // fallback: 显示 —
    const c1 = statPlayers?.querySelector('b'); if (c1) c1.textContent = '—';
    const c2 = cardPlayers; if (c2) c2.textContent = '—';
  }
}

export function bindAll() {
  bindNav();
  bindBackTop();
  bindActiveNav();
  loadHeroStats();
}
