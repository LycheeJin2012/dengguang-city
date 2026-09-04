// v50: 云朵背景 (v49 §15 风格, JS 端只挂随机扰动 / 视差)
import { $ } from './util.js?v=20260905-v50-0';

export function bindClouds() {
  // 简单视差: 滚动时 clouds 轻微位移
  let ticking = false;
  document.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      document.querySelectorAll('.cloud').forEach((c, i) => {
        const k = (i + 1) * 0.1;
        c.style.transform = `translate3d(0, ${y * k}px, 0)`;
      });
      ticking = false;
    });
  }, { passive: true });
}
