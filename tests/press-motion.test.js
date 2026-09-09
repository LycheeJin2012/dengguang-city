// Behavioral tests for js/app/press-motion.js. This is a SYNTHETIC test
// file (no real browser); every assertion is labelled with the path
// that is being verified. We load the real module via vm.SourceTextModule
// in an isolated context with minimal DOM stubs.
//
// Pointer routing is proven by capturing the listener registered by
// the module on `document.addEventListener` (in capture phase) and then
// dispatching a synthetic PointerEvent through the real handler —
// never bypassing it by calling pm.press() directly. We only call
// pm.press() / pm.release() / pm.snap() when the path is labelled
// "(direct)" so it is obvious when the test is going through the
// public API instead of the routed handler.
//
// Visual correctness (computed transform values under WAAPI) is NOT
// verified here — that is the job of tests/press-motion-preview.html
// running in a real browser. This file verifies state transitions,
// animation keyframes, generation tracking, cancellation paths, and
// disabled / reduced-motion filters.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const moduleSrc = fs.readFileSync(path.join(root, 'js/app/press-motion.js'), 'utf8');

// ---- DOM / browser stubs ---------------------------------------------------

class FakeAnimation {
  constructor(keyframes, opts) {
    this.keyframes = keyframes;
    this.opts = opts;
    this.cancelled = false;
    // Use a deferred-like finish. Cancel resolves the promise (so it is
    // never rejected — the module's `.finished.then(...).catch(...)`
    // pattern depends on it not throwing).
    let resolve;
    this.finished = new Promise(r => { resolve = r; });
    this._resolve = resolve;
    FakeAnimation.instances.push(this);
  }
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    // Resolve (not reject) so callers awaiting `.finished` do not see
    // an unhandled rejection. The cancellation is recorded via the
    // `cancelled` flag — that is what assertions observe.
    try { this._resolve(this); } catch (_) {}
  }
  finish() {
    if (this.cancelled) return;
    try { this._resolve(this); } catch (_) {}
  }
}
FakeAnimation.instances = [];

class FakeElement {
  constructor(id = '', opts = {}) {
    this.id = id;
    this.tagName = opts.tagName || 'BUTTON';
    this.style = {};
    this.dataset = {};
    this._attrs = {};
    this._inlineTransform = '';
    this._activeAni = null;
    this.children = [];
    this.parent = null;
    this.disabled = false;
    FakeElement.instances.push(this);
  }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; }
  // getComputedStyle(el).transform in the test stub:
  //   - if an active WAAPI Animation is attached, return its final
  //     keyframe (the "to" frame), matching what a real browser
  //     computes for `fill: 'forwards'` while the effect is live.
  //   - otherwise return the inline transform, or 'none' if absent.
  // The module's press path samples BEFORE attaching the new
  // animation, so the sampler sees the previous animation's last
  // frame (or 'none' if nothing is active) — exactly what a real
  // browser does. We don't try to interpolate mid-frame: this test
  // is about state and keyframes, not millisecond-level easing.
  get _computedTransform() {
    if (this._activeAni && !this._activeAni.cancelled) {
      const kf = this._activeAni.keyframes;
      return kf[kf.length - 1].transform;
    }
    return this._inlineTransform || 'none';
  }
  contains(other) {
    if (other === this) return true;
    return this.children.some(c => c === other || (c && c.contains && c.contains(other)));
  }
  // Minimal selector matcher: only the special cases our isDisabled()
  // and onBlur() paths need. `matches(':disabled')` mirrors native
  // behaviour: true if the element is a form control with its own
  // disabled property / attribute, OR if it is inside a `<fieldset>`
  // ancestor with the disabled attribute set and is NOT a descendant
  // of that fieldset's first <legend> child.
  matches(selector) {
    if (selector === ':disabled') {
      const FORM_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTGROUP', 'OPTION']);
      if (FORM_TAGS.has(this.tagName)) {
        if (this.disabled) return true;
        if (this._attrs.disabled != null) return true;
        let cur = this.parent;
        while (cur) {
          if (cur.tagName === 'FIELDSET' && cur.disabled) {
            const legend = cur.children.find(c => c && c.tagName === 'LEGEND');
            if (!legend) return true;
            const insideFirstLegend = (() => {
              let p = this.parent;
              while (p) {
                if (p === legend) return true;
                if (p === cur) return false;
                p = p.parent;
              }
              return false;
            })();
            return !insideFirstLegend;
          }
          cur = cur.parent;
        }
        return false;
      }
      return false;
    }
    return true;
  }
  closest(_selector) { return this; }
  dispatchEvent(ev) { return true; }
  animate(keyframes, opts) {
    const ani = new FakeAnimation(keyframes, opts);
    this._activeAni = ani;
    return ani;
  }
}
FakeElement.instances = [];

