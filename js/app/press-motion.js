// Pure-visual press-down module. Zero business, zero network, zero storage.
//
// Hard rules (all enforced):
//   - No inline style writes. We never call element.style.setProperty or
//     removeProperty on `transform`, and we never use !important. The
//     visual state is owned exclusively by WAAPI Animation objects whose
//     effects we cancel() when they are no longer needed.
//   - Disabled / aria-disabled / native :disabled (incl. a control
//     inside a disabled <fieldset>, except the first <legend>'s
//     children) / prefers-reduced-motion skip spatial animation
//     entirely. We never touch existing inline transforms.
//   - All risky operations are try / catch'd so a failure in animate()
//     or computed-style sampling can never disable a click or break a
//     form submission.
//
// Lifecycle contract:
//
//   press(el, pointerId):
//     1. Filter out reduced-motion, disabled, missing el.animate API.
//     2. Sample the LIVE computed transform BEFORE we mutate any state
//        (so the new keyframe starts where the eye currently sees the
//        element, never with a snap).
//     3. baseTransform = prevSlot?.baseTransform || live. The base is
//        preserved across re-presses and across the brief release
//        animation — the element always returns to the original base,
//        not the last pressed frame.
//     4. Build the new press WAAPI Animation FIRST. If el.animate
//        throws, we have not yet touched anything; we bail out and
//        clean up the previous slot's bookkeeping (timer, animations,
//        state entry, pointer mapping) so no residue is left in the
//        maps. We never touch inline style.
//     5. On success: cancel the previous slot's animations and timer,
//        drop any activeByPointer entry under a DIFFERENT prior
//        pointerId (so a late pointerup for the stale pointer cannot
//        release the freshly-pressed slot — the multi-pointer leak
//        fix), then store the new slot keyed under the current
//        pointerId.
//     6. Record generation, pointerId, pressStartTime, pressAni.
//
//   pointerup → release(el):
//     - The press animation keeps PLAYING. We never pause or sample
//       early. We just schedule the deferred release for
//       max(0, DURATION_PRESS_MS - elapsed) ms from now, so even a
//       2 ms tap is observed as the full DURATION_PRESS_MS curve.
//     - Click / focus / form submission is not delayed: the listener
//       returns immediately after scheduling the timer.
//     - The handler also verifies state.pointerId === event.pointerId
//       before calling release, so a stale pointer from a multi-pointer
//       re-press cannot trigger a release.
//
//   At the deferred release callback (after the linger):
//     1. Verify the slot's generation still matches (re-press can
//        bump it; the stale callback must no-op).
//     2. Sample the LIVE computed transform AGAIN, at the moment of
//        release (not at pointerup time).
//     3. Cancel the press animation effect.
//     4. If reduced-motion or animate is gone, clean up the slot.
//     5. Create a fresh WAAPI Animation that goes FROM live TO
//        baseTransform, duration DURATION_RELEASE_MS, fill: 'forwards',
//        composite: 'replace'. If el.animate throws, clean up the
//        slot — the press effect has already been cancelled, so the
//        element is at its underlying computed style already; we just
//        remove our bookkeeping.
//     6. When the release Animation finishes, cancel the finished
//        effect so no fill-forward Animation remains, and clean up
//        the slot.
//
//   Cancellation paths (pointercancel, window blur, pointerleave to
//   outside the control):
//     - Snap to base: cancel press / release animations, clear the
//       release timer, clean up the slot. The element returns to its
//       captured base via getComputedStyle, with any pre-existing
//       inline transform preserved verbatim.
//     - No release animation, no linger. Visually immediate.
//     - The handler also verifies state.pointerId === event.pointerId
//       before snapping.
//
//   Cleanup:
//     - finished fill-forwards Animations are cancelled so no WAAPI
//       effect lingers on the element. The slot is removed from
//       state, activeByPointer, and activeElements.
//     - On window blur we iterate every active element and snap.

const SCALE = 0.974;
const TRANSLATE_Y_PX = 2;
const DURATION_PRESS_MS = 70;
const DURATION_RELEASE_MS = 240;
const EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

