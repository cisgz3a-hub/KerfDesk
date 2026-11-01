import { describe, expect, it } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import {
  ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
  ACTIVE_STREAM_SCHEDULING_GRACES,
  detectActiveStreamHeartbeatLoss,
} from './laser-stream-heartbeat';

function streamingJob() {
  return step(createStreamer('G1 X1 S100\nG1 X2 S100\n')).state;
}

function observation(sequence: number, sessionEpoch = 1) {
  return { sessionEpoch, positionEpoch: 1, sequence, observedAt: sequence };
}

// Ticks every 250 ms from the last change at 0, but a tick that would declare
// loss is held back by a `block` ms stall instead. Returns when loss is
// declared. Up to 400 ms the stall delays the verdict by its own length; from
// 500 ms the late tick cannot judge its gap; from 2 s each stall also takes a
// grace, so the worst case is three graces, a fourth stall the late tick cannot
// judge, and a fifth: 3(B + 1.75 s) + 1.75 s + 2B = 5B + 7 s (ADR-356
// Amendment 2).
function detectionUnderStalls(block: number): number {
  const job = streamingJob();
  let result = detectActiveStreamHeartbeatLoss(job, observation(4), null, 0);
  let now = 0;
  while (now < 1_000_000) {
    const onTime = detectActiveStreamHeartbeatLoss(job, observation(4), result.probe, now + 250);
    const stalled = onTime.lost && block > 250;
    now += stalled ? block : 250;
    result = stalled
      ? detectActiveStreamHeartbeatLoss(job, observation(4), result.probe, now)
      : onTime;
    if (result.lost) return now;
  }
  throw new Error('Loss was never declared.');
}