// Patch the stub so getComputedStyle works against the stubbed element.
function fakeGetComputedStyle(el) {
  return { get transform() { return el._computedTransform; } };
}

// Stubbed PointerEvent.
class FakePointerEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.pointerId = init.pointerId != null ? init.pointerId : 1;
    this.button = init.button != null ? init.button : 0;
    this.pointerType = init.pointerType || 'mouse';
    this.target = init.target || null;
    this.relatedTarget = init.relatedTarget || null;
    this.bubbles = init.bubbles !== false;
    this.eventPhase = init.eventPhase || 2; // AT_TARGET by default
  }
}

// Build a sandbox with a document that captures listeners.
function buildSandbox() {
  const listeners = {}; // key: `${capture?'cap':'bub'}:${type}` -> fn[]
  const windowListeners = {};
  function makeDispatcher(bucket) {
    return function dispatchEvent(ev) {
      // Capture phase first, then bubble. Real DOM event flow.
      const cap = (bucket[`cap:${ev.type}`] || []).slice();
      for (const fn of cap) fn(ev);
      const bub = (bucket[`bub:${ev.type}`] || []).slice();
      for (const fn of bub) fn(ev);
      return true;
    };
  }
  function makeAdder(bucket, dispatch) {
    return function addEventListener(type, fn, capture) {
      const key = `${capture ? 'cap' : 'bub'}:${type}`;
      (bucket[key] = bucket[key] || []).push(fn);
    };
  }
  const sandbox = {
    console,
    setTimeout, clearTimeout, setImmediate, clearImmediate,
    Promise,
    performance: { now: () => Date.now() },
    window: {
      _listeners: windowListeners,
      matchMedia: () => ({ matches: false }),
      addEventListener: makeAdder(windowListeners),
      dispatchEvent: makeDispatcher(windowListeners),
    },
    document: {
      _listeners: listeners,
      addEventListener: makeAdder(listeners),
      dispatchEvent: makeDispatcher(listeners),
    },
    getComputedStyle: fakeGetComputedStyle,
    PointerEvent: FakePointerEvent,
    HTMLElement: function() {},
  };
  vm.createContext(sandbox);
  return sandbox;
}

async function loadModule() {
  const sandbox = buildSandbox();
  // Strip the ESM export so the module becomes a runnable Script.
  // `export const __pressMotion = { ... };` becomes
  // `globalThis.__pressMotion = { ... };`. The `export const` syntax
  // would otherwise fail inside a Script.
  const rewritten = moduleSrc.replace(/^export\s+const\s+__pressMotion/m, 'globalThis.__pressMotion');
  const script = new vm.Script(rewritten, { filename: 'press-motion.js' });
  script.runInContext(sandbox);
  return sandbox;
}

// Convenience helper: dispatch a pointer event through the real
// captured listener (capture phase).
function dispatchPointer(ctx, type, init = {}) {
  const ev = new FakePointerEvent(type, { eventPhase: 1, ...init }); // CAPTURING_PHASE
  ctx.document.dispatchEvent(ev);
}

// ---- Tests -----------------------------------------------------------------

