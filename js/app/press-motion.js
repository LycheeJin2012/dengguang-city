// Press Motion — pure-visual press-down / release-up motion for the
// §7 unified :active family. Zero business, zero network, zero
// storage, zero inline-style writes. The visual is owned exclusively
// by WAAPI Animations (`fill: 'forwards'`); we only ever cancel()
// our own effects, never edit `el.style.transform`.
//
// Press / release contract:
//   press(el, pointerId)
//     1. filter (reduced-motion, disabled, no el.animate)
//     2. sample live transform FIRST (so the from-frame matches what
//        the eye currently sees — no snap on re-press)
//     3. base = prevSlot?.baseTransform || live (preserve the
//        ORIGINAL base across re-presses so the element always
//        returns to where it started, not the last pressed frame)
//     4. el.animate(live → press(base)); on throw, cleanup prev slot
//        and bail — never touch inline style
//     5. on success: clear prev slot's anims + timer, drop any stale
//        pointerId, install new slot
//
//   pointerup → release(el)
//     - linger = max(0, 70ms - elapsed) so a 2 ms tap still shows
//       the full press curve; press animation keeps playing until
//       the callback fires. click / focus / form submit is never
//       delayed.
//
//   doReleaseEase (linger callback)
//     - verify generation (a re-press can bump it)
//     - sample live NOW, cancel press + any prior release animation
//     - el.animate(live → base) with fill: 'forwards'
//     - on finish, cancel the finished effect itself so no fill
//       remains, then clear the slot
//
//   snap(el) — pointercancel, blur, pointerleave-to-outside
//     - cancel every effect, clear every timer, clear the slot. No
//       release animation, no linger, no inline writes.
//
// On any failure: cancel own effects only; never edit inline style.

const SCALE = 0.974;
const TRANSLATE_Y_PX = 2;
const DURATION_PRESS_MS = 70;
const DURATION_RELEASE_MS = 240;
const EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
const NONE = 'none';

const PRESSABLE_SELECTOR = [
  'button', 'a.button', '[role="button"]', 'summary',
  '#menu', '#language', '#navigation a',
  '.tabs button', '.admin-nav button', '.modal-head [data-close]',
  '.gallery-button', '.stat', '.upload-drop',
  'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]',
].join(', ');

// state WeakMap: el -> { generation, pointerId, baseTransform,
//   pressStartTime, pressAni, releaseAni, releaseTimer }
const state = new WeakMap();
const activeByPointer = new Map();
const activeElements = new Set();
let generationCounter = 0;

// ---- helpers ---------------------------------------------------------------

const safe = (fn) => (...args) => { try { return fn(...args); } catch (_) {} };
const noop = () => {};

const now = () => {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch (_) {}
  return Date.now();
};

const reducedMotion = () => {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {
    return false;
  }
};

const getTransform = (el) => {
  try {
    const t = typeof getComputedStyle === 'function' ? getComputedStyle(el)?.transform : null;
    return (t && t !== NONE) ? t : NONE;
  } catch (_) {
    return NONE;
  }
};

const appendPress = (base) => {
  const tail = ` translateY(${TRANSLATE_Y_PX}px) scale(${SCALE})`;
  return base && base !== NONE ? base + tail : `translateY(${TRANSLATE_Y_PX}px) scale(${SCALE})`;
};

const cancelAni = (a) => { if (a) try { a.cancel(); } catch (_) {} };
const clearTimer = (t) => { if (t) try { clearTimeout(t); } catch (_) {} };

function isDisabled(el) {
  if (!el) return true;
  // :disabled covers <button disabled>, <input disabled>, any form
  // control with the disabled attribute, AND any control inside a
  // <fieldset disabled> except children of the first <legend>.
  // Non-form pressables (a, span[role=button], summary, …) never
  // match :disabled, so we also check aria-disabled explicitly.
  try { if (el.disabled) return true; } catch (_) {}
  try { if (typeof el.matches === 'function' && el.matches(':disabled')) return true; } catch (_) {}
  try { if (typeof el.getAttribute === 'function' && el.getAttribute('aria-disabled') === 'true') return true; } catch (_) {}
  return false;
}

function findPressable(target) {
  try { return target && typeof target.closest === 'function' ? target.closest(PRESSABLE_SELECTOR) : null; }
  catch (_) { return null; }
}

function clearSlot(el, s) {
  if (!s) return;
  clearTimer(s.releaseTimer);
  cancelAni(s.pressAni);
  cancelAni(s.releaseAni);
  if (s.pointerId != null) try { activeByPointer.delete(s.pointerId); } catch (_) {}
  try { state.delete(el); } catch (_) {}
  try { activeElements.delete(el); } catch (_) {}
}

// ---- press / release / snap -----------------------------------------------

