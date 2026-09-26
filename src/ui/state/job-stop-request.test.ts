import { describe, expect, it } from 'vitest';
import type { GrblState } from '../../core/controllers/grbl';
import { softResetMayLosePosition, streamResetRecord } from './job-stop-request';

function report(state: GrblState, subState: number | null = null) {
  return { state, subState };
}

// GRBL mc_reset kills the steppers, and raises ALARM:3, in a cycle, a jog,
// homing, or a hold or door still in motion (CNC audit MC-3).
describe('softResetMayLosePosition', () => {
  it.each([
    ['Run', null],
    ['Jog', null],
    ['Home', null],
    ['Hold', 1],
    ['Hold', null],
    ['Door', 2],
    ['Door', 3],
  ] as const)('counts %s:%s as moving', (state, subState) => {
    expect(softResetMayLosePosition(report(state, subState), 'paused', false)).toBe(true);
  });

  it.each([
    ['Hold', 0],
    ['Door', 0],
    ['Door', 1],
    ['Alarm', null],
    ['Sleep', null],
    ['Check', null],
    ['Tool', null],
  ] as const)('counts %s:%s as stopped', (state, subState) => {
    expect(softResetMayLosePosition(report(state, subState), 'paused', false)).toBe(false);
  });

  it('treats Idle as stopped unless lines are still being streamed', () => {
    expect(softResetMayLosePosition(report('Idle'), 'tool-change', false)).toBe(false);
    expect(softResetMayLosePosition(report('Idle'), null, false)).toBe(false);
    expect(softResetMayLosePosition(report('Idle'), 'streaming', false)).toBe(true);
  });

  it('assumes motion when the report may be stale or missing', () => {
    expect(softResetMayLosePosition(report('Hold', 0), 'paused', true)).toBe(true);
    expect(softResetMayLosePosition(null, 'paused', false)).toBe(true);
  });
});

describe('streamResetRecord', () => {
  const alarmed = {
    statusReport: report('Alarm'),
    streamer: { status: 'errored' as const },
    streamerEpoch: 5,
    pauseResumeTransition: null,
  };

  it('keeps an earlier reset of the same stream that may have cost position', () => {
    const earlier = { streamerEpoch: 5, positionMayBeLost: true };
    expect(streamResetRecord({ ...alarmed, streamReset: earlier }).positionMayBeLost).toBe(true);
  });

  it('ignores a reset recorded for an earlier stream', () => {
    const earlier = { streamerEpoch: 4, positionMayBeLost: true };
    expect(streamResetRecord({ ...alarmed, streamReset: earlier }).positionMayBeLost).toBe(false);
  });
});