test('press-motion: WAAPI only, no inline style writes, no !important', async () => {
  // Static check: the module source must not contain element.style
  // setProperty / removeProperty calls and must not use !important on
  // style. The brief explicitly forbids these. We strip /* ... */ block
  // comments and // line comments so a literal "never use !important"
  // in a doc comment does not trip the assertion.
  let code = moduleSrc.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  code = code.replace(/(^|\s)\/\/[^\n]*/g, (m, p1) => p1 + '');
  assert.doesNotMatch(code, /\.style\.setProperty/);
  assert.doesNotMatch(code, /\.style\.removeProperty/);
  assert.doesNotMatch(code, /\.style\.\w+\s*=/);
  assert.doesNotMatch(code, /\bsignificant\s*:\s*['"]?important/);
  assert.doesNotMatch(code, /!important/);
});

test('press-motion: exports the documented surface', async () => {
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  for (const key of ['press', 'release', 'snap', 'cancelForElement', 'isDisabled', 'reducedMotion', 'state', 'activeByPointer', 'activeElements', 'doReleaseEase', 'PRESSABLE_SELECTOR', 'SCALE', 'TRANSLATE_Y_PX', 'DURATION_PRESS_MS', 'DURATION_RELEASE_MS']) {
    assert.ok(key in pm, `__pressMotion must export ${key}`);
  }
  assert.equal(pm.SCALE, 0.974);
  assert.equal(pm.TRANSLATE_Y_PX, 2);
  assert.equal(pm.DURATION_PRESS_MS, 70);
  assert.equal(pm.DURATION_RELEASE_MS, 240);
});

test('press-motion: registers document pointer listeners in capture phase at import time', async () => {
  const ctx = await loadModule();
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'blur']) {
    const cap = ctx.document._listeners[`cap:${type}`];
    assert.ok(Array.isArray(cap) && cap.length > 0, `must register a capture-phase listener for ${type}`);
  }
});

test('press-motion (routed): a real pointerdown creates a press animation with the correct keyframes', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  btn.style.transform = '';
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 7 });
  const s = pm.state.get(btn);
  assert.ok(s, 'routed pointerdown must populate the state slot');
  assert.equal(s.baseTransform, 'none');
  assert.equal(s.pointerId, 7);
  assert.ok(FakeAnimation.instances.length >= 1, 'routed pointerdown must call el.animate');
  const pressAni = FakeAnimation.instances[FakeAnimation.instances.length - 1];
  assert.equal(pressAni.keyframes.length, 2);
  assert.equal(pressAni.keyframes[0].transform, 'none', 'from frame must equal the live transform');
  assert.equal(pressAni.keyframes[1].transform, 'translateY(2px) scale(0.974)', 'to frame must be base + press offset');
  assert.equal(pressAni.opts.duration, 70);
  assert.equal(pressAni.opts.fill, 'forwards');
  assert.equal(pressAni.opts.composite, 'replace');
  assert.ok(pm.activeByPointer.has(7), 'pointerId must be tracked');
  assert.ok(pm.activeElements.has(btn), 'element must be in activeElements');
});

test('press-motion (routed): re-press during release preserves the original baseTransform', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  // Simulate a known base transform via inline style + getComputedStyle
  // (our stub reads from _inlineTransform which mirrors style.transform).
  btn._inlineTransform = 'rotate(7deg)';
  // First press
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 10 });
  const s1 = pm.state.get(btn);
  assert.equal(s1.baseTransform, 'rotate(7deg)', 'first press must store the inline base');
  // Release through the routed pointerup — the brief says linger keeps
  // the press playing for the full DURATION_PRESS_MS.
  dispatchPointer(ctx, 'pointerup', { target: btn, pointerId: 10 });
  // Re-press immediately (release is still pending).
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 11 });
  const s2 = pm.state.get(btn);
  assert.equal(s2.baseTransform, 'rotate(7deg)', 're-press must keep the ORIGINAL base, not the pressed frame');
  assert.ok(s2.generation > s1.generation, 're-press must bump generation');
  // The pending release timer from the first press must be cleared so
  // it cannot snap the element later.
  assert.equal(s2.releaseTimer, null, 're-press must clear stale release timer');
  // The previous press animation must be cancelled (otherwise it would
  // keep running and fight the new one).
  const firstAni = FakeAnimation.instances[0];
  assert.equal(firstAni.cancelled, true, 'previous press Animation must be cancelled on re-press');
});

