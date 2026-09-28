// ADR-502: turns a started job's lifecycle into measured run time. Pure logic.
//
// A job counts while it is running; pauses and tool changes stop the clock,
// and the job ends at its first stop, disconnect, error or finish. Only a
// started job has a live run, so frames, jogs and console moves never count.
// The observing hook checkpoints every minute while timers can run.

import type { LiveCanvasLifecycle, LiveCanvasRun } from './canvas-motion-plan';

export const RUN_CLOCK_FLUSH_MS = 60_000;

export type RunClock = {
  readonly plan: LiveCanvasRun['plan'];
  readonly startedAtMs: number;
  readonly runningSinceMs: number | null;
  readonly ended: boolean;
};

export type RunClockStep = {
  readonly clock: RunClock | null;
  /** Run time to add now. */
  readonly addMs: number;
  /** True once, when a job that ran has ended. */
  readonly jobEnded: boolean;
};

type RunView = Pick<LiveCanvasRun, 'plan' | 'startedAtMs' | 'lifecycle'>;

const HELD: ReadonlySet<LiveCanvasLifecycle> = new Set(['paused', 'tool-change']);

export function advanceRunClock(
  clock: RunClock | null,
  run: RunView | null,
  now: number,
): RunClockStep {
  const sameRun =
    clock !== null &&
    run !== null &&
    clock.plan === run.plan &&
    clock.startedAtMs === run.startedAtMs;
  if (sameRun) return advanceSameRun(clock, run.lifecycle, now);
  // The run changed or went away: whatever was still open ends here.
  const closed = clock === null ? NOTHING : endRun(clock, now);
  if (run === null) return { ...closed, clock: null };
  // A completed run is retained for the canvas. A newly mounted observer did
  // not watch that job run and must not count it again.
  if (run.lifecycle !== 'running' && !HELD.has(run.lifecycle)) {
    return { ...closed, clock: null };
  }
  const opened = advanceSameRun(
    { plan: run.plan, startedAtMs: run.startedAtMs, runningSinceMs: null, ended: false },
    run.lifecycle,
    now,
  );
  return {
    clock: opened.clock,
    addMs: closed.addMs + opened.addMs,
    jobEnded: closed.jobEnded || opened.jobEnded,
  };
}

const NOTHING: RunClockStep = { clock: null, addMs: 0, jobEnded: false };

function advanceSameRun(
  clock: RunClock,
  lifecycle: LiveCanvasLifecycle,
  now: number,
): RunClockStep {
  if (clock.ended) return { clock, addMs: 0, jobEnded: false };
  if (lifecycle === 'running') {
    if (clock.runningSinceMs === null) {
      return { clock: { ...clock, runningSinceMs: now }, addMs: 0, jobEnded: false };
    }
    const elapsed = now - clock.runningSinceMs;
    if (elapsed < RUN_CLOCK_FLUSH_MS) return { clock, addMs: 0, jobEnded: false };
    return { clock: { ...clock, runningSinceMs: now }, addMs: elapsed, jobEnded: false };
  }
  if (HELD.has(lifecycle)) {
    return {
      clock: { ...clock, runningSinceMs: null },
      addMs: runningMs(clock, now),
      jobEnded: false,
    };
  }
  return endRun(clock, now);
}

function endRun(clock: RunClock, now: number): RunClockStep {
  if (clock.ended) return { clock, addMs: 0, jobEnded: false };
  return {
    clock: { ...clock, runningSinceMs: null, ended: true },
    addMs: runningMs(clock, now),
    jobEnded: true,
  };
}

function runningMs(clock: RunClock, now: number): number {
  return clock.runningSinceMs === null ? 0 : Math.max(0, now - clock.runningSinceMs);
}
