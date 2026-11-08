import { expect, type Page, type TestInfo } from '@playwright/test';

export const MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS = 1_000;
// Shared CI runners sometimes stop scheduling the whole renderer for over a
// second while the page itself is idle: main's Browser smoke saw a 1,593 ms
// heartbeat gap with no Long Task at all, and a 1,345 ms gap whose largest
// Long Task was 79 ms. On CI a gap may pass the local budget only while the
// Long Task observer shows the page's own work did not fill it (see
// maxGapLongTaskMs), and never this ceiling. Local runs keep the strict budget.
export const CI_UNATTRIBUTED_GAP_CEILING_MS = 2_000;
// Gaps shorter than this cannot hold a budget-sized block, so the probe does
// not keep their spans.
const RECORDED_GAP_MS = 250;

export interface ResponsivenessMeasurement {
  readonly ticks: number;
  readonly maxGapMs: number;
  /** The most Long Task time inside any one heartbeat gap: the page's own work. */
  readonly maxGapLongTaskMs: number;
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
  gaps: { readonly start: number; readonly end: number }[];
  longTasks: { readonly start: number; readonly duration: number }[];
  observer: PerformanceObserver | null;
  summarize: (at: number) => ResponsivenessMeasurement;
}

type ProbeWindow = typeof window & {
  __HEAVY_CANVAS_RESPONSIVENESS__?: ResponsivenessProbeState;
};

export async function startResponsivenessProbe(page: Page): Promise<void> {
  await page.evaluate((recordedGapMs) => {
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
      gaps: [],
      longTasks: [],
      observer: null,
      summarize: (at) => {
        closeGap(at);
        if (state.observer !== null) {
          for (const entry of state.observer.takeRecords()) addLongTask(entry);
        }
        let maxGapLongTaskMs = 0;
        for (const gap of state.gaps) {
          let busy = 0;
          for (const task of state.longTasks) {
            const overlap =
              Math.min(gap.end, task.start + task.duration) - Math.max(gap.start, task.start);
            if (overlap > 0) busy += overlap;
          }
          maxGapLongTaskMs = Math.max(maxGapLongTaskMs, busy);
        }
        return {
          ticks: state.ticks,
          maxGapMs: state.maxGapMs,
          maxGapLongTaskMs,
          elapsedMs: at - state.startedAt,
          longTaskCount: state.longTasks.length,
          maxLongTaskMs: Math.max(0, ...state.longTasks.map((task) => task.duration)),
          longTaskObserverSupported: state.observer !== null,
        };
      },
    };
    function addLongTask(entry: PerformanceEntry): void {
      state.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }
    function closeGap(at: number): void {
      const gap = at - state.lastAt;
      state.maxGapMs = Math.max(state.maxGapMs, gap);
      if (gap >= recordedGapMs) state.gaps.push({ start: state.lastAt, end: at });
      state.lastAt = at;
    }
    if (
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes.includes('longtask')
    ) {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) addLongTask(entry);
      });
      state.observer.observe({ entryTypes: ['longtask'] });
    }
    state.timer = window.setInterval(() => {
      state.ticks += 1;
      closeGap(performance.now());
    }, 10);
    target.__HEAVY_CANVAS_RESPONSIVENESS__ = state;
  }, RECORDED_GAP_MS);
}

export async function stopResponsivenessProbe(page: Page): Promise<ResponsivenessMeasurement> {
  return page.evaluate(() => {
    const target = window as ProbeWindow;
    const state = target.__HEAVY_CANVAS_RESPONSIVENESS__;
    if (state === undefined) {
      return {
        ticks: 0,
        maxGapMs: Number.POSITIVE_INFINITY,
        maxGapLongTaskMs: Number.POSITIVE_INFINITY,
        elapsedMs: 0,
        longTaskCount: 0,
        maxLongTaskMs: Number.POSITIVE_INFINITY,
        longTaskObserverSupported: false,
      };
    }
    const result = state.summarize(performance.now());
    window.clearInterval(state.timer);
    state.observer?.disconnect();
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
    const result = state.summarize(rolledAt);
    state.ticks = 0;
    state.startedAt = rolledAt;
    state.lastAt = rolledAt;
    state.maxGapMs = 0;
    state.gaps = [];
    state.longTasks = [];
    return result;
  });
}