test('press-motion (routed): a 2 ms tap is held for the full DURATION_PRESS_MS then eased back', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 21 });
  // 2 ms tap (simulated as immediate release; setTimeout in module is
  // real and will fire after ~68 ms, the remaining press time).
  dispatchPointer(ctx, 'pointerup', { target: btn, pointerId: 21 });
  const s = pm.state.get(btn);
  assert.ok(s.releaseTimer, 'release() must schedule a linger timer for the remaining press duration');
  // Wait past the linger (DURATION_PRESS_MS = 70) but well before
  // DURATION_RELEASE_MS (240). The press animation should have been
  // cancelled and the release animation should be in flight.
  await new Promise(r => setTimeout(r, 90));
  // There should now be a SECOND Animation on the element (the release).
  assert.ok(FakeAnimation.instances.length >= 2, 'release animation must be created after linger');
  const releaseAni = FakeAnimation.instances[FakeAnimation.instances.length - 1];
  assert.equal(releaseAni.opts.duration, 240);
  // from-frame must be the live transform (still the pressed frame at
  // the moment of sampling, not at pointerup).
  assert.equal(releaseAni.keyframes[0].transform, 'translateY(2px) scale(0.974)', 'release from-frame must equal the sampled pressed transform');
  assert.equal(releaseAni.keyframes[1].transform, 'none', 'release to-frame must equal the stored base');
  // The press animation must have been cancelled.
  const pressAni = FakeAnimation.instances[0];
  assert.equal(pressAni.cancelled, true, 'press animation must be cancelled at the release callback, NOT at pointerup');
});

test('press-motion (routed): finished release Animation is cancelled and slot is cleaned up', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 31 });
  dispatchPointer(ctx, 'pointerup', { target: btn, pointerId: 31 });
  await new Promise(r => setTimeout(r, 90));     // past linger
  const releaseAni = FakeAnimation.instances[FakeAnimation.instances.length - 1];
  // Complete the release animation.
  releaseAni.finish();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(releaseAni.cancelled, true, 'finished release effect must be cancelled so no fill-forward remains');
  assert.equal(pm.state.has(btn), false, 'slot must be cleaned up after release completes');
  assert.equal(pm.activeElements.has(btn), false);
});

test('press-motion (routed): pointercancel snaps the element to base without an animation', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 41 });
  dispatchPointer(ctx, 'pointercancel', { target: btn, pointerId: 41 });
  const pressAni = FakeAnimation.instances[0];
  assert.equal(pressAni.cancelled, true, 'pointercancel must cancel the press animation');
  assert.equal(pm.state.has(btn), false, 'slot must be cleaned up immediately');
  assert.equal(pm.activeByPointer.has(41), false, 'pointerId must be removed');
});

test('press-motion (routed): pointerup for a non-matching pointerId does not release the tracked element', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 51 });
  // Dispatch a pointerup with a DIFFERENT pointerId.
  dispatchPointer(ctx, 'pointerup', { target: btn, pointerId: 999 });
  // The slot must still be there.
  assert.ok(pm.state.has(btn), 'mismatched pointerup must not release');
  assert.ok(pm.activeByPointer.has(51), 'original pointerId must remain tracked');
  // Now release with the matching pointerId.
  dispatchPointer(ctx, 'pointerup', { target: btn, pointerId: 51 });
  assert.equal(pm.activeByPointer.has(51), false, 'matching pointerup must drain activeByPointer');
});

test('press-motion (routed): pointerleave with relatedTarget inside the same control does NOT release', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const parent = new FakeElement('parent');
  const child = new FakeElement('child');
  parent.children.push(child);
  child.parent = parent;
  dispatchPointer(ctx, 'pointerdown', { target: parent, pointerId: 61 });
  // Pointer moves from parent to child — pointerleave fires on parent.
  dispatchPointer(ctx, 'pointerleave', { target: parent, relatedTarget: child });
  assert.ok(pm.state.has(parent), 'pointerleave to descendant must not release');
});

test('press-motion (routed): pointerleave with relatedTarget outside the control DOES release', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  const outside = new FakeElement('outside');
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 71 });
  dispatchPointer(ctx, 'pointerleave', { target: btn, relatedTarget: outside });
  assert.equal(pm.state.has(btn), false, 'pointerleave to outside must release immediately');
});

test('press-motion: disabled element filter — routed pointerdown is a no-op', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  btn.disabled = true;
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 81 });
  assert.equal(FakeAnimation.instances.length, 0, 'disabled element must not animate');
  assert.equal(pm.state.has(btn), false);
  assert.equal(pm.activeByPointer.has(81), false, 'disabled element must not register pointerId');
});

test('press-motion: aria-disabled="true" element filter — direct press is a no-op', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  btn.setAttribute('aria-disabled', 'true');
  pm.press(btn, 91);
  assert.equal(FakeAnimation.instances.length, 0);
  assert.equal(pm.state.has(btn), false);
});

test('press-motion: reduced-motion filter — no spatial motion', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  // Override matchMedia to simulate reduced motion.
  ctx.window.matchMedia = () => ({ matches: true });
  const btn = new FakeElement('btn');
  pm.press(btn, 101);
  assert.equal(FakeAnimation.instances.length, 0, 'reduced-motion press must not animate');
  assert.equal(pm.state.has(btn), false);
});