function press(el, pointerId) {
  if (reducedMotion() || isDisabled(el) || !el || typeof el.animate !== 'function') return;
  const live = getTransform(el);
  const prevSlot = state.get(el);
  const baseTransform = (prevSlot && prevSlot.baseTransform) || live;
  let ani;
  try {
    ani = el.animate(
      [{ transform: live }, { transform: appendPress(baseTransform) }],
      { duration: DURATION_PRESS_MS, easing: EASING, fill: 'forwards', composite: 'replace' },
    );
  } catch (_) {
    // Animation constructor failed. Clean up the previous slot's
    // bookkeeping so the maps do not leak stale entries. The
    // element's visual is at its pre-existing computed transform;
    // we never write inline style.
    if (prevSlot) clearSlot(el, prevSlot);
    return;
  }
  // Success: cancel the previous slot's animations + timer (state.set
  // below overwrites the slot's state entry, so we do not need to
  // touch the WeakMap for it).
  if (prevSlot) {
    clearTimer(prevSlot.releaseTimer);
    cancelAni(prevSlot.pressAni);
    cancelAni(prevSlot.releaseAni);
    // Multi-pointer leak: drop a stale pointerId from the map so a
    // late pointerup for the old finger cannot release the new
    // press.
    if (prevSlot.pointerId != null && prevSlot.pointerId !== pointerId) {
      try { activeByPointer.delete(prevSlot.pointerId); } catch (_) {}
    }
  }
  generationCounter++;
  if (pointerId != null) try { activeByPointer.set(pointerId, el); } catch (_) {}
  try { activeElements.add(el); } catch (_) {}
  state.set(el, {
    generation: generationCounter,
    pointerId: typeof pointerId === 'number' ? pointerId : null,
    baseTransform,
    pressStartTime: now(),
    pressAni: ani,
    releaseAni: null,
    releaseTimer: null,
  });
}

function doReleaseEase(el, generation) {
  const cur = state.get(el);
  if (!cur || cur.generation !== generation) return;
  cur.releaseTimer = null;
  if (reducedMotion() || typeof el?.animate !== 'function') {
    clearSlot(el, cur);
    return;
  }
  // Sample live AT the linger callback — `fill: 'forwards'` keeps
  // the press effect showing the peak frame until we cancel it. Then
  // hand off to the release animation, which starts from this live
  // frame and ends at the captured base.
  const live = getTransform(el);
  cancelAni(cur.pressAni);
  cur.pressAni = null;
  const base = cur.baseTransform || NONE;
  let ani;
  try {
    ani = el.animate(
      [{ transform: live }, { transform: base }],
      { duration: DURATION_RELEASE_MS, easing: EASING, fill: 'forwards', composite: 'replace' },
    );
  } catch (_) {
    // Release animation failed to construct. The press effect has
    // already been cancelled, so visually the element is at the
    // underlying computed style (= base). Clean up our bookkeeping.
    clearSlot(el, cur);
    return;
  }
  cur.releaseAni = ani;
  if (ani.finished && typeof ani.finished.then === 'function') {
    ani.finished.then(() => {
      const c = state.get(el);
      if (c && c.releaseAni === ani && c.generation === generation) {
        cancelAni(ani);
        clearSlot(el, c);
      }
    }).catch(noop);
  }
}

function release(el, opts) {
  const s = state.get(el);
  if (!s) return;
  if (s.releaseTimer) { clearTimer(s.releaseTimer); s.releaseTimer = null; }
  const linger = (opts && typeof opts.lingerMs === 'number' && opts.lingerMs >= 0)
    ? opts.lingerMs
    : Math.max(0, DURATION_PRESS_MS - (now() - s.pressStartTime));
  const generation = s.generation;
  if (linger <= 0) doReleaseEase(el, generation);
  else s.releaseTimer = setTimeout(() => doReleaseEase(el, generation), linger);
}

function snap(el) {
  const s = state.get(el);
  if (!s) return;
  clearTimer(s.releaseTimer);
  s.releaseTimer = null;
  clearSlot(el, s);
}

function cancelForElement(el) { snap(el); }

function releaseAllActive() {
  for (const el of Array.from(activeElements)) snap(el);
}

// ---- event listeners ------------------------------------------------------

function onPointerDown(e) {
  if (e && e.button !== undefined && e.button !== 0) return;
  const el = findPressable(e?.target);
  if (!el || isDisabled(el)) return;
  press(el, e.pointerId);
}

function onPointerUpOrCancel(e) {
  if (!e) return;
  const el = activeByPointer.get(e.pointerId);
  if (!el) return;
  try { activeByPointer.delete(e.pointerId); } catch (_) {}
  const s = state.get(el);
  if (!s || s.pointerId !== e.pointerId) return;
  // Defensive: a multi-pointer re-press can leave a stale entry in
  // activeByPointer under the old pointerId. The pointerId check
  // above ensures only the matching finger can release the slot.
  if (e.type === 'pointercancel') snap(el);
  else release(el);
}

function onPointerLeave(e) {
  const el = findPressable(e?.target);
  if (!el) return;
  // Ignore pointerleave when the pointer moves to a descendant of
  // the same pressable control.
  const related = e.relatedTarget;
  if (related && typeof el.contains === 'function' && el.contains(related)) return;
  snap(el);
}

function onBlur(e) {
  const el = e?.target;
  if (el && typeof el.matches === 'function' && el.matches(PRESSABLE_SELECTOR)) snap(el);
}

if (typeof document !== 'undefined') {
  const doc = document;
  doc.addEventListener('pointerdown', safe(onPointerDown), true);
  doc.addEventListener('pointerup', safe(onPointerUpOrCancel), true);
  doc.addEventListener('pointercancel', safe(onPointerUpOrCancel), true);
  doc.addEventListener('pointerleave', safe(onPointerLeave), true);
  doc.addEventListener('blur', safe(onBlur), true);
}
if (typeof window !== 'undefined') {
  try { window.addEventListener('blur', safe(releaseAllActive)); } catch (_) {}
}

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
