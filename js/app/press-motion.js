/**
 * 按压手感 —— 纯视觉模块。不碰业务、不发请求、不写存储。
 *
 * ## 三条硬规则（都被测试钉死）
 *
 * 1. **绝不写 inline style。** 全程不用 `element.style.setProperty` /
 *    `removeProperty` 改 `transform`，也不用 `!important`。视觉状态完全由
 *    WAAPI Animation 对象持有，不用了就 `cancel()` 掉。所以元素原有的
 *    inline transform 永远原样保留。
 * 2. **该跳过就跳过。** `prefers-reduced-motion`、`:disabled`、
 *    `aria-disabled="true"`（含被禁 `<fieldset>` 里的控件，但第一个
 *    `<legend>` 的后代除外）一律不做空间动画。
 * 3. **危险操作全部 try/catch。** `animate()` 抛错、采样计算样式失败，
 *    都不许影响到点击和表单提交 —— 手感坏掉只是不动画，绝不能变成点不动。
 *
 * ## 状态放在哪
 *
 *   state            WeakMap：元素 → 本次按压的 slot
 *   activeByPointer  Map：pointerId → 元素（多指同时按压时定位用）
 *   activeElements   Set：当前所有按压中的元素（window blur 时逐个收回）
 *   globalGeneration 自增代号，用来作废旧 slot 的异步回调
 *
 * slot = { generation, pointerId, baseTransform, pressStartTime,
 *          pressAni, releaseAni, releaseTimer }
 *
 * ## 按下 press(el, pointerId)
 *
 *   1. 先滤掉 reduced-motion / disabled / 没有 `el.animate` 的元素。
 *   2. **在改动任何状态之前**采样当下的真实 transform（`live`）。新动画的
 *      from 帧必须等于眼睛此刻看到的位置，否则按下瞬间会跳一下。
 *   3. `baseTransform = prevSlot?.baseTransform || live`。基准值跨多次按压、
 *      跨松手动画一直保留 —— 元素永远回到最初那个基准，而不是上一次按下的
 *      那一帧（那样会逐次漂移）。
 *   4. **先**把按下动画构造出来。若 `el.animate` 抛错，此时我们还没碰过
 *      上一个 slot、没碰过三张表、没碰过样式，直接把上一个 slot 的记账
 *      （定时器、动画、状态项、指针映射）清干净就退出。
 *   5. 成功后才动上一个 slot：撤掉它的动画与定时器；如果它挂在**另一个**
 *      pointerId 下，删掉那条映射 —— 否则那根手指迟到的 pointerup 会把
 *      刚按下的 slot 提前松掉（多指泄漏的修法）。
 *   6. 记下 generation、pointerId、pressStartTime、pressAni。
 *
 * ## 抬起
 *
 * `pointerup` 之后按下动画**继续播放**，我们不暂停也不提前采样，只把收尾
 * 排到「距按满 DURATION_PRESS_MS 还差多少」毫秒之后 —— 哪怕只点了 2 毫秒，
 * 看到的也是完整的按下曲线。点击、聚焦、表单提交都不被延迟：监听器排完
 * 定时器就立刻返回。松手前还会核对 `slot.pointerId === event.pointerId`，
 * 多指重按留下的旧指针无法触发收尾。
 *
 * 延迟到期后（ease 收尾）：
 *   1. 核对 slot 的 generation 仍是当前值（重按会作废旧回调）。
 *   2. **此刻**再采样一次真实 transform —— 采样点是延迟回调，不是 pointerup
 *      那一刻。`fill: 'forwards'` 让按下效果一直停在按下帧。
 *   3. 撤掉按下效果。
 *   4. 若此时变成 reduced-motion 或 `animate` 没了，直接清理 slot。
 *   5. 新建一个从 live 回到 baseTransform 的动画，时长 DURATION_RELEASE_MS。
 *      若 `el.animate` 抛错就清理 slot —— 按下效果已经撤了，元素此刻就在
 *      底层计算样式上（也就是基准），只需删掉自己的记账。
 *   6. 收尾动画播完后把**已播完**的效果也 cancel 掉，不留 fill-forward 的
 *      Animation 挂在元素上，然后清理 slot。
 *
 * ## 取消路径（pointercancel、window blur、pointerleave 到控件外）
 *
 * 直接弹回基准：撤掉按下/收尾动画、清掉收尾定时器、清理 slot。不播收尾动画、
 * 不 linger，视觉上是立即的。pointercancel 同样先核对 pointerId。
 *
 * ## 清理
 *
 * 播完的 fill-forwards 动画会被 cancel，元素上不留任何 WAAPI 效果；
 * slot 从 state、activeByPointer、activeElements 三处一起摘掉。
 * window blur 时遍历 activeElements 逐个弹回。
 */