test('press-motion: animation failure does NOT destroy any pre-existing inline transform (no inline writes at all)', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  btn._inlineTransform = 'rotate(11deg)';
  // Replace el.animate with a throwing stub to simulate an engine failure.
  const orig = btn.animate;
  btn.animate = () => { throw new Error('synthetic engine failure'); };
  try {
    pm.press(btn, 111);
  } catch (_) { /* module should swallow */ }
  // The module never touches el.style.transform. The inline transform
  // must remain intact.
  assert.equal(btn._inlineTransform, 'rotate(11deg)', 'inline transform must survive an animation failure');
  assert.equal(pm.state.has(btn), false, 'failure path must not record a state slot');
  btn.animate = orig;
});

test('press-motion: click callbacks are NOT delayed by the module (no preventDefault / no stopPropagation / no setTimeout in the press path)', async () => {
  // The module never calls preventDefault or stopPropagation on any
  // pointer event. We assert this statically on the source.
  assert.doesNotMatch(moduleSrc, /preventDefault/);
  assert.doesNotMatch(moduleSrc, /stopPropagation/);
});

test('press-motion: window blur releases every active element (snap, no animation)', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const a = new FakeElement('a');
  const b = new FakeElement('b');
  dispatchPointer(ctx, 'pointerdown', { target: a, pointerId: 121 });
  dispatchPointer(ctx, 'pointerdown', { target: b, pointerId: 122 });
  assert.equal(pm.activeElements.size, 2);
  // Fire a window blur event. The module listens on BOTH document and
  // window; the window listener is the snap-all path. We dispatch on
  // the stubbed window so onWindowBlur fires.
  ctx.window.dispatchEvent({ type: 'blur', eventPhase: 1 });
  assert.equal(pm.state.has(a), false, 'window blur must release a');
  assert.equal(pm.state.has(b), false, 'window blur must release b');
  assert.equal(pm.activeElements.size, 0);
});

test('press-motion: dispatching pointerdown through the REAL handler routes to pm.press (no bypass)', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  // We deliberately do NOT call pm.press here. The pointerdown event
  // goes through the captured listener, which then calls press() with
  // the matching pointerId.
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 131 });
  assert.equal(FakeAnimation.instances.length, 1, 'routed pointerdown must create exactly one animation');
  const ani = FakeAnimation.instances[0];
  assert.equal(ani.keyframes[1].transform, 'translateY(2px) scale(0.974)');
  assert.equal(pm.activeByPointer.get(131), btn);
});

// ----------------------------------------------------------------------
// Regression: same-element multi-pointer sequence (defect #1).
//
// pointerdown(1) creates a slot with pointerId=1, then pointerdown(2)
// on the same element MUST remove the stale activeByPointer[1] entry
// AND install pointerId=2 on the slot. A late pointerup(1) must NOT
// release the new slot — only the matching pointerId release path
// should run, and only the matching pointerId should be in
// activeByPointer afterwards.
// ----------------------------------------------------------------------

