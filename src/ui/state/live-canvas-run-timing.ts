import type { GcodeTimingPlan, GcodeTimingPlanResult } from '../../core/gcode-time';
import type { MotionBlock, MotionManifest } from '../../core/job/motion-manifest';
import type { LaserState } from './laser-store';
import {
  completeLiveJobTiming,
  disconnectLiveJobTiming,
  finishLiveJobTiming,
  interruptLiveJobTiming,
  observeTrustedLiveJobProgress,
  pauseLiveJobTiming,
  runLiveJobTiming,
  startLiveJobTiming,
  type LiveJobTiming,
} from './live-job-timing';
import type { LiveCanvasLifecycle, LiveCanvasRun } from './canvas-motion-plan';

export function initialLiveCanvasTiming(
  result: GcodeTimingPlanResult | undefined,
  now: number,
  initialLifecycle: 'running' | 'tool-change',
): LiveJobTiming {
  const timing = startLiveJobTiming(result, now);
  return initialLifecycle === 'tool-change' ? pauseLiveJobTiming(timing, now) : timing;
}

export function liveCanvasTimingForStatus(
  previous: LiveCanvasRun,
  updated: LiveCanvasRun,
  trustworthyRouteProgress: boolean,
  now: number,
  controllerExecutionConfirmed: boolean,
): LiveJobTiming | undefined {
  const timing = previous.timing;
  if (timing === undefined) return undefined;
  // `running` is also the canvas run's pre-write lifecycle. A generic Idle
  // frame can arrive while the first transport promise is still pending; only
  // the explicit accepted-write patch or a trustworthy fresh Run report may
  // start consuming the estimate. Route proof is stricter and only calibrates
  // pacing after the run clock is active.
  const transitioned =
    timing.kind === 'estimating' && updated.lifecycle === 'running' && !controllerExecutionConfirmed
      ? timing
      : liveCanvasTimingForLifecycle(timing, updated.lifecycle, now);
  if (transitioned === undefined || !trustworthyRouteProgress || updated.lifecycle !== 'running') {
    return transitioned;
  }
  if (
    transitioned.kind !== 'estimating' &&
    transitioned.kind !== 'running' &&
    transitioned.kind !== 'paused'
  ) {
    return transitioned;
  }
  const timingRoute = timingRouteAtManifestRoute(
    transitioned.plan,
    updated.plan.manifest,
    updated.route.confirmedRouteMm,
  );
  return timingRoute === null
    ? transitioned
    : observeTrustedLiveJobProgress(transitioned, timingRoute, now);
}

/**
 * Maps the live manifest's route basis onto the timing parser's route basis.
 * Both carriers identify exact raw G-code lines, but arcs may use different
 * tessellation tolerances, so absolute route millimetres are not interchangeable.
 */
export function timingRouteAtManifestRoute(
  plan: GcodeTimingPlan,
  manifest: MotionManifest,
  routeMm: number,
): number | null {
  if (routeMm <= 0) return 0;
  if (routeMm >= manifest.totalRouteMm) return plan.totalRouteMm;
  const blockIndex = manifestBlockIndexAtRoute(manifest.blocks, routeMm);
  const block = manifest.blocks[blockIndex];
  if (block === undefined) {
    return manifest.blocks.length === 0 ? null : plan.totalRouteMm;
  }
  const manifestLineSpan = manifestRouteSpanForRawLine(manifest.blocks, blockIndex, block);
  const timingLineSpan = timingRouteSpanForRawLine(plan, block.rawLineIndex);
  if (timingLineSpan === null) return null;
  const fraction = routeFraction(routeMm, manifestLineSpan.start, manifestLineSpan.end);
  return timingLineSpan.start + (timingLineSpan.end - timingLineSpan.start) * Math.min(1, fraction);
}

export function liveCanvasLifecyclePatch(
  state: LaserState,
  lifecycle: Exclude<LiveCanvasLifecycle, 'finished'>,
  now: number = Date.now(),
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  const run = state.liveCanvasRun ?? null;
  if (run === null) return {};
  if (run.lifecycle === 'finished' && lifecycle === 'running') return {};
  const timing = liveCanvasTimingForLifecycle(run.timing, lifecycle, now);
  return {
    liveCanvasRun: {
      ...run,
      lifecycle,
      endedAtMs: endStampFor(run, lifecycle, now),
      ...(timing === undefined ? {} : { timing }),
    },
  };
}

