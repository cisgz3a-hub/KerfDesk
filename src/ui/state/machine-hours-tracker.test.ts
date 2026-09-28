import { describe, expect, it } from 'vitest';
import type { LiveCanvasLifecycle, LiveCanvasRun } from './canvas-motion-plan';
import { advanceRunClock, RUN_CLOCK_FLUSH_MS, type RunClock } from './machine-hours-tracker';

const PLAN_A = {} as LiveCanvasRun['plan'];
const PLAN_B = {} as LiveCanvasRun['plan'];

function run(lifecycle: LiveCanvasLifecycle, plan = PLAN_A, startedAtMs = 1000) {
  return { plan, startedAtMs, lifecycle };
}

/** Feeds lifecycle observations and totals what the clock hands over. */
function replay(observations: ReadonlyArray<readonly [number, ReturnType<typeof run> | null]>): {
  readonly ms: number;
  readonly jobs: number;
} {
  let clock: RunClock | null = null;
  let ms = 0;
  let jobs = 0;
  for (const [now, observed] of observations) {
    const step = advanceRunClock(clock, observed, now);
    clock = step.clock;
    ms += step.addMs;
    if (step.jobEnded) jobs += 1;
  }
  return { ms, jobs };
}

describe('measured run time (ADR-502)', () => {
  it('counts running time and not pauses or tool changes', () => {
    expect(
      replay([
        [1000, run('running')],
        [11_000, run('paused')],
        [50_000, run('running')],
        [60_000, run('tool-change')],
        [90_000, run('running')],
        [95_000, run('finished')],
        [99_000, run('finished')],
        [120_000, null],
      ]),
    ).toEqual({ ms: 10_000 + 10_000 + 5_000, jobs: 1 });
  });

  it('counts a stopped job for the time it ran', () => {
    expect(
      replay([
        [0, run('running')],
        [7_000, run('stopped')],
      ]),
    ).toEqual({ ms: 7_000, jobs: 1 });
  });

  it('hands time over every minute while a job runs', () => {
    let clock: RunClock | null = advanceRunClock(null, run('running'), 0).clock;
    const early = advanceRunClock(clock, run('running'), RUN_CLOCK_FLUSH_MS - 1);
    expect(early.addMs).toBe(0);
    clock = early.clock;
    const flushed = advanceRunClock(clock, run('running'), RUN_CLOCK_FLUSH_MS + 500);
    expect(flushed).toMatchObject({ addMs: RUN_CLOCK_FLUSH_MS + 500, jobEnded: false });
    const after = advanceRunClock(flushed.clock, run('finished'), RUN_CLOCK_FLUSH_MS + 2_500);
    expect(after).toMatchObject({ addMs: 2_000, jobEnded: true });
  });

  it('ends a job whose run is replaced or cleared while it ran', () => {
    expect(
      replay([
        [0, run('running', PLAN_A, 0)],
        [4_000, run('running', PLAN_B, 4_000)],
        [6_000, null],
      ]),
    ).toEqual({ ms: 4_000 + 2_000, jobs: 2 });
  });

  it('counts nothing with no job', () => {
    expect(
      replay([
        [0, null],
        [5_000, null],
      ]),
    ).toEqual({ ms: 0, jobs: 0 });
  });

  it('does not count an already completed run when a tracker mounts again', () => {
    expect(
      replay([
        [5_000, run('finished')],
        [6_000, null],
      ]),
    ).toEqual({ ms: 0, jobs: 0 });
  });
});