// ── 手感参数 ────────────────────────────────────────────────────────────
const SCALE = 0.974;
const TRANSLATE_Y_PX = 2;
const DURATION_PRESS_MS = 70;
const DURATION_RELEASE_MS = 240;
const EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/** 哪些元素算「可按压」。命中范围由 CSS 类名决定，改这里就要同步改样式表。 */
const PRESSABLE_SELECTOR = [
  'button',
  'a.button',
  '[role="button"]',
  'summary',
  '#menu',
  '#navigation a',
  '.tabs button',
  '.admin-nav button',
  '.modal-head [data-close]',
  '.gallery-button',
  '.stat',
  '.upload-drop',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
].join(', ');

// ── 运行时状态 ──────────────────────────────────────────────────────────
const state = new WeakMap();
const activeByPointer = new Map();
const activeElements = new Set();
let globalGeneration = 0;

// ── 环境探测 ────────────────────────────────────────────────────────────
// 每一步都可能失败（老浏览器、测试沙箱、页面正在卸载），失败一律退回最保守的答案。

/** 高精度时钟；拿不到就退回 Date.now()。 */
function now() {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch (_) {
    // 落到下面
  }
  return Date.now();
}

/** 用户是否要求减少动效。测不出来时按「不减少」处理，避免整站变成死板。 */
function reducedMotion() {
  try {
    return (
      typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch (_) {
    return false;
  }
}

/**
 * 元素是不是不可用。三道探针依次问，任一命中即为不可用：
 *
 *   1. `el.disabled` 属性 —— 覆盖 <button disabled>、<input disabled>，以及
 *      被禁 <fieldset> 里的所有表单控件（经典例外：第一个 <legend> 的后代
 *      不算 :disabled，这条交给第 2 道探针自己判断）。
 *   2. `:disabled` 伪类 —— 上面那个 legend 例外由它区分。
 *   3. `aria-disabled="true"` —— 覆盖 <a>、<span role=button>、<summary>
 *      这些伪类永远匹配不上的元素。
 */
function isDisabled(el) {
  if (!el) return true;
  try {
    if (el.disabled) return true;
  } catch (_) {
    // 没有这个属性，继续问下一道
  }
  try {
    if (typeof el.matches === 'function' && el.matches(':disabled')) return true;
  } catch (_) {
    // 同上
  }
  try {
    if (typeof el.getAttribute === 'function' && el.getAttribute('aria-disabled') === 'true') return true;
  } catch (_) {
    // 同上
  }
  return false;
}

/** 读元素此刻真实的 transform；读不到就当没有位移。 */
function getTransform(el) {
  try {
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (!cs) return 'none';
    const t = cs.transform;
    return t && t !== 'none' ? t : 'none';
  } catch (_) {
    return 'none';
  }
}

// ── 记账清理 ────────────────────────────────────────────────────────────
// 四个表里可能残留的东西：定时器、两个动画、指针映射、元素自身。

function tryCancel(ani) {
  if (!ani) return;
  try {
    ani.cancel();
  } catch (_) {
    // 动画已经结束或引擎已回收
  }
}

function clearTimer(timer) {
  if (!timer) return;
  try {
    clearTimeout(timer);
  } catch (_) {
    // 无所谓
  }
}

/** 只撤动画与定时器，**保留** slot 本身 —— 用在「即将被新 slot 顶替」的路上。 */
function clearSlotAnimations(s) {
  if (!s) return;
  clearTimer(s.releaseTimer);
  s.releaseTimer = null;
  tryCancel(s.pressAni);
  s.pressAni = null;
  tryCancel(s.releaseAni);
  s.releaseAni = null;
}

/** 彻底忘记这个 slot：三张表里都摘掉。 */
function forgetSlot(el, s) {
  if (s) {
    clearTimer(s.releaseTimer);
    tryCancel(s.pressAni);
    tryCancel(s.releaseAni);
    if (s.pointerId != null) {
      try {
        activeByPointer.delete(s.pointerId);
      } catch (_) {
        // 无所谓
      }
    }
  }
  try {
    state.delete(el);
  } catch (_) {
    // 无所谓
  }
  try {
    activeElements.delete(el);
  } catch (_) {
    // 无所谓
  }
}

// ── 按下 ────────────────────────────────────────────────────────────────

/** 在基准 transform 后面接上「按下去」的位移与缩放。 */
function pressedTransform(baseTransform) {
  const pressed = ` translateY(${TRANSLATE_Y_PX}px) scale(${SCALE})`;
  return baseTransform && baseTransform !== 'none' ? baseTransform + pressed : pressed.trimStart();
}

/** WAAPI 关键帧与参数只有两处用到，抽出来免得按下/收尾写歪。 */
const FILL_AND_BLEND = { fill: 'forwards', composite: 'replace' };

function press(el, pointerId) {
  try {
    if (reducedMotion() || isDisabled(el)) return;
    if (!el || typeof el.animate !== 'function') return;

    // 1) 先采样，再动状态：from 帧必须等于眼睛此刻看到的位置
    const live = getTransform(el);
    const prevSlot = state.get(el);

    // 2) 基准值跨重按保留，避免逐次漂移
    const baseTransform = (prevSlot && prevSlot.baseTransform) || live;

    // 3) 先构造新动画。失败时我们还没碰过任何东西，退出即可。
    //    注意绝不能在这里先 clearSlotAnimations —— 那样新动画一旦构造失败，
    //    上一次按压就被孤立了。
    let ani;
    try {
      ani = el.animate(
        [{ transform: live }, { transform: pressedTransform(baseTransform) }],
        { duration: DURATION_PRESS_MS, easing: EASING, ...FILL_AND_BLEND }
      );
    } catch (_) {
      // 构造失败：把上一个 slot 留下的记账清干净，三张表不留残渣。
      // 视觉自然回到元素原本的计算样式，inline style 一个字没动，
      // 点击 / 表单 / 聚焦都不受影响。
      if (prevSlot) forgetSlot(el, prevSlot);
      return;
    }

    // 4) 新动画到手，现在才动上一个 slot 的动画、定时器
    clearSlotAnimations(prevSlot);

    // 5) 上一个 slot 若挂在别的指针下，删掉那条映射。
    //    多指泄漏的修法：第二根手指按下去之后，第一根手指迟到的 pointerup
    //    不许把刚按下的 slot 松掉。
    if (prevSlot && prevSlot.pointerId != null && prevSlot.pointerId !== pointerId) {
      try {
        activeByPointer.delete(prevSlot.pointerId);
      } catch (_) {
        // 无所谓
      }
    }

    globalGeneration++;
    if (pointerId != null) {
      try {
        activeByPointer.set(pointerId, el);
      } catch (_) {
        // 无所谓
      }
    }
    try {
      activeElements.add(el);
    } catch (_) {
      // 无所谓
    }
    state.set(el, {
      generation: globalGeneration,
      pointerId: typeof pointerId === 'number' ? pointerId : null,
      baseTransform,
      pressStartTime: now(),
      pressAni: ani,
      releaseAni: null,
      releaseTimer: null,
    });
  } catch (_) {
    // 整条按下路径无害失败
  }
}

// ── 抬起 ────────────────────────────────────────────────────────────────

/**
 * 延迟到期后的收尾：把元素从当前真实位置缓动回基准。
 *
 * generation 是这个 slot 的身份证 —— 重按会作废旧回调。
 */
function doReleaseEase(el, generation) {
  try {
    const cur = state.get(el);
    if (!cur || cur.generation !== generation) return;
    cur.releaseTimer = null;

    if (reducedMotion() || typeof el.animate !== 'function') {
      // 不做空间动画：撤掉按下效果，元素自然停在底层计算样式（也就是基准）。
      // 不写 inline style，元素原有的 transform 完好无损。
      forgetSlot(el, cur);
      return;
    }

    // 1) 此刻才采样。采样点是延迟回调，不是 pointerup 那一刻 ——
    //    fill:'forwards' 让按下效果一直显示按下帧，所以这里读到的就是按下帧。
    const liveTransform = getTransform(el);

    // 2) 然后撤掉按下效果。视觉回到底层计算样式，收尾动画立刻接上来，
    //    它的 from 帧就是刚才采到的 liveTransform。
    tryCancel(cur.pressAni);
    cur.pressAni = null;

    // 3) 从 live 回到基准
    const baseTransform = cur.baseTransform || 'none';
    let ani;
    try {
      ani = el.animate(
        [{ transform: liveTransform }, { transform: baseTransform }],
        { duration: DURATION_RELEASE_MS, easing: EASING, ...FILL_AND_BLEND }
      );
    } catch (_) {
      // 收尾动画构造失败。按下效果已经撤了，元素此刻就在底层计算样式上，
      // 也就是基准，所以只需删掉自己的记账，让下一次交互从干净状态开始。
      forgetSlot(el, cur);
      return;
    }
    cur.releaseAni = ani;

    // 4) 播完把**已播完**的效果也 cancel，不让 fill-forward 的 Animation
    //    一直挂在元素上。然后清理 slot。
    if (ani.finished && typeof ani.finished.then === 'function') {
      ani
        .finished
        .then(() => {
          try {
            const c = state.get(el);
            if (c && c.releaseAni === ani && c.generation === generation) {
              tryCancel(ani);
              forgetSlot(el, c);
            }
          } catch (_) {
            // 无所谓
          }
        })
        .catch(() => {
          // 被 cancel 或被打断 —— 无害
        });
    }
  } catch (_) {
    // 整条收尾路径无害失败
  }
}

/**
 * 请求松手。
 *
 * 按下动画继续播，不暂停也不提前采样；只把收尾排到「按满 DURATION_PRESS_MS
 * 还差多少」之后，哪怕只点了 2 毫秒，看到的也是完整的按下曲线。
 * opts.lingerMs 可以强制指定（取消、blur 这些路径传 0）。
 */
function release(el, opts) {
  try {
    const s = state.get(el);
    if (!s) return;
    if (s.releaseTimer) {
      clearTimer(s.releaseTimer);
      s.releaseTimer = null;
    }

    let lingerMs;
    if (opts && typeof opts.lingerMs === 'number' && opts.lingerMs >= 0) {
      lingerMs = opts.lingerMs;
    } else {
      lingerMs = Math.max(0, DURATION_PRESS_MS - (now() - s.pressStartTime));
    }

    const generation = s.generation;
    if (lingerMs <= 0) {
      doReleaseEase(el, generation);
      return;
    }
    s.releaseTimer = setTimeout(() => doReleaseEase(el, generation), lingerMs);
  } catch (_) {
    // 无所谓
  }
}

/** 立即弹回基准：撤动画、清定时器、清 slot。不播收尾、不 linger。 */
function snap(el) {
  try {
    const s = state.get(el);
    if (!s) return;
    // 刻意**不**走 doReleaseEase —— snap 的语义就是立即。
    clearTimer(s.releaseTimer);
    s.releaseTimer = null;
    forgetSlot(el, s);
  } catch (_) {
    // 无所谓
  }
}

/** snap 的对外别名，保留是为了不破坏既有调用方与测试断言的导出面。 */
function cancelForElement(el) {
  try {
    snap(el);
  } catch (_) {
    // 无所谓
  }
}

/** window blur：把所有按压中的元素逐个弹回。 */
function releaseAllActive() {
  try {
    for (const el of Array.from(activeElements)) snap(el);
  } catch (_) {
    // 无所谓
  }
}

// ── 事件接线 ────────────────────────────────────────────────────────────

function findPressable(target) {
  try {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(PRESSABLE_SELECTOR);
  } catch (_) {
    return null;
  }
}

/**
 * 按指针取回「这次按压确实属于它」的 slot 所属元素。
 *
 * pointerup 与 pointercancel 都要先过这道关：多指重按可能在旧 pointerId 下
 * 留下一条陈旧映射，不核对当前 slot 的 pointerId 的话，那根手指迟到的
 * 事件会把刚按下的 slot 提前松掉或弹回。
 *
 * @returns 元素，或 null（这次事件不归我们管）
 */
function claimByPointer(pointerId) {
  if (pointerId == null) return null;
  const el = activeByPointer.get(pointerId);
  if (!el) return null;
  try {
    activeByPointer.delete(pointerId);
  } catch (_) {
    // 无所谓
  }
  const s = state.get(el);
  if (!s) return null;
  return s.pointerId === pointerId ? el : null;
}

function onPointerDown(e) {
  try {
    if (e && e.button !== undefined && e.button !== 0) return;
    const el = findPressable(e && e.target);
    if (!el || isDisabled(el)) return;
    press(el, e.pointerId);
  } catch (_) {
    // 无所谓
  }
}

function onDelegatedPointerUp(e) {
  try {
    if (!e) return;
    const el = claimByPointer(e.pointerId);
    if (el) release(el);
  } catch (_) {
    // 无所谓
  }
}

function onDelegatedPointerCancel(e) {
  try {
    if (!e) return;
    const el = claimByPointer(e.pointerId);
    if (el) snap(el);
  } catch (_) {
    // 无所谓
  }
}

function onPointerLeave(e) {
  try {
    if (!e) return;
    const el = findPressable(e.target);
    if (!el) return;
    // 指针只是移到同一个控件的子元素上，不算离开
    const related = e.relatedTarget;
    if (related && typeof el.contains === 'function' && el.contains(related)) return;
    snap(el);
  } catch (_) {
    // 无所谓
  }
}

function onBlur(e) {
  try {
    if (!e) return;
    const el = e.target;
    if (el && typeof el.matches === 'function' && el.matches(PRESSABLE_SELECTOR)) snap(el);
  } catch (_) {
    // 无所谓
  }
}

function onWindowBlur() {
  releaseAllActive();
}

/**
 * 全部用捕获阶段监听：事件必须在冒泡到按钮之前就拿到，
 * 否则页面里任何一个提前中止冒泡的处理器都能让按压手感失效。
 */
function install() {
  if (typeof document !== 'undefined') {
    try {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('pointerup', onDelegatedPointerUp, true);
      document.addEventListener('pointercancel', onDelegatedPointerCancel, true);
      document.addEventListener('pointerleave', onPointerLeave, true);
      document.addEventListener('blur', onBlur, true);
    } catch (_) {
      // 没有 document（比如 SSR / 测试环境），模块其余部分仍可用
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.addEventListener('blur', onWindowBlur);
    } catch (_) {
      // 同上
    }
  }
}

install();

/** 内部实现对外暴露，仅供测试断言契约；页面代码不要用。 */
export const __pressMotion = {
  SCALE,
  TRANSLATE_Y_PX,
  DURATION_PRESS_MS,
  DURATION_RELEASE_MS,
  EASING,
  PRESSABLE_SELECTOR,
  isDisabled,
  reducedMotion,
  press,
  release,
  snap,
  cancelForElement,
  state,
  activeByPointer,
  activeElements,
  doReleaseEase,
};