const PRESSABLE_SELECTOR = [
  'button',
  'a.button',
  '[role="button"]',
  'summary',
  '#menu',
  '#language',
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

const state = new WeakMap();            // el -> { generation, pointerId, baseTransform, pressStartTime, pressAni, releaseAni, releaseTimer }
const activeByPointer = new Map();      // pointerId -> element
const activeElements = new Set();
let globalGeneration = 0;

function now() {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch (_) {}
  return Date.now();
}

function reducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {
    return false;
  }
}

function isDisabled(el) {
  if (!el) return true;
  // Native :disabled covers: <button disabled>, <input disabled>,
  // any form control with the disabled attribute, AND any form
  // control inside a <fieldset disabled> (with the well-known
  // exception that controls which are children of the first
  // <legend> inside such a fieldset are NOT :disabled). For
  // non-form elements (a, span[role=button], summary, ...) the
  // pseudo-class never matches, so we fall through to ARIA.
  try {
    if (el.disabled) return true;
  } catch (_) {}
  try {
    if (typeof el.matches === 'function' && el.matches(':disabled')) return true;
  } catch (_) {}
  try {
    if (typeof el.getAttribute === 'function' && el.getAttribute('aria-disabled') === 'true') return true;
  } catch (_) {}
  return false;
}

function getTransform(el) {
  try {
    const cs = (typeof getComputedStyle === 'function') ? getComputedStyle(el) : null;
    if (!cs) return 'none';
    const t = cs.transform;
    return (t && t !== 'none') ? t : 'none';
  } catch (_) { return 'none'; }
}

function appendPress(baseT) {
  const tail = ` translateY(${TRANSLATE_Y_PX}px) scale(${SCALE})`;
  return (baseT && baseT !== 'none') ? (baseT + tail) : `translateY(${TRANSLATE_Y_PX}px) scale(${SCALE})`;
}

function tryCancel(ani) {
  if (!ani) return;
  try { ani.cancel(); } catch (_) {}
}

function clearTimer(timer) {
  if (!timer) return;
  try { clearTimeout(timer); } catch (_) {}
}

function clearAnimOnly(s) {
  if (!s) return;
  clearTimer(s.releaseTimer);
  s.releaseTimer = null;
  tryCancel(s.pressAni);
  s.pressAni = null;
  tryCancel(s.releaseAni);
  s.releaseAni = null;
}

function cleanupSlot(el, s) {
  if (s) {
    clearTimer(s.releaseTimer);
    tryCancel(s.pressAni);
    tryCancel(s.releaseAni);
    if (s.pointerId != null) {
      try { activeByPointer.delete(s.pointerId); } catch (_) {}
    }
  }
  try { state.delete(el); } catch (_) {}
  try { activeElements.delete(el); } catch (_) {}
}