/** Marks display completion only after the active driver's settle contract. */
export function completeLiveCanvasRun(run: LiveCanvasRun | null): LiveCanvasRun | null {
  if (run === null) return null;
  return { ...run, timing: completeLiveJobTiming() };
}

export function liveCanvasFinishingPatch(
  state: LaserState,
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  const run = state.liveCanvasRun ?? null;
  if (run === null || run.timing === undefined) return {};
  return {
    liveCanvasRun: {
      ...run,
      timing: finishLiveJobTiming(run.timing),
    },
  };
}

export function liveCanvasTimingUnavailablePatch(
  state: LaserState,
  reason: string,
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  const run = state.liveCanvasRun ?? null;
  if (run === null || run.timing === undefined || run.timing.kind === 'complete') return {};
  return {
    liveCanvasRun: {
      ...run,
      timing: interruptLiveJobTiming(reason),
    },
  };
}

// The first terminal transition freezes the elapsed readout; later report
// churn (trailing status frames, repeated stop patches) must not move it.
export function endStampFor(
  run: LiveCanvasRun,
  lifecycle: LiveCanvasLifecycle,
  now: number,
): number | null {
  if (run.endedAtMs !== null) return run.endedAtMs;
  return isTerminalCanvasLifecycle(lifecycle) ? now : null;
}

function liveCanvasTimingForLifecycle(
  timing: LiveJobTiming | undefined,
  lifecycle: LiveCanvasLifecycle,
  now: number,
): LiveJobTiming | undefined {
  if (timing === undefined || timing.kind === 'complete') return timing;
  switch (lifecycle) {
    case 'running':
      return runLiveJobTiming(timing, now);
    case 'paused':
    case 'tool-change':
      return pauseLiveJobTiming(timing, now);
    case 'disconnected':
      return disconnectLiveJobTiming(timing);
    case 'finished':
      return finishLiveJobTiming(timing);
    case 'stopped':
      return interruptLiveJobTiming('job stopped');
    case 'errored':
      return interruptLiveJobTiming('controller reported a job error');
  }
}

function isTerminalCanvasLifecycle(lifecycle: LiveCanvasLifecycle): boolean {
  return (
    lifecycle === 'stopped' ||
    lifecycle === 'disconnected' ||
    lifecycle === 'errored' ||
    lifecycle === 'finished'
  );
}

function manifestBlockIndexAtRoute(blocks: MotionManifest['blocks'], routeMm: number): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((blocks[middle]?.routeEndMm ?? Number.POSITIVE_INFINITY) >= routeMm) high = middle;
    else low = middle + 1;
  }
  return low;
}

function manifestRouteSpanForRawLine(
  blocks: MotionManifest['blocks'],
  blockIndex: number,
  block: MotionBlock,
): { readonly start: number; readonly end: number } {
  let first = blockIndex;
  let last = blockIndex;
  while (first > 0 && blocks[first - 1]?.rawLineIndex === block.rawLineIndex) first -= 1;
  while (last + 1 < blocks.length && blocks[last + 1]?.rawLineIndex === block.rawLineIndex)
    last += 1;
  return {
    start: blocks[first]?.routeStartMm ?? block.routeStartMm,
    end: blocks[last]?.routeEndMm ?? block.routeEndMm,
  };
}

function timingRouteSpanForRawLine(
  plan: GcodeTimingPlan,
  rawLineIndex: number,
): { readonly start: number; readonly end: number } | null {
  const first = firstSegmentAtOrAfterRawLine(plan.segmentRawLine, rawLineIndex);
  if (first >= plan.segmentRawLine.length || plan.segmentRawLine[first] !== rawLineIndex)
    return null;
  let after = first + 1;
  while (after < plan.segmentRawLine.length && plan.segmentRawLine[after] === rawLineIndex) {
    after += 1;
  }
  return {
    start: plan.routeStartMm[first] ?? 0,
    end: plan.routeEndMm[after - 1] ?? plan.routeStartMm[first] ?? 0,
  };
}

function firstSegmentAtOrAfterRawLine(lines: Uint32Array, rawLineIndex: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((lines[middle] ?? Number.POSITIVE_INFINITY) >= rawLineIndex) high = middle;
    else low = middle + 1;
  }
  return low;
}

function routeFraction(routeMm: number, startMm: number, endMm: number): number {
  const span = endMm - startMm;
  if (span <= Number.EPSILON) return 1;
  return Math.max(0, Math.min(1, (routeMm - startMm) / span));
}