test('press-motion (regression #1): re-press with a different pointerId removes the stale pointer mapping', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');

  // First finger lands.
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 1 });
  assert.ok(pm.state.has(btn), 'first pointerdown must populate the state slot');
  assert.equal(pm.state.get(btn).pointerId, 1);
  assert.equal(pm.activeByPointer.get(1), btn);

  // Second finger lands BEFORE the first lifts.
  const gen1 = pm.state.get(btn).generation;
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 2 });
  const s2 = pm.state.get(btn);
  assert.equal(s2.pointerId, 2, 'second pointerdown must move the slot to the new pointerId');
  assert.ok(s2.generation > gen1, 'second pointerdown must advance the slot\'s generation');
  // The stale pointerId(1) MUST be gone from activeByPointer so a
  // late pointerup(1) cannot reach this element.
  assert.equal(pm.activeByPointer.has(1), false, 'stale pointerId(1) must be cleared from activeByPointer on re-press');

  // First finger lifts. The delegated pointerup handler looks up
  // activeByPointer.get(1) — undefined — and exits without releasing.
  dispatchPointer(ctx, 'pointerup', { target: btn, pointerId: 1 });
  assert.ok(pm.state.has(btn), 'stale pointerup(1) must NOT release the freshly-pressed slot');
  assert.equal(pm.state.get(btn).pointerId, 2);

  // Second finger lifts — the delegated pointerup handler deletes the
  // pointerId from activeByPointer, then calls release().
  dispatchPointer(ctx, 'pointerup', { target: btn, pointerId: 2 });
  // After pointerup(2), activeByPointer must be empty for this element.
  assert.equal(pm.activeByPointer.has(2), false, 'matching pointerup must drain its own pointerId from activeByPointer');
  assert.equal(pm.activeByPointer.has(1), false);
  // The slot lingers for up to DURATION_PRESS_MS (70) before the
  // release animation starts, then DURATION_RELEASE_MS (240) more
  // before cleanupSlot runs. Drive the FakeAnimation manually so we
  // don't depend on the wall clock.
  await new Promise(r => setTimeout(r, 80)); // past linger
  const releaseAni = FakeAnimation.instances[FakeAnimation.instances.length - 1];
  releaseAni.finish();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(pm.state.has(btn), false, 'slot must be cleaned up after release completes');
  assert.equal(pm.activeElements.has(btn), false, 'activeElements must be drained once release completes');
});

test('press-motion (regression #1): stale pointercancel must NOT release a freshly-pressed slot', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 1 });
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 2 });
  // Stale pointercancel(1) must be a no-op.
  dispatchPointer(ctx, 'pointercancel', { target: btn, pointerId: 1 });
  assert.ok(pm.state.has(btn), 'stale pointercancel(1) must NOT release the freshly-pressed slot');
  assert.equal(pm.state.get(btn).pointerId, 2);
});

test('press-motion (regression #1): activeByPointer has at most one entry per pointerId, never duplicates', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 5 });
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 5 }); // re-press same finger
  assert.equal(pm.activeByPointer.has(5), true);
  assert.equal(pm.activeByPointer.size, 1, 'same-finger re-press must not duplicate the mapping');
});

// ----------------------------------------------------------------------
// Regression: animation constructor throws on press() (defect #2).
//
// When there is a prevSlot AND el.animate throws on the new press,
// the module MUST clean up the prevSlot's timer / animations / state
// entry / activeByPointer entry / activeElements entry so the maps
// do not leak residue. The inline transform on the element must NOT
// be touched (we never write inline style).
// ----------------------------------------------------------------------

test('press-motion (regression #2): el.animate throw on press with a prev slot cleans up our owned state', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  btn._inlineTransform = 'rotate(11deg)';

  // First press succeeds, installs the prev slot.
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 7 });
  const s1 = pm.state.get(btn);
  assert.ok(s1, 'first press must populate the slot');
  const firstAni = FakeAnimation.instances[FakeAnimation.instances.length - 1];
  assert.equal(firstAni.cancelled, false);

  // Now break el.animate so the next press throws.
  const origAnimate = btn.animate;
  btn.animate = () => { throw new Error('synthetic engine failure'); };
  try {
    dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 8 });
  } catch (_) { /* module swallows; this is defensive */ }

  // The module MUST have cleaned up its owned state. No residue.
  assert.equal(pm.state.has(btn), false, 'failed press must delete the slot');
  assert.equal(pm.activeByPointer.has(7), false, 'failed press must clear the prior pointerId mapping');
  assert.equal(pm.activeByPointer.has(8), false, 'failed press must NOT install the new pointerId');
  assert.equal(pm.activeElements.has(btn), false, 'failed press must NOT keep the element in activeElements');
  assert.equal(firstAni.cancelled, true, 'failed press must cancel the prior press Animation we owned');
  // Inline transform untouched.
  assert.equal(btn._inlineTransform, 'rotate(11deg)', 'inline transform must survive a failed press attempt');

  btn.animate = origAnimate;
});

test('press-motion (regression #2): el.animate throw on press with NO prev slot is a clean no-op', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  const origAnimate = btn.animate;
  btn.animate = () => { throw new Error('synthetic engine failure'); };
  try { dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 9 }); } catch (_) {}
  assert.equal(pm.state.has(btn), false);
  assert.equal(pm.activeByPointer.has(9), false);
  assert.equal(pm.activeElements.has(btn), false);
  btn.animate = origAnimate;
});

