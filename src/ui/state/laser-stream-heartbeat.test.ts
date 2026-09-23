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
    for (let tick = 1; tick <= ACTIVE_STREAM_SCHEDULING_GRACES + 1; tick += 1) {
      result = detectActiveStreamHeartbeatLoss(
        streamingJob(),
        observation(4),
        result.probe,
        1_000 + tick * 60_000,
      );
      delayed.push(result.lost);
    }

    expect(delayed).toEqual([
      ...Array.from({ length: ACTIVE_STREAM_SCHEDULING_GRACES }, () => false),
      true,
    ]);
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
