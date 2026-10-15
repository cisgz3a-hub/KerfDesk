// Fixed attach-only diagnostic source. It is never bundled into the shipped application.
// It observes the main renderer only. Worker canvases and actual presentation are not measured.
export const NATIVE_CANVAS_OBSERVER_SOURCE = String.raw`(() => {
  const key = '__kerfdeskNativeCanvasObservation';
  if (window[key]) return { installed: true };
  let canvas = document.querySelector('canvas[aria-label$=" workspace"]');
  let startedAt = performance.now();
  const methods = ['drawImage', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'fill', 'stroke'];
  const emptyCounts = () => Object.fromEntries(methods.map((name) => [name, 0]));
  const commands = {
    workspace: emptyCounts(), otherCanvas2d: emptyCounts(), offscreenCanvas2d: emptyCounts(),
  };
  const restorers = [];
  const patch = (prototype, offscreen) => {
    if (!prototype) return;
    for (const name of methods) {
      const original = prototype[name];
      if (typeof original !== 'function') continue;
      const wrapped = function (...args) {
        const target = this.canvas === canvas ? commands.workspace
          : offscreen ? commands.offscreenCanvas2d : commands.otherCanvas2d;
        target[name] += 1;
        return Reflect.apply(original, this, args);
      };
      prototype[name] = wrapped;
      restorers.push(() => { if (prototype[name] === wrapped) prototype[name] = original; });
    }
  };
  patch(typeof CanvasRenderingContext2D === 'undefined' ? null : CanvasRenderingContext2D.prototype, false);
  patch(typeof OffscreenCanvasRenderingContext2D === 'undefined' ? null : OffscreenCanvasRenderingContext2D.prototype, true);
  const inputs = { pointerdown: 0, pointermove: 0, pointerup: 0, pointercancel: 0, wheel: 0, syntheticIgnored: 0 };
  const inputEvents = [];
  let lastNavigationInput = -Infinity;
  const inputTypes = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel'];
  const onInput = (event) => {
    if (event.target !== canvas) return;
    if (!event.isTrusted) { inputs.syntheticIgnored += 1; return; }
    inputs[event.type] += 1;
    if (event.type === 'wheel' || event.buttons !== 0) lastNavigationInput = performance.now();
    inputEvents.push({
      atMs: performance.now() - startedAt, type: event.type, button: event.button,
      buttons: event.buttons, x: event.clientX, y: event.clientY,
      ...(event.type === 'wheel' ? { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode } : {}),
    });
    if (inputEvents.length > 40) inputEvents.shift();
  };
  for (const type of inputTypes) document.addEventListener(type, onInput, { capture: true, passive: true });
  const distribution = () => ({
    count: 0, totalMs: 0, maxMs: 0,
    upperBoundsMs: [8.34, 16.67, 33.34, 50, 100, 250, null],
    buckets: [0, 0, 0, 0, 0, 0, 0],
  });
  const record = (stats, duration) => {
    stats.count += 1; stats.totalMs += duration; stats.maxMs = Math.max(stats.maxMs, duration);
    const index = stats.upperBoundsMs.findIndex((bound) => bound === null || duration <= bound);
    stats.buckets[index] += 1;
  };
  const frameIntervals = distribution();
  const navigationFrameIntervals = distribution();
  let previousFrame = null;
  let raf = 0;
  let disposed = false;
  const onFrame = (now) => {
    if (disposed) return;
    if (previousFrame !== null) {
      const duration = now - previousFrame;
      record(frameIntervals, duration);
      if (now - lastNavigationInput <= 500) record(navigationFrameIntervals, duration);
    }
    previousFrame = now;
    raf = requestAnimationFrame(onFrame);
  };
  raf = requestAnimationFrame(onFrame);
  const longTasks = distribution();
  let observer = null;
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime >= startedAt) record(longTasks, entry.duration);
      }
    });
    observer.observe({ type: 'longtask' });
  }
  let lastTrace = null;
  const traceHistory = [];
  const traceObservation = () => {
    const status = document.querySelector('.lf-trace-preview__status');
    if (!status) return null;
    const text = status.textContent?.trim().slice(0, 500) ?? '';
    const preset = document.querySelector('select[aria-label="Trace preset"]')?.value ?? null;
    const observation = {
      atMs: performance.now() - startedAt, state: status.getAttribute('data-state'), text, preset,
      displayedPathCount: Number(text.match(/([\d,]+) paths?/i)?.[1]?.replaceAll(',', '')) || null,
      displayedNodeCount: Number(text.match(/([\d,]+) nodes?/i)?.[1]?.replaceAll(',', '')) || null,
      svgPathElements: document.querySelectorAll('.lf-trace-preview__vectors svg path').length,
    };
    if (!lastTrace || lastTrace.text !== text || lastTrace.preset !== preset) {
      lastTrace = observation;
      traceHistory.push(observation);
      if (traceHistory.length > 20) traceHistory.shift();
    }
    return observation;
  };
  const snapshot = () => {
    canvas = document.querySelector('canvas[aria-label$=" workspace"]');
    const rect = canvas?.getBoundingClientRect();
    const activeTrace = traceObservation();
    return JSON.parse(JSON.stringify({
      elapsedMs: performance.now() - startedAt, visibility: document.visibilityState,
      canvas: canvas ? { width: canvas.width, height: canvas.height, devicePixelRatio,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : null,
      commands, inputs, recentInputEvents: inputEvents, frameIntervals, navigationFrameIntervals,
      longTasksSupported: observer !== null, longTasks, activeTrace, lastTrace, traceHistory,
      nodePrimitives: { require: typeof require, process: typeof process, module: typeof module, Buffer: typeof Buffer },
      limitations: [
        'rAF intervals describe scheduling, not presented FPS.',
        'isTrusted excludes DOM-dispatched input, but does not distinguish OS from Electron input.',
        'Other canvas counts include all main-renderer non-workspace contexts; workers are excluded.',
        'Trace counts are visible preview status, not a saved-project geometry verification.',
      ],
    }));
  };
  const reset = () => {
    startedAt = performance.now();
    observer?.takeRecords();
    for (const group of Object.values(commands)) for (const method of methods) group[method] = 0;
    for (const type of Object.keys(inputs)) inputs[type] = 0;
    for (const stats of [frameIntervals, navigationFrameIntervals, longTasks]) {
      stats.count = 0; stats.totalMs = 0; stats.maxMs = 0; stats.buckets.fill(0);
    }
    inputEvents.length = 0; previousFrame = null; lastNavigationInput = -Infinity;
    return snapshot();
  };
  const dispose = () => {
    disposed = true;
    cancelAnimationFrame(raf);
    observer?.disconnect();
    for (const type of inputTypes) document.removeEventListener(type, onInput, { capture: true });
    for (const restore of restorers) restore();
    delete window[key];
  };
  Object.defineProperty(window, key, { configurable: true, value: Object.freeze({ snapshot, reset, dispose }) });
  return { installed: true };
})()`;

export const NATIVE_CANVAS_SNAPSHOT_SOURCE = 'window.__kerfdeskNativeCanvasObservation.snapshot()';
