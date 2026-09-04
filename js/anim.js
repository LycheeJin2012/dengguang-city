// v48: 通用动效 helper — 给动态渲染的 DOM 元素加入场动画
// 用法: import { animateIn } from './anim.js?v=v46-fix-modules';
//   animateIn(el)            // 单个元素 fade-in-up
//   animateIn(nodeList)      // 多个, 错开 0.05s
//   animateIn(el, { stagger: 100, anim: 'pop' })  // 100ms 错开, 用 pop 动画

const ANIMS = {
  fade: 'v48-anim-fade',
  'fade-up': 'v48-anim-fade-up',
  pop: 'v48-anim-pop',
  bounce: 'v48-anim-bounce',
  'slide-r': 'v48-anim-slide-r',
  shake: 'v48-anim-shake',
};

export function animateIn(els, opts = {}) {
  const stagger = opts.stagger ?? 50;
  const anim = opts.anim || 'fade-up';
  const cls = ANIMS[anim] || ANIMS['fade-up'];
  const arr = Array.from(els.length !== undefined ? els : [els]);
  arr.forEach((el, i) => {
    if (!el) return;
    // 跳过已经动画过的 (避免 re-render 时重复)
    if (el.dataset.v48Animated) return;
    el.dataset.v48Animated = '1';
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
if (typeof window !== 'undefined') {
  window.v48Anim = { animateIn, staggerIn, observeIn, openModal };
}

// v48.5: 统一 modal 打开动画 — 复用 v48-anim-pop 弹簧入场
// 每次打开都重新触发 (remove + reflow + add 强制重启动画)
export function openModal(mask, opts = {}) {
  if (!mask) return;
  // 1) 显示
  mask.style.display = '';
  document.body.style.overflow = 'hidden';
  // 2) 找内部 .modal 卡片, 重启动画
  const card = mask.querySelector('.modal, .modal-card, .signin-modal, .passkey-toast');
  const target = card || mask;
  const anim = opts.anim || 'v48-anim-pop';
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
