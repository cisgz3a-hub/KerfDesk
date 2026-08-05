import { expect, type Page, type TestInfo } from '@playwright/test';

export const MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS = 1_000;

export interface ResponsivenessMeasurement {
  readonly ticks: number;
  readonly maxGapMs: number;
  readonly elapsedMs: number;
  readonly longTaskCount: number;
  readonly maxLongTaskMs: number;
  readonly longTaskObserverSupported: boolean;
}

interface ResponsivenessProbeState {
  ticks: number;
  timer: number;
  startedAt: number;
  lastAt: number;
  maxGapMs: number;
  longTasks: number[];
  observer: PerformanceObserver | null;
}

type ProbeWindow = typeof window & {
  __HEAVY_CANVAS_RESPONSIVENESS__?: ResponsivenessProbeState;
};

export async function startResponsivenessProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as ProbeWindow;
    const previous = target.__HEAVY_CANVAS_RESPONSIVENESS__;
    if (previous !== undefined) {
      window.clearInterval(previous.timer);
      previous.observer?.disconnect();
    }
    const now = performance.now();
    const state: ResponsivenessProbeState = {
      ticks: 0,
      timer: 0,
      startedAt: now,
      lastAt: now,
      maxGapMs: 0,
      longTasks: [],
      observer: null,
    };
    if (
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes.includes('longtask')
    ) {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
      });
      state.observer.observe({ entryTypes: ['longtask'] });
    }
    state.timer = window.setInterval(() => {
      const current = performance.now();
      state.ticks += 1;
      state.maxGapMs = Math.max(state.maxGapMs, current - state.lastAt);
      state.lastAt = current;
    }, 10);
    target.__HEAVY_CANVAS_RESPONSIVENESS__ = state;
  });
}

export async function stopResponsivenessProbe(page: Page): Promise<ResponsivenessMeasurement> {
  return page.evaluate(() => {
    const target = window as ProbeWindow;
    const state = target.__HEAVY_CANVAS_RESPONSIVENESS__;
    if (state === undefined) {
      return {
        ticks: 0,
        maxGapMs: Number.POSITIVE_INFINITY,
        elapsedMs: 0,
        longTaskCount: 0,
        maxLongTaskMs: Number.POSITIVE_INFINITY,
        longTaskObserverSupported: false,
      };
    }
    const stoppedAt = performance.now();
    state.maxGapMs = Math.max(state.maxGapMs, stoppedAt - state.lastAt);
    window.clearInterval(state.timer);
    if (state.observer !== null) {
      for (const entry of state.observer.takeRecords()) state.longTasks.push(entry.duration);
      state.observer.disconnect();
    }
    const result = {
      ticks: state.ticks,
      maxGapMs: state.maxGapMs,
      elapsedMs: stoppedAt - state.startedAt,
      longTaskCount: state.longTasks.length,
      maxLongTaskMs: Math.max(0, ...state.longTasks),
      longTaskObserverSupported: state.observer !== null,
    };
    delete target.__HEAVY_CANVAS_RESPONSIVENESS__;
    return result;
  });
}

/** Returns the current phase and starts the next without leaving an unmeasured browser gap. */
export async function rollResponsivenessProbe(page: Page): Promise<ResponsivenessMeasurement> {
  return page.evaluate(() => {
    const target = window as ProbeWindow;
    const state = target.__HEAVY_CANVAS_RESPONSIVENESS__;
    if (state === undefined) throw new Error('Responsiveness probe is not running');
    const rolledAt = performance.now();
    state.maxGapMs = Math.max(state.maxGapMs, rolledAt - state.lastAt);
    if (state.observer !== null) {
      for (const entry of state.observer.takeRecords()) state.longTasks.push(entry.duration);
    }
    const result = {
      ticks: state.ticks,
      maxGapMs: state.maxGapMs,
      elapsedMs: rolledAt - state.startedAt,
      longTaskCount: state.longTasks.length,
      maxLongTaskMs: Math.max(0, ...state.longTasks),
      longTaskObserverSupported: state.observer !== null,
    };
    state.ticks = 0;
    state.startedAt = rolledAt;
    state.lastAt = rolledAt;
    state.maxGapMs = 0;
    state.longTasks = [];
    return result;
  });
}

export function assertResponsivePhase(
  testInfo: TestInfo,
  phase: string,
  measurement: ResponsivenessMeasurement,
): void {
  recordResponsivenessPhase(testInfo, phase, measurement);
  expect(measurement.maxGapMs, `${phase} maximum heartbeat gap`).toBeLessThan(
    MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS,
  );
  if (measurement.longTaskObserverSupported) {
    expect(measurement.maxLongTaskMs, `${phase} maximum Long Task`).toBeLessThan(
      MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS,
    );
  }
}

/** Requires a Chrome phase to avoid UI-thread monopolization while retaining scheduler telemetry. */
export function assertOffThreadPhase(
  testInfo: TestInfo,
  phase: string,
  measurement: ResponsivenessMeasurement,
): void {
  recordResponsivenessPhase(testInfo, phase, measurement);
  expect(measurement.longTaskObserverSupported, `${phase} Long Task observer`).toBe(true);
  expect(measurement.maxLongTaskMs, `${phase} maximum Long Task`).toBeLessThan(
    MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS,
  );
}

/** Records diagnostic A/B phases that are intentionally absent from production. */
export function recordResponsivenessPhase(
  testInfo: TestInfo,
  phase: string,
  measurement: ResponsivenessMeasurement,
): void {
  testInfo.annotations.push({
    type: 'measurement',
    description: `${phase}: ${formatMeasurement(measurement)}`,
  });
  expect(measurement.ticks, `${phase} heartbeat ticks`).toBeGreaterThan(10);
}

function formatMeasurement(measurement: ResponsivenessMeasurement): string {
  return [
    `elapsedMs=${measurement.elapsedMs.toFixed(1)}`,
    `ticks=${measurement.ticks}`,
    `maxGapMs=${measurement.maxGapMs.toFixed(1)}`,
    `longTasks=${measurement.longTaskCount}`,
    `maxLongTaskMs=${measurement.maxLongTaskMs.toFixed(1)}`,
    `longTaskObserver=${measurement.longTaskObserverSupported ? 'yes' : 'no'}`,
  ].join('; ');
}