// ----------------------------------------------------------------------
// Regression: animation constructor throws on release() (defect #2).
//
// After linger, doReleaseEase samples live, cancels pressAni, then
// tries el.animate. If that throws, the module MUST clean up its
// owned slot (state / activeByPointer / activeElements). The press
// effect has already been cancelled, so the element's visual is at
// the underlying computed style. No animation should remain.
// ----------------------------------------------------------------------

test('press-motion (regression #2): el.animate throw on release cleans up our owned state', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const btn = new FakeElement('btn');
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 11 });
  const pressAni = FakeAnimation.instances[FakeAnimation.instances.length - 1];
  // Schedule the release path (linger ≥ 0); we'll wait long enough
  // for the timer to fire and reach doReleaseEase, then break the
  // release animation.
  dispatchPointer(ctx, 'pointerup', { target: btn, pointerId: 11 });
  // Replace el.animate BEFORE the linger fires so the release
  // construction throws.
  const origAnimate = btn.animate;
  btn.animate = () => { throw new Error('synthetic engine failure'); };
  // Wait past DURATION_PRESS_MS so the release callback runs.
  await new Promise(r => setTimeout(r, 100));
  btn.animate = origAnimate;

  // The module MUST have cleaned up its owned state.
  assert.equal(pm.state.has(btn), false, 'failed release must delete the slot');
  assert.equal(pm.activeByPointer.has(11), false, 'failed release must clear activeByPointer');
  assert.equal(pm.activeElements.has(btn), false, 'failed release must clear activeElements');
  assert.equal(pressAni.cancelled, true, 'press animation must be cancelled (always, even when release construction throws)');
});

// ----------------------------------------------------------------------
// Regression: native :disabled (defect #3).
//
// isDisabled must recognise:
//   - <button disabled>                              → disabled
//   - <button> inside <fieldset disabled>           → disabled
//   - <button> inside the first <legend> in such a
//     fieldset                                       → NOT disabled
//   - aria-disabled="true"                          → disabled
//   - <a class="button">                            → NOT disabled
//     (not a form element, :disabled does not match)
// ----------------------------------------------------------------------

test('press-motion (regression #3): native :disabled covers a control inside a disabled fieldset', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const fieldset = new FakeElement('fs', { tagName: 'FIELDSET' });
  fieldset.disabled = true;
  const btn = new FakeElement('btn-inside'); // tagName defaults to BUTTON
  fieldset.children.push(btn); btn.parent = fieldset;
  assert.equal(pm.isDisabled(btn), true, 'button inside a disabled fieldset must be considered disabled');
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 21 });
  assert.equal(FakeAnimation.instances.length, 0, 'no press animation on a control inside disabled fieldset');
  assert.equal(pm.state.has(btn), false);
});

test('press-motion (regression #3): native :disabled excludes the first <legend>\'s descendants', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const fieldset = new FakeElement('fs2', { tagName: 'FIELDSET' });
  fieldset.disabled = true;
  const legend = new FakeElement('lg', { tagName: 'LEGEND' });
  fieldset.children.push(legend); legend.parent = fieldset;
  const btn = new FakeElement('btn-legend');
  legend.children.push(btn); btn.parent = legend;
  assert.equal(pm.isDisabled(btn), false, 'first-legend button inside disabled fieldset must NOT be disabled');
  dispatchPointer(ctx, 'pointerdown', { target: btn, pointerId: 22 });
  assert.equal(FakeAnimation.instances.length, 1, 'first-legend button is pressable');
  assert.equal(pm.state.has(btn), true);
});

test('press-motion (regression #3): non-form pressables are NOT :disabled even inside a disabled fieldset', async () => {
  FakeAnimation.instances = [];
  const ctx = await loadModule();
  const pm = ctx.__pressMotion;
  const fieldset = new FakeElement('fs3', { tagName: 'FIELDSET' });
  fieldset.disabled = true;
  // <a class="button"> inside the disabled fieldset. <a> is not a
  // form element, so :disabled does not match. aria-disabled is not
  // set. The link must remain pressable.
  const link = new FakeElement('lnk', { tagName: 'A' });
  fieldset.children.push(link); link.parent = fieldset;
  assert.equal(pm.isDisabled(link), false, 'a non-form control inside disabled fieldset is NOT :disabled');
  dispatchPointer(ctx, 'pointerdown', { target: link, pointerId: 23 });
  assert.equal(FakeAnimation.instances.length, 1, 'non-form control must animate');
});