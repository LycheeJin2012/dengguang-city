// v50: hero 区域 — stat 数字计数动画 + 浮动主题按钮 placeholder
import { $ } from './util.js?v=20260905-v50-0';

export function bindAll() {
  animateStats();
}
function animateStats() {
  // 监听 .stat 元素进入视口时, 让数字从 0 跳到目标值
  const stats = document.querySelectorAll('.stat b[data-stat]');
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const key = el.dataset.stat;
      fetch('/api/init?action=stats')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d || !d[key]) return;
          const v = String(d[key]);
          if (el.textContent !== v) el.textContent = v;
        })
        .catch(() => {});
      io.unobserve(el);
    });
  }, { threshold: 0.3 });
  stats.forEach(s => io.observe(s));
}
