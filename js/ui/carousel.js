/**
 * 城市风貌轮播（首页「城市风貌」区块）。
 *
 * 原来这个文件 34 行、最长行 537 字符：`draw()` 里同时做了「暂停按钮状态」、
 * 「同图跳过」、「预加载」、「比例计算」、「失败降级」五件事；`setInterval` 的
 * 回调里还压着一长串自动播放的前置条件。现在拆成「骨架 / 画一张 / 自动播放
 * 条件」三块。
 *
 * 这个组件的复杂度几乎全在竞态上，下面四个守卫一个都不能动：
 *   1. `requestId` 是一次性的 epoch。`draw()` 一进来就 `++requestId`，之前挂在
 *      `Image.onload` 上的旧回调回来时 `id !== requestId`，直接丢弃。
 *      没有它，快速连点下一张会用小图的尺寸覆盖大图的（乱序回填）。
 *   2. **同图早退也要先 `++requestId`**。已经在显示这一张时 draw() 会提前
 *      return，但必须先把上一轮还没回来的预加载作废，否则它回来后会覆盖。
 *   3. `onload` / `onerror` 都要判 `el.isConnected`：轮播被 innerHTML 换掉后
 *      还在跑的定时器 / 回调不该再往旧节点写。
 *   4. `setInterval` 发现 `!el.isConnected` 时，要**同时**清掉自己、断开
 *      IntersectionObserver、摘掉 reduced-motion 监听。只 clearInterval 的话
 *      观察器和事件监听会一直挂在 document 上。
 *
 * 自动播放的前置条件（`userPlay || (!hover && !focus)`）也别"简化"：
 * 用户手动点过「开始轮播」之后（userPlay=true），鼠标悬停不再阻止播放；
 * 但系统自动播放时，悬停或键盘焦点在轮播里就停 —— 免得正在看时被抽走。
 */

/** 轮播外壳。按钮和状态行的结构固定，只填文字。 */
const CAROUSEL_MARKUP =
  '<section class="city-carousel" aria-label="城市风貌轮播">' +
  '<button type="button" class="gallery-button carousel-image" aria-label="查看当前图片">' +
  '<img alt=""></button>' +
  '<div class="carousel-caption"><strong></strong><span data-position></span></div>' +
  '<p class="carousel-status" role="status" hidden></p>' +
  '<div class="actions">' +
  '<button type="button" data-prev aria-label="上一张">←</button>' +
  '<button type="button" data-play></button>' +
  '<button type="button" data-next aria-label="下一张">→</button>' +
  '</div></section>';

/** 环形取下标：负数也能正确回绕，长度为 0 时返回 0（tests/home-refinement 直接测它） */
export const slideIndex = (index, length) => (length ? ((index % length) + length) % length : 0);

/**
 * 挂载轮播。
 * @param {Element} el          挂载点
 * @param {Array}  items        候选项，只有 image_url 能解析成真 URL 的才进轮播
 * @param {object} opts
 * @param {(u:any)=>string} opts.imageUrl  图片地址解析器（core 提供，带白名单）
 * @param {(item:any)=>void}  opts.onOpen   点大图时的回调
 */
export function mountCarousel(el, items, { imageUrl, onOpen = () => {} } = {}) {
  // 没有可用图片就只留一句提示，不建轮播骨架
  const slides = items.filter((i) => imageUrl(i.image_url));
  if (!slides.length) {
    el.innerHTML = '<p class="notice">暂无记录</p>';
    return;
  }

  let requestId = 0;
  let shownIndex = -1;
  let userPlay = false;
  let index = 0;
  let inView = false;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // 只有一张图没得轮播；系统要求减少动效时也默认不动
  let paused = slides.length === 1 || reduced.matches;

  el.innerHTML = CAROUSEL_MARKUP;
  const root = el.firstElementChild;
  const img = root.querySelector('img');
  const toggle = root.querySelector('[data-play]');
  const status = root.querySelector('.carousel-status');

  function draw() {
    toggle.textContent = paused ? '开始轮播' : '暂停轮播';
    toggle.setAttribute('aria-pressed', String(!paused));

    // 已经在显示这一张：什么都不用换，但**必须先把上一轮预加载作废**
    if (shownIndex === index) {
      ++requestId;
      root.setAttribute('aria-busy', 'false');
      status.hidden = true;
      return;
    }

    const target = index;
    const id = ++requestId;
    const item = slides[target];
    const next = new Image();

    root.setAttribute('aria-busy', 'true');
    status.hidden = true;

    next.onload = () => {
      // 竞态守卫：期间又 draw 过（用户连点 / 定时器又跳了一张），这次结果作废
      if (id !== requestId || !el.isConnected) return;
      // 先按真实宽高比占位，避免图片加载前后布局跳动
      root.style.setProperty('--image-ratio', String(next.naturalWidth / next.naturalHeight));
      img.src = next.src;
      img.alt = item.title || '';
      img.width = next.naturalWidth;
      img.height = next.naturalHeight;
      shownIndex = target;
      root.querySelector('strong').textContent = item.title || '';
      root.querySelector('[data-position]').textContent = `${target + 1} / ${slides.length}`;
      root.setAttribute('aria-busy', 'false');
    };

    next.onerror = () => {
      if (id !== requestId || !el.isConnected) return;
      // 加载失败就停下自动播放并给出提示，否则会一直对着坏图空转
      paused = true;
      userPlay = false;
      root.setAttribute('aria-busy', 'false');
      status.textContent = '图片加载失败，请切换图片或稍后重试';
      status.hidden = false;
      toggle.textContent = '开始轮播';
      toggle.setAttribute('aria-pressed', 'false');
    };

    next.src = imageUrl(item.image_url);
  }

  /** 移动 delta 张。manual=true 表示用户自己点的，此时一定要暂停自动播放。 */
  function move(delta, manual = false) {
    if (manual) {
      paused = true;
      userPlay = false;
    }
    index = slideIndex(index + delta, slides.length);
    draw();
  }

  root.querySelector('[data-prev]').onclick = () => move(-1, true);
  root.querySelector('[data-next]').onclick = () => move(1, true);
  toggle.onclick = () => {
    paused = !paused;
    userPlay = !paused;
    draw();
  };
  root.querySelector('.carousel-image').onclick = () => {
    // shownIndex >= 0 才说明确实有一张已经显示出来了
    if (shownIndex >= 0) onOpen(slides[shownIndex]);
  };

  // 滚出视口就不自动播，省得没人看时也在换图
  const observer = new IntersectionObserver((entries) => {
    inView = entries[0]?.isIntersecting;
  });
  observer.observe(root);

  // 用户在系统里改了「减少动效」偏好后，正在播的立刻停下来
  const stopForPreference = () => {
    if (reduced.matches) {
      paused = true;
      draw();
    }
  };
  reduced.addEventListener?.('change', stopForPreference);

  const timer = setInterval(() => {
    // 容器已经被换掉：把自己和所有监听一起收干净，不能只停定时器
    if (!el.isConnected) {
      clearInterval(timer);
      observer.disconnect();
      reduced.removeEventListener?.('change', stopForPreference);
      return;
    }
    // 下面五个条件缺一不可，少一个就会出现「正在看却被抽走」或后台空转
    if (
      !paused &&
      inView &&
      document.visibilityState === 'visible' &&
      (userPlay || (!root.matches(':hover') && !root.contains(document.activeElement))) &&
      !document.querySelector('dialog[open]')
    ) {
      move(1);
    }
  }, 5000);

  draw();
  // 只有一张图时把翻页/播放按钮整条藏掉
  if (slides.length === 1) root.querySelector('.actions').hidden = true;
}
