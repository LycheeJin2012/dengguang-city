// v45 重写: 滚动入场动画 (IntersectionObserver 加 .reveal-in)
import { $$ } from './util.js?v=v45-fix-401';

export function bindReveal() {
  const els = $$('.reveal');
  if (!els.length || !('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('reveal-in');
        obs.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
  els.forEach(el => obs.observe(el));
}