describe('detectActiveStreamHeartbeatLoss', () => {
  it('faults after an active stream misses the heartbeat window', () => {
    const first = detectActiveStreamHeartbeatLoss(streamingJob(), observation(4), null, 1_000);
    const beforeDeadline = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(4),
      first.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS - 250,
    );
    const fault = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(4),
      beforeDeadline.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
    );

    expect(first.lost).toBe(false);
    expect(fault.lost).toBe(true);
  });

  it('allows one new query window after the host itself stopped polling', () => {
    const first = detectActiveStreamHeartbeatLoss(streamingJob(), observation(4), null, 1_000);
    const resumed = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(4),
      first.probe,
      61_000,
    );
    const beforeDeadline = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(4),
      resumed.probe,
      61_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS - 250,
    );
    const fault = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(4),
      beforeDeadline.probe,
      61_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
    );

    expect(resumed.lost).toBe(false);
    expect(beforeDeadline.lost).toBe(false);
    expect(fault.lost).toBe(true);
  });

  it('does not renew that query window indefinitely across delayed ticks with no reply', () => {
    let result = detectActiveStreamHeartbeatLoss(streamingJob(), observation(4), null, 1_000);
    const delayed: boolean[] = [];
    for (let tick = 1; tick <= ACTIVE_STREAM_SCHEDULING_GRACES + 2; tick += 1) {
      result = detectActiveStreamHeartbeatLoss(
        streamingJob(),
        observation(4),
        result.probe,
        1_000 + tick * 60_000,
      );
      delayed.push(result.lost);
    }

    // Each late tick vouches for silence only up to the tick before it, so
    // the tick after the last grace cannot yet judge its own gap; the next
    // one declares (ADR-356 Amendment 2).
    expect(delayed).toEqual([
      ...Array.from({ length: ACTIVE_STREAM_SCHEDULING_GRACES + 1 }, () => false),
      true,
    ]);
  });

  // Audit v6 K2-P1-1: on the desktop network transport a reply that arrived
  // during a long task is read only after the overdue tick. A late tick must
  // not judge its own gap, and doing so costs no grace.
  it('leaves the verdict on a sub-2 s gap to the next tick, without a grace', () => {
    const job = streamingJob();
    const changed = detectActiveStreamHeartbeatLoss(job, observation(4), null, 0);
    // One reply was late, so this tick saw nothing new.
    const late = detectActiveStreamHeartbeatLoss(job, observation(4), changed.probe, 250);
    // A 1.9 s task, then the overdue tick before the transport has read.
    const afterGap = detectActiveStreamHeartbeatLoss(job, observation(4), late.probe, 2_150);
    expect(afterGap.lost).toBe(false);
    expect(afterGap.probe?.schedulingGracesUsed).toBe(0);
    // The reply read just after that tick reaches the next one.
    expect(detectActiveStreamHeartbeatLoss(job, observation(5), afterGap.probe, 2_400).lost).toBe(
      false,
    );
    // A controller that really went silent is declared lost on that tick.
    expect(detectActiveStreamHeartbeatLoss(job, observation(4), afterGap.probe, 2_400).lost).toBe(
      true,
    );
  });

  it('judges silence only up to what the transport has read', () => {
    const job = streamingJob();
    let result = detectActiveStreamHeartbeatLoss(job, observation(4), null, 0);
    for (let now = 250; now <= 2_000; now += 250) {
      // The network read issued at 1.5 s is still outstanding.
      result = detectActiveStreamHeartbeatLoss(job, observation(4), result.probe, now, 1_500);
    }
    expect(result.lost).toBe(false);
    // A read issued at 2.1 s came back with nothing: the silence is real.
    result = detectActiveStreamHeartbeatLoss(job, observation(4), result.probe, 2_250, 2_100);
    expect(result.lost).toBe(true);
  });

  // Audit v6 K2-P3-1: how late a silent controller is declared lost when the
  // host stalls for B ms just before every tick that would declare it.
  it.each([
    [0, 2_000],
    [400, 2_150],
    [1_900, 1_750 + 2 * 1_900],
    [2_000, 5 * 2_000 + 7_000],
    [3_100, 5 * 3_100 + 7_000],
    [10_000, 5 * 10_000 + 7_000],
  ])('declares a silent controller lost under %i ms stalls after %i ms', (block, expected) => {
    expect(detectionUnderStalls(block)).toBe(expected);
  });

  // ADR-356: after the operator waits out a page stall, the reply to the
  // resumed query can sit behind a backlog of acknowledgements and a second
  // long task. Neither is the controller going silent.
  it('does not abort when a second host stall lands before the resumed query is answered', () => {
    const first = detectActiveStreamHeartbeatLoss(streamingJob(), observation(4), null, 1_000);
    const resumed = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(4),
      first.probe,
      21_000,
    );
    const secondStall = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(4),
      resumed.probe,
      21_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 500,
    );

    expect(resumed.lost).toBe(false);
    expect(secondStall.lost).toBe(false);
  });

  it('restarts the window when an acknowledgement arrives without a status report', () => {
    const job = streamingJob();
    const first = detectActiveStreamHeartbeatLoss(job, observation(4), null, 1_000);
    const acked = { ...job, completed: job.completed + 1 };
    const later = detectActiveStreamHeartbeatLoss(
      acked,
      observation(4),
      first.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
    );

    expect(later.lost).toBe(false);
    expect(later.probe?.at).toBe(1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS);
  });

  it('still declares loss when neither a report nor an acknowledgement arrives while polling', () => {
    const job = streamingJob();
    let result = detectActiveStreamHeartbeatLoss(job, observation(4), null, 1_000);
    for (let now = 1_250; now <= 1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS; now += 250) {
      result = detectActiveStreamHeartbeatLoss(job, observation(4), result.probe, now);
    }

    expect(result.lost).toBe(true);
  });

  it('restarts the window for every fresh same-session status report', () => {
    const first = detectActiveStreamHeartbeatLoss(streamingJob(), observation(4), null, 1_000);
    const fresh = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(5),
      first.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
    );

    expect(fresh.lost).toBe(false);
    expect(fresh.probe?.statusSequence).toBe(5);
    expect(fresh.probe?.at).toBe(1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS);
  });

  it('does not monitor a paused stream', () => {
    const paused = { ...streamingJob(), status: 'paused' as const };
    const result = detectActiveStreamHeartbeatLoss(paused, observation(4), null, 10_000);

    expect(result).toEqual({ probe: null, lost: false });
  });

  it('continues monitoring after all lines are acknowledged but motion may still be finishing', () => {
    const done = { ...streamingJob(), status: 'done' as const };
    const first = detectActiveStreamHeartbeatLoss(done, observation(4), null, 1_000);
    const beforeDeadline = detectActiveStreamHeartbeatLoss(
      done,
      observation(4),
      first.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS - 250,
    );
    const fault = detectActiveStreamHeartbeatLoss(
      done,
      observation(4),
      beforeDeadline.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
    );

    expect(fault.lost).toBe(true);
  });

  it('restarts ownership when the controller session changes', () => {
    const first = detectActiveStreamHeartbeatLoss(streamingJob(), observation(4), null, 1_000);
    const nextSession = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(4, 2),
      first.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
    );

    expect(nextSession.lost).toBe(false);
    expect(nextSession.probe?.sessionEpoch).toBe(2);
  });
});
