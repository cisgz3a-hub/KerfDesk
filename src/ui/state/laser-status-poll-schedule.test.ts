import { describe, expect, it } from 'vitest';
import {
  hostAwareSilenceRemainingMs,
  recordStatusPollTick,
  type StatusPollScheduleRefs,
} from './laser-status-poll-schedule';
import { HOST_SCHEDULING_GAP_MS } from './laser-stream-heartbeat';

describe('status poll schedule', () => {
  it('does not treat the first tick of a session as a resume', () => {
    const refs: StatusPollScheduleRefs = {};
    recordStatusPollTick(refs, 1_000);
    recordStatusPollTick(refs, 1_250);
    expect(refs.statusPollSchedule).toEqual({
      lastTickAt: 1_250,
      resumedAt: Number.NEGATIVE_INFINITY,
    });
    // A deadline armed before the first tick counts from when it was armed.
    expect(hostAwareSilenceRemainingMs(refs.statusPollSchedule, 900, 8_000, 1_250)).toBe(7_650);
  });

  it('starts a new resume point after a scheduling gap, and keeps it on schedule', () => {
    const refs: StatusPollScheduleRefs = {};
    recordStatusPollTick(refs, 1_000);
    recordStatusPollTick(refs, 61_000);
    recordStatusPollTick(refs, 61_250);
    expect(refs.statusPollSchedule).toEqual({ lastTickAt: 61_250, resumedAt: 61_000 });
  });

  it('keeps wall-clock silence when no poll has run', () => {
    expect(hostAwareSilenceRemainingMs(null, 0, 8_000, 3_000)).toBe(5_000);
    expect(hostAwareSilenceRemainingMs(undefined, 0, 8_000, 9_000)).toBe(0);
  });

  it('waits a full timeout while the poll is not running', () => {
    const schedule = { lastTickAt: 0, resumedAt: 0 };
    expect(hostAwareSilenceRemainingMs(schedule, 0, 8_000, HOST_SCHEDULING_GAP_MS)).toBe(8_000);
  });

  it('measures silence from the later of arming and the poll resuming', () => {
    const resumed = { lastTickAt: 60_000, resumedAt: 60_000 };
    expect(hostAwareSilenceRemainingMs(resumed, 0, 8_000, 60_500)).toBe(7_500);
    const steady = { lastTickAt: 20_000, resumedAt: 0 };
    expect(hostAwareSilenceRemainingMs(steady, 12_000, 8_000, 20_000)).toBe(0);
  });
});
