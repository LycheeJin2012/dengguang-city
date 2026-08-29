// v45 重写: hero 云朵视差 (装饰用, 不阻塞主交互)
import { $ } from './util.js?v=v46-fix-modules';

export function bindClouds() {
  const clouds = document.querySelectorAll('.cloud');
  if (!clouds.length) return;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      clouds.forEach((c, i) => {
        c.style.transform = `translateY(${y * (0.05 + i * 0.02)}px) scale(var(--s,1))`;
      });
      ticking = false;
    });
  }, { passive: true });
}
