// Controller audit recovery-6: a stop that discards the controller's planner
// also discards moves it had acknowledged, so the automatic laser restart
// steps back over the planner backlog the last status report showed.

import { describe, expect, it } from 'vitest';
import { automaticRestart } from './automatic-restart-line';
import { parseOptionalJobInterruption, type JobInterruption } from './job-interruption';
import { isPlannerMotionLine, plannerFrontierRawLine } from './planner-backlog-restart';

// Raw lines 1-3 are setup; 4..23 are twenty moves, with an S change between.
const PROGRAM = [
  'G21',
  'G90',
  'M4 S0',
  ...Array.from({ length: 20 }, (_, i) => (i === 10 ? `G1 X${i} Y0 S500` : `G1 X${i} Y0`)),
  'M5',
].join('\n');

describe('isPlannerMotionLine', () => {
  it('counts lines with axis words as planner moves', () => {
    expect(isPlannerMotionLine('G1 X1 Y2 F600')).toBe(true);
    expect(isPlannerMotionLine('X.5')).toBe(true);
    expect(isPlannerMotionLine('G0 Z-1')).toBe(true);
  });

  it('ignores setup lines and axis words that queue no move', () => {
    expect(isPlannerMotionLine('M4 S300')).toBe(false);
    expect(isPlannerMotionLine('G92 X0 Y0')).toBe(false);
    expect(isPlannerMotionLine('G10 L20 P0 X0')).toBe(false);
    expect(isPlannerMotionLine('; X10 is a comment')).toBe(false);
    expect(isPlannerMotionLine('F1200')).toBe(false);
  });
});

describe('plannerFrontierRawLine', () => {
  it('steps back the queued blocks from the acknowledgement at the report', () => {
    // 3 setup lines + 15 moves acknowledged; 5 still queued -> raw 4+10 = 14.
    expect(plannerFrontierRawLine(PROGRAM, { ackedAtStatus: 18, queuedBlocks: 5 })).toBe(14);
  });

  it('stops at the first move when the backlog is larger than the moves sent', () => {
    expect(plannerFrontierRawLine(PROGRAM, { ackedAtStatus: 6, queuedBlocks: 512 })).toBe(4);
  });

  it('has no frontier before any move', () => {
    expect(plannerFrontierRawLine(PROGRAM, { ackedAtStatus: 3, queuedBlocks: 5 })).toBeNull();
  });

  // OR-3: a report that showed an empty planner proves every line acknowledged
  // by then had run, so the frontier is the first move acknowledged after it.
  it('puts the frontier of an empty backlog at the first move after the report', () => {
    expect(plannerFrontierRawLine(PROGRAM, { ackedAtStatus: 18, queuedBlocks: 0 })).toBe(19);
    expect(plannerFrontierRawLine(PROGRAM, { ackedAtStatus: 2, queuedBlocks: 0 })).toBe(4);
    expect(plannerFrontierRawLine(PROGRAM, { ackedAtStatus: 24, queuedBlocks: 0 })).toBeNull();
  });
});

describe('automaticRestart with a planner backlog', () => {
  const aborted = (plannerBacklog?: JobInterruption['plannerBacklog']): JobInterruption => ({
    kind: 'cancelled',
    message: 'Stopped by the operator (Abort).',
    ...(plannerBacklog === undefined ? {} : { plannerBacklog }),
  });

  it('restarts at the first move the discarded planner may not have run', () => {
    const restart = automaticRestart(PROGRAM, 20, aborted({ ackedAtStatus: 18, queuedBlocks: 5 }));
    expect(restart).toEqual({
      line: 14,
      replaysRejectedLine: false,
      plannerBacklogBlocks: 5,
      plannerBacklogBasis: 'status-backlog',
    });
  });

  it('keeps the acknowledgement frontier without a backlog', () => {
    expect(automaticRestart(PROGRAM, 20, aborted())).toEqual({
      line: 21,
      replaysRejectedLine: false,
    });
  });

  it('never moves the restart later than the rejected line', () => {
    const rejected: JobInterruption = {
      kind: 'controller-error',
      message: 'error:2',
      rejectedLine: 'G1 X15 Y0',
      plannerBacklog: { ackedAtStatus: 20, queuedBlocks: 1 },
    };
    // Rejected line is raw 19; the one-block backlog points at raw 20.
    expect(automaticRestart(PROGRAM, 20, rejected)).toEqual({
      line: 19,
      replaysRejectedLine: true,
    });
  });

  it('survives a storage round trip', () => {
    const stored = JSON.parse(JSON.stringify(aborted({ ackedAtStatus: 18, queuedBlocks: 5 })));
    expect(parseOptionalJobInterruption(stored)).toEqual({
      interruption: aborted({ ackedAtStatus: 18, queuedBlocks: 5 }),
    });
    expect(
      parseOptionalJobInterruption({ ...stored, plannerBacklog: { ackedAtStatus: -1 } }),
    ).toBeNull();
  });

  it('keeps a planner-size bound through storage and rejects an unknown bound', () => {
    const bounded = aborted({ ackedAtStatus: 20, queuedBlocks: 15, bound: 'planner-size' });
    const stored = JSON.parse(JSON.stringify(bounded));
    expect(parseOptionalJobInterruption(stored)).toEqual({ interruption: bounded });
    expect(
      parseOptionalJobInterruption({
        ...stored,
        plannerBacklog: { ackedAtStatus: 20, queuedBlocks: 15, bound: 'guess' },
      }),
    ).toBeNull();
  });
});

// OR-3 (2026-09-25 controller audit): a planner-discarding stop without a
// status report that showed a backlog. Adapted from the audit's reproduction
// test.
describe('automaticRestart without a reported backlog (OR-3)', () => {
  const aborted = (plannerBacklog: JobInterruption['plannerBacklog']): JobInterruption => ({
    kind: 'cancelled',
    message: 'Stopped by the operator (Abort).',
    ...(plannerBacklog === undefined ? {} : { plannerBacklog }),
  });

  it('steps back a whole stock GRBL planner (15 blocks) from the stop', () => {
    // 3 setup lines + 17 moves acknowledged (raw 4..20); up to 15 were queued.
    const restart = automaticRestart(
      PROGRAM,
      20,
      aborted({ ackedAtStatus: 20, queuedBlocks: 15, bound: 'planner-size' }),
    );
    expect(restart).toEqual({
      line: 6,
      replaysRejectedLine: false,
      plannerBacklogBlocks: 15,
      plannerBacklogBasis: 'planner-size',
    });
  });

  it('replays every move acknowledged after a report that showed an empty planner', () => {
    // The report came at 10 lines (raw 1..10); 10 more were acknowledged.
    const restart = automaticRestart(PROGRAM, 20, aborted({ ackedAtStatus: 10, queuedBlocks: 0 }));
    expect(restart).toEqual({
      line: 11,
      replaysRejectedLine: false,
      plannerBacklogBlocks: 0,
      plannerBacklogBasis: 'after-empty-status',
    });
  });

  it('keeps the acknowledgement frontier when the empty report was the last acknowledgement', () => {
    expect(automaticRestart(PROGRAM, 20, aborted({ ackedAtStatus: 20, queuedBlocks: 0 }))).toEqual({
      line: 21,
      replaysRejectedLine: false,
    });
  });
});
