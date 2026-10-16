import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  NATIVE_CANVAS_OBSERVER_SOURCE,
  NATIVE_CANVAS_SNAPSHOT_SOURCE,
  NATIVE_CANVAS_RESET_SOURCE,
} from './packaged-canvas-observer.mjs';

function harness(locale = 'en-US') {
  let now = 0,
    frame;
  const listeners = new Map();
  const canvas = {
    width: 100,
    height: 100,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }),
  };
  const status = {
    textContent: 'Trace ready · 3,302 paths · 30,085 nodes',
    getAttribute: () => 'ready',
  };
  let visible = true;
  const context = vm.createContext({
    window: {},
    navigator: { language: locale },
    devicePixelRatio: 1,
    performance: { now: () => now },
    requestAnimationFrame: (callback) => ((frame = callback), 1),
    cancelAnimationFrame: () => {
      frame = null;
    },
    document: {
      visibilityState: 'visible',
      querySelector: (selector) =>
        selector.startsWith('canvas')
          ? canvas
          : selector.includes('__status')
            ? visible
              ? status
              : null
            : { value: 'Line Art' },
      querySelectorAll: () => [],
      addEventListener: (type, callback) => listeners.set(type, callback),
      removeEventListener: (type) => listeners.delete(type),
    },
  });
  const install = () => vm.runInContext(NATIVE_CANVAS_OBSERVER_SOURCE, context);
  install();
  return {
    context,
    status,
    install,
    observer: context.window.__kerfdeskNativeCanvasObservation,
    hide: () => {
      visible = false;
    },
    time: (value) => {
      now = value;
    },
    frame: (value) => {
      now = value;
      frame(value);
    },
    input: () =>
      listeners.get('wheel')({
        target: canvas,
        isTrusted: true,
        type: 'wheel',
        buttons: 0,
        button: 0,
        clientX: 0,
        clientY: 0,
        deltaX: 0,
        deltaY: 1,
        deltaMode: 0,
      }),
  };
}

test('locale-formatted counts retain their complete integer meaning', () => {
  for (const locale of ['en-US', 'de-DE', 'fr-FR', 'ar-EG', 'fa-IR', 'hi-IN']) {
    const h = harness(locale);
    const format = new Intl.NumberFormat(locale);
    h.status.textContent = `Trace ready · ${format.format(3302)} paths · ${format.format(30085)} nodes`;
    assert.equal(h.observer.snapshot().activeTrace.displayedPathCount, 3302, locale);
    assert.equal(h.observer.snapshot().activeTrace.displayedNodeCount, 30085, locale);
  }
});

test('reset clears old trace history and records any still-visible trace in the new epoch', () => {
  const h = harness();
  h.time(100);
  h.observer.snapshot();
  h.time(200);
  const reset = h.observer.reset();
  assert.equal(reset.traceHistory.length, 1);
  assert.equal(reset.lastTrace.atMs, 0);
  h.hide();
  h.time(300);
  const hidden = h.observer.reset();
  assert.equal(hidden.lastTrace, null);
  assert.equal(hidden.traceHistory.length, 0);
});

test('install rejects stale observers without replacing or disposing them', () => {
  const h = harness();
  assert.deepEqual(h.install(), h.install());
  const other = harness();
  Object.defineProperty(other.context.window, '__kerfdeskNativeCanvasObservation', {
    configurable: true,
    value: { snapshot: () => ({ old: true }) },
  });
  assert.throws(() => other.install(), /version|identity|stale/i);
  for (const source of [NATIVE_CANVAS_SNAPSHOT_SOURCE, NATIVE_CANVAS_RESET_SOURCE])
    assert.throws(() => vm.runInContext(source, other.context), /identity/);
  Object.defineProperty(other.context.window, '__kerfdeskNativeCanvasObservation', {
    configurable: true,
    value: { version: 2, sourceId: 'different' },
  });
  assert.throws(() => other.install(), /identity/);
});

test('counts the first stalled post-input frame without counting subsequent idle frames', () => {
  const h = harness();
  h.frame(0);
  h.time(10);
  h.input();
  h.frame(900);
  h.frame(920);
  const stats = h.observer.snapshot().navigationFrameIntervals;
  assert.equal(stats.count, 1);
  assert.equal(stats.maxMs, 900);
});

test('first frame after reset records input-to-frame latency and reset removes pending input', () => {
  const h = harness();
  h.observer.reset();
  h.time(10);
  h.input();
  h.frame(900);
  assert.equal(h.observer.snapshot().navigationFrameIntervals.maxMs, 890);
  h.time(1000);
  h.input();
  h.observer.reset();
  h.frame(1900);
  assert.equal(h.observer.snapshot().navigationFrameIntervals.count, 0);
});