function press(el, pointerId) {
  try {
    if (reducedMotion() || isDisabled(el)) return;
    if (!el || typeof el.animate !== 'function') return;
    // 1) Sample the LIVE computed transform BEFORE we mutate any
    //    state. The from-keyframe of the new effect must match what
    //    the eye currently sees, or the press will snap.
    const live = getTransform(el);
    const prevSlot = state.get(el);
    // 2) Preserve the ORIGINAL baseTransform across re-presses, so
    //    the release animation always returns to the same base (not
    //    the last pressed frame, which would drift).
    const baseTransform = (prevSlot && prevSlot.baseTransform) || live;
    // 3) Build the new press effect FIRST. If el.animate throws (an
    //    engine failure or an invalid keyframe) we have NOT yet
    //    touched the previous slot, the maps, or the styles. We
    //    bail out cleanly. (We must NOT clearAnimOnly before this
    //    attempt — that would orphan the previous press if the new
    //    one fails to construct.)
    let ani;
    try {
      ani = el.animate(
        [{ transform: live }, { transform: appendPress(baseTransform) }],
        { duration: DURATION_PRESS_MS, easing: EASING, fill: 'forwards', composite: 'replace' }
      );
    } catch (_) {
      // Animation constructor failed. Clean up any prev state we
      // owned (its timer / press / release animations, the slot
      // itself, and any pointer mapping) so that the maps do not
      // leak stale entries. We never write inline style — the
      // element's visual returns to its pre-existing computed
      // transform. Click / form / focus are unaffected.
      if (prevSlot) cleanupSlot(el, prevSlot);
      return;
    }
    // 4) New animation succeeded. Now we may safely displace the
    //    previous slot's animations, timers and pointerId mapping.
    clearAnimOnly(prevSlot);
    // 5) If the previous slot was tracked under a different
    //    pointerId, remove that mapping so a late pointerup for the
    //    stale pointer cannot release the new press. This is the
    //    multi-pointer leak fix: a second finger on the same
    //    control must not let the first finger's pointerup cancel
    //    the freshly-pressed slot.
    if (prevSlot && prevSlot.pointerId != null && prevSlot.pointerId !== pointerId) {
      try { activeByPointer.delete(prevSlot.pointerId); } catch (_) {}
    }
    globalGeneration++;
    if (pointerId != null) {
      try { activeByPointer.set(pointerId, el); } catch (_) {}
    }
    try { activeElements.add(el); } catch (_) {}
    state.set(el, {
      generation: globalGeneration,
      pointerId: (typeof pointerId === 'number') ? pointerId : null,
      baseTransform,
      pressStartTime: now(),
      pressAni: ani,
      releaseAni: null,
      releaseTimer: null,
    });
  } catch (_) {
    // The whole press path failed harmlessly.
  }
}

function doReleaseEase(el, generation) {
  try {
    const cur = state.get(el);
    if (!cur || cur.generation !== generation) return;
    cur.releaseTimer = null;
    if (reducedMotion() || typeof el.animate !== 'function') {
      // Skip spatial animation. Cancel the press effect and snap to
      // the captured base via the underlying computed style. No
      // inline style writes, so any pre-existing transform survives.
      cleanupSlot(el, cur);
      return;
    }
    // 1) Sample LIVE — the moment we sample is the delayed callback,
    //    NOT pointerup time. With fill: 'forwards' the press effect
    //    keeps showing the pressed frame until we cancel it.
    const liveTransform = getTransform(el);
    // 2) THEN cancel the press effect. The visual will now revert to
    //    the underlying computed style; the release animation
    //    immediately takes over with its from-frame = liveTransform.
    tryCancel(cur.pressAni);
    cur.pressAni = null;
    // 3) Animate FROM liveTransform TO the stored baseTransform.
    const baseTransform = cur.baseTransform || 'none';
    let ani;
    try {
      ani = el.animate(
        [{ transform: liveTransform }, { transform: baseTransform }],
        { duration: DURATION_RELEASE_MS, easing: EASING, fill: 'forwards', composite: 'replace' }
      );
    } catch (_) {
      // Release animation failed to construct. The press animation
      // has already been cancelled, so visually the element is at
      // the underlying computed style (= base). Clean up our own
      // bookkeeping (state / activeByPointer / activeElements) so
      // no residue is left for the next interaction. We never write
      // inline style, so the element's base is fully determined by
      // the page CSS / pre-existing inline transform.
      cleanupSlot(el, cur);
      return;
    }
    cur.releaseAni = ani;
    // 4) On completion, cancel the FINISHED effect so no fill-forward
    //    Animation remains applied to the element. Then clean up.
    if (ani.finished && typeof ani.finished.then === 'function') {
      ani.finished.then(() => {
        try {
          const c = state.get(el);
          if (c && c.releaseAni === ani && c.generation === generation) {
            tryCancel(ani);
            cleanupSlot(el, c);
          }
        } catch (_) {}
      }).catch(() => { /* cancelled or interrupted — harmless */ });
    }
  } catch (_) {
    // The whole release path failed harmlessly.
  }
}

