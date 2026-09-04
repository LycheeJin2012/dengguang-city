// v49: 通用动效 helper — 给动态渲染的 DOM 元素加入场动画
// 用法: import { animateIn } from './anim.js';
//   animateIn(el)                         // 单个元素 fade-in-up
//   animateIn(nodeList)                   // 多个, 错开 50ms
//   animateIn(el, { stagger: 100, anim: 'pop' })  // 100ms 错开, 用 pop 动画
//
// v49 简化:
//   - 只保留 fade-up + pop 两个核心动效 (v48 时代 6 个动效砍到 2 个)
//   - CSS 端的 .v49-stagger 容器已自动错开, JS 端只剩手动微调用

const ANIMS = {
  'fade-up': 'v49-fade-up',
  pop: 'v49-pop',
};

export function animateIn(els, opts = {}) {
  const stagger = opts.stagger ?? 50;
  const anim = opts.anim || 'fade-up';
  const cls = ANIMS[anim] || ANIMS['fade-up'];
  const arr = Array.from(els.length !== undefined ? els : [els]);
  arr.forEach((el, i) => {
    if (!el) return;
    // 跳过已经动画过的 (避免 re-render 时重复)
    if (el.dataset.v49Animated) return;
    el.dataset.v49Animated = '1';
    el.style.animationDelay = (i * stagger) + 'ms';
    el.classList.add(cls);
  });
}

// 一次性把某个容器下所有直接子元素做 stagger 入场
export function staggerIn(container, opts = {}) {
  if (!container) return;
  const children = container.children;
  if (!children.length) return;
  animateIn(children, opts);
}

// 元素进入视口时触发 (IntersectionObserver)
const _observer = ('IntersectionObserver' in window)
  ? new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const stagger = parseInt(e.target.dataset.stagger || '50', 10);
          const anim = e.target.dataset.anim || 'fade-up';
          animateIn(e.target, { stagger, anim });
          _observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '50px' })
  : null;

export function observeIn(el, opts = {}) {
  if (!_observer || !el) {
    // 不支持 IntersectionObserver, 直接显示
    animateIn(el, opts);
    return;
  }
  if (opts.stagger) el.dataset.stagger = String(opts.stagger);
  if (opts.anim) el.dataset.anim = opts.anim;
  _observer.observe(el);
}

// 全局 window 暴露 (admin 不用 ES module 时也能用)
// v49 主名 + v48 兼容别名 (旧 JS 可能还在 import v48Anim)
if (typeof window !== 'undefined') {
  window.v49Anim = { animateIn, staggerIn, observeIn, openModal, closeModal };
  window.v48Anim = window.v49Anim;  // 兼容
}

// v49: 统一 modal 打开动画 — 复用 v49-pop 弹簧入场
// 每次打开都重新触发 (remove + reflow + add 强制重启动画)
export function openModal(mask, opts = {}) {
  if (!mask) return;
  // 1) 显示
  mask.style.display = '';
  document.body.style.overflow = 'hidden';
  // 2) 找内部 .modal 卡片, 重启动画
  const card = mask.querySelector('.modal, .modal-card, .signin-modal, .passkey-toast');
  const target = card || mask;
  const anim = opts.anim || 'v49-pop';
  target.classList.remove(anim);
  void target.offsetWidth;  // 强制 reflow
  target.classList.add(anim);
  // 3) ESC 关闭 (可选, 默认开)
  if (opts.esc !== false) {
    const onEsc = (e) => {
      if (e.key === 'Escape' && mask.style.display !== 'none') {
        closeModal(mask);
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
  }
  // 4) 点击遮罩关闭 (可选)
  if (opts.backdrop !== false) {
    mask.addEventListener('click', e => {
      if (e.target === mask) closeModal(mask);
    }, { once: true });
  }
}

export function closeModal(mask) {
  if (!mask) return;
  mask.style.display = 'none';
  document.body.style.overflow = '';
}