/** The heartbeat gap ceiling for this run: strict locally, tolerant of runner stalls on CI. */
export function heartbeatGapCeilingMs(onCi = isCi()): number {
  return onCi ? CI_UNATTRIBUTED_GAP_CEILING_MS : MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS;
}

export function assertResponsivePhase(
  testInfo: TestInfo,
  phase: string,
  measurement: ResponsivenessMeasurement,
  gapCeilingMs = heartbeatGapCeilingMs(),
): void {
  recordResponsivenessPhase(testInfo, phase, measurement);
  expect(measurement.ticks, `${phase} heartbeat ticks`).toBeGreaterThan(10);
  if (!measurement.longTaskObserverSupported) {
    // Without Long Tasks a runner stall cannot be told from the page's own work.
    expect(measurement.maxGapMs, `${phase} maximum heartbeat gap`).toBeLessThan(
      MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS,
    );
    return;
  }
  expect(measurement.maxLongTaskMs, `${phase} maximum Long Task`).toBeLessThan(
    MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS,
  );
  expect(
    measurement.maxGapLongTaskMs,
    `${phase} Long Task time inside one heartbeat gap`,
  ).toBeLessThan(MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS);
  expect(measurement.maxGapMs, `${phase} maximum heartbeat gap`).toBeLessThan(gapCeilingMs);
  if (measurement.maxGapMs >= MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS) {
    // Passed only on the CI tolerance: keep the drift visible in the log.
    const note =
      `${phase}: heartbeat gap over the ${MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS} ms local budget ` +
      `without page work filling it: ${formatMeasurement(measurement)}`;
    testInfo.annotations.push({ type: 'warning', description: note });
    console.info(note);
  }
}

/** Requires a Chrome phase to avoid UI-thread monopolization while retaining scheduler telemetry. */
export function assertOffThreadPhase(
  testInfo: TestInfo,
  phase: string,
  measurement: ResponsivenessMeasurement,
): void {
  recordResponsivenessPhase(testInfo, phase, measurement);
  expect(measurement.ticks, `${phase} heartbeat ticks`).toBeGreaterThan(10);
  expect(measurement.longTaskObserverSupported, `${phase} Long Task observer`).toBe(true);
  expect(measurement.maxLongTaskMs, `${phase} maximum Long Task`).toBeLessThan(
    MAX_ACCEPTABLE_MAIN_THREAD_GAP_MS,
  );
}

/** Records telemetry only, including preview readiness and retired-pane A/B
 * phases. Readiness is asserted at those call sites; strict performance phases
 * use the assert helpers above to require samples and enforce their budgets. */
export function recordResponsivenessPhase(
  testInfo: TestInfo,
  phase: string,
  measurement: ResponsivenessMeasurement,
): void {
  testInfo.annotations.push({
    type: 'measurement',
    description: `${phase}: ${formatMeasurement(measurement)}`,
  });
}

function isCi(): boolean {
  const value = process.env['CI'];
  return value !== undefined && value !== '' && value !== 'false' && value !== '0';
}

function formatMeasurement(measurement: ResponsivenessMeasurement): string {
  return [
    `elapsedMs=${measurement.elapsedMs.toFixed(1)}`,
    `ticks=${measurement.ticks}`,
    `maxGapMs=${measurement.maxGapMs.toFixed(1)}`,
    `maxGapLongTaskMs=${measurement.maxGapLongTaskMs.toFixed(1)}`,
    `longTasks=${measurement.longTaskCount}`,
    `maxLongTaskMs=${measurement.maxLongTaskMs.toFixed(1)}`,
    `longTaskObserver=${measurement.longTaskObserverSupported ? 'yes' : 'no'}`,
  ].join('; ');
}