function release(el, opts) {
  try {
    opts = opts || {};
    const s = state.get(el);
    if (!s) return;
    if (s.releaseTimer) {
      clearTimer(s.releaseTimer);
      s.releaseTimer = null;
    }
    // Compute the linger: pointerup keeps the press PLAYING until at
    // least DURATION_PRESS_MS has elapsed since press(), so even a
    // 2 ms tap is observed as the full press curve. opts.lingerMs can
    // override (used by snap / blur / cancel paths).
    let lingerMs;
    if (typeof opts.lingerMs === 'number' && opts.lingerMs >= 0) {
      lingerMs = opts.lingerMs;
    } else {
      const elapsed = now() - s.pressStartTime;
      lingerMs = Math.max(0, DURATION_PRESS_MS - elapsed);
    }
    const generation = s.generation;
    if (lingerMs <= 0) {
      doReleaseEase(el, generation);
      return;
    }
    s.releaseTimer = setTimeout(() => doReleaseEase(el, generation), lingerMs);
  } catch (_) {
    // ignore
  }
}

function snap(el) {
  // Snap-to-base: cancel every effect, clear every timer, clean up.
  // No release animation, no linger. Used by pointercancel, window
  // blur, and pointerleave to outside the control.
  try {
    const s = state.get(el);
    if (!s) return;
    const generation = s.generation;
    // Clear the pending release timer if any. We deliberately do NOT
    // run doReleaseEase here — snap is supposed to be immediate.
    clearTimer(s.releaseTimer);
    s.releaseTimer = null;
    cleanupSlot(el, s);
    // generation is unused in the snap path but kept for symmetry.
    void generation;
  } catch (_) {}
}

function cancelForElement(el) {
  try {
    snap(el);
  } catch (_) {}
}

function releaseAllActive() {
  try {
    for (const el of Array.from(activeElements)) {
      snap(el);
    }
  } catch (_) {}
}

function findPressable(target) {
  try {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(PRESSABLE_SELECTOR);
  } catch (_) {
    return null;
  }
}

function onPointerDown(e) {
  try {
    if (e && e.button !== undefined && e.button !== 0) return;
    const el = findPressable(e && e.target);
    if (!el || isDisabled(el)) return;
    press(el, e.pointerId);
  } catch (_) {}
}

function onDelegatedPointerUp(e) {
  try {
    if (!e) return;
    const el = activeByPointer.get(e.pointerId);
    if (!el) return;
    try { activeByPointer.delete(e.pointerId); } catch (_) {}
    const s = state.get(el);
    if (!s) return;
    // Defensive: a multi-pointer re-press can leave a stale entry in
    // activeByPointer under the old pointerId. Compare against the
    // CURRENT slot's pointerId so a late pointerup for an old
    // finger cannot release a freshly pressed slot.
    if (s.pointerId !== e.pointerId) return;
    release(el);
  } catch (_) {}
}

function onDelegatedPointerCancel(e) {
  try {
    if (!e) return;
    const el = activeByPointer.get(e.pointerId);
    if (!el) return;
    try { activeByPointer.delete(e.pointerId); } catch (_) {}
    const s = state.get(el);
    if (!s) return;
    // Same defensive pointerId check as pointerup.
    if (s.pointerId !== e.pointerId) return;
    snap(el);
  } catch (_) {}
}

function onPointerLeave(e) {
  try {
    if (!e) return;
    const el = findPressable(e.target);
    if (!el) return;
    const related = e.relatedTarget;
    // Ignore pointerleave when the pointer moves to a descendant of the
    // same pressable control.
    if (related && typeof el.contains === 'function' && el.contains(related)) return;
    snap(el);
  } catch (_) {}
}

function onBlur(e) {
  try {
    if (!e) return;
    const el = e.target;
    if (el && typeof el.matches === 'function' && el.matches(PRESSABLE_SELECTOR)) {
      snap(el);
    }
  } catch (_) {}
}

function onWindowBlur() {
  releaseAllActive();
}

if (typeof document !== 'undefined') {
  try {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onDelegatedPointerUp, true);
    document.addEventListener('pointercancel', onDelegatedPointerCancel, true);
    document.addEventListener('pointerleave', onPointerLeave, true);
    document.addEventListener('blur', onBlur, true);
  } catch (_) {}
}
if (typeof window !== 'undefined') {
  try {
    window.addEventListener('blur', onWindowBlur);
  } catch (_) {}
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